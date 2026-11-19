import { Plugin } from "@opencode/plugin"
import type { ToolContext } from "@opencode/plugin/promise/tool"
import { spawn, type ChildProcess } from "node:child_process"
import { openSync } from "node:fs"
import { dirname, join } from "node:path"

/**
 * Stragy's research tools for the standalone OpenCode UI.
 *
 * The Stragy server owns the job runner, the SQLite candle cache and the single
 * Angel One session. This plugin only forwards tool calls over loopback, so
 * there is still exactly one process fetching market data.
 *
 * Long jobs are awaited here instead of making the model poll: when a tool
 * returns `status: "running"` the plugin calls the matching result tool until
 * the job finishes. OpenCode keeps showing the call as running, and stopping
 * the turn aborts this fetch while the job keeps running on the server.
 */

const BRIDGE = (process.env.STRAGY_TOOL_BRIDGE ?? "http://127.0.0.1:3100").replace(/\/+$/, "")
const TOKEN = process.env.STRAGY_TOOL_TOKEN ?? ""
const RESULT_TOOL: Record<string, string> = {
  scan: "get_scan_result",
  chart: "get_chart_result",
  backtest: "get_backtest_result",
  refresh: "get_refresh_result",
}
const MAX_WAIT_MS = 15 * 60 * 1000
const POLL_MS = 3_000
/** A Stragy backend started by this plugin, when one was not already running. */
let backend: ChildProcess | undefined

async function healthy(): Promise<boolean> {
  try {
    const response = await fetch(BRIDGE + "/health/ready", { signal: AbortSignal.timeout(1500) })
    return response.ok
  } catch {
    return false
  }
}

/**
 * Start the Stragy backend if it is not already running, so the whole app is
 * one command (`opencode serve`). The child inherits this process's environment,
 * including the provider and Angel One keys loaded by the launcher.
 */
async function ensureBackend(): Promise<void> {
  if (await healthy()) return
  const home = process.env.STRAGY_HOME
  if (!home || process.env.STRAGY_AUTOSTART === "0") return
  // Reuse the canonical launcher: it supplies the production data/AI env, takes
  // the server lock, records the PID and detaches, so the backend does not die
  // with the chat UI.
  let log = "ignore"
  try { log = openSync("/tmp/opencode/stragy-backend.log", "a") } catch { /* best effort */ }
  const launcher = process.env.STRAGY_START_SCRIPT ?? join(dirname(home), "qa", "start-server.sh")
  backend = spawn("bash", [launcher, "opencode-app"], {
    cwd: home,
    env: { ...process.env, STRAGY_AUTOSTART: "0" },
    stdio: ["ignore", log, log],
  })
  backend.on("error", () => { backend = undefined })
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (await healthy()) return
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error("The Stragy backend did not become ready on " + BRIDGE + ". Start it with qa/start-server.sh or set STRAGY_HOME.")
}

interface ToolSummary {
  name: string
  description: string
  input: Record<string, unknown>
}

interface ToolEnvelope {
  status?: string
  jobId?: string
  kind?: string
  progress?: { processed?: number; total?: number }
  [key: string]: unknown
}

function headers(sessionID: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-stragy-session": sessionID,
    ...(TOKEN ? { "x-stragy-tool-token": TOKEN } : {}),
  }
}

async function callTool(name: string, input: unknown, sessionID: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(BRIDGE + "/api/v2/engine/tools/" + encodeURIComponent(name), {
    method: "POST",
    headers: headers(sessionID),
    body: JSON.stringify({ input: input ?? {} }),
    signal,
  })
  const text = await response.text()
  let body: unknown = text
  try { body = text ? JSON.parse(text) : null } catch { /* keep raw text */ }
  if (!response.ok) {
    const message = typeof body === "object" && body && "message" in body ? String((body as { message: unknown }).message) : "Stragy tool failed with HTTP " + response.status
    throw new Error(name + ": " + message)
  }
  return body
}

/** The executor result is `{ output }`; unwrap it for the model. */
function outputOf(result: unknown): ToolEnvelope {
  if (result && typeof result === "object" && "output" in result) return (result as { output: ToolEnvelope }).output
  return (result ?? {}) as ToolEnvelope
}

interface SessionFile { data: string; mime: string; name?: string }

/** The newest image the user attached to this session, if any. */
function newestImage(messages: unknown[]): SessionFile | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i] as { files?: SessionFile[] }
    const files = Array.isArray(message?.files) ? message.files : []
    for (let j = files.length - 1; j >= 0; j--) {
      const file = files[j]
      if (file && typeof file.data === "string" && /^image\/(png|jpeg|webp)$/.test(String(file.mime))) return file
    }
  }
  return null
}

async function settle(started: string, first: ToolEnvelope, sessionID: string, signal?: AbortSignal): Promise<ToolEnvelope> {
  const resultTool = RESULT_TOOL[first.kind ?? ""]
  const jobId = first.jobId
  if (!resultTool || !jobId) return first
  const deadline = Date.now() + MAX_WAIT_MS
  let current = first
  while ((current.status === "running" || current.status === "queued") && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, POLL_MS))
    if (signal?.aborted) return { ...current, note: "Stopped by the user. The job keeps running on the server; call " + resultTool + " with this jobId to read it later." }
    current = outputOf(await callTool(resultTool, { jobId, waitSeconds: 10 }, `${sessionID}:${jobId}`, signal))
  }
  if (current.status === "running" || current.status === "queued") {
    return { ...current, note: "Still running after " + Math.round(MAX_WAIT_MS / 60000) + " minutes. Call " + resultTool + " with jobId " + jobId + " to read it again." }
  }
  return current
}

export default Plugin.define({
  id: "stragy-tools",
  async setup(ctx) {
    await ensureBackend()
    const response = await fetch(BRIDGE + "/api/v2/engine/tools", { headers: headers("setup") })
    if (!response.ok) {
      const text = await response.text()
      throw new Error("Stragy tools are unavailable (" + response.status + "): " + text.slice(0, 300))
    }
    const { tools } = (await response.json()) as { tools: ToolSummary[] }
    await ctx.tool.transform((editor) => {
      for (const tool of tools) {
        editor.add({
          name: tool.name,
          description: tool.description,
          input: tool.input,
          options: { codemode: false },
          execute: async (input: unknown, context: ToolContext) => {
            let args = input
            // read_chart reads an image from Stragy's session context; the
            // OpenCode UI attaches images to the message instead, so hand the
            // newest one over before the tool runs.
            if (tool.name === "read_chart" && !(input && typeof input === "object" && (input as { imageId?: unknown }).imageId)) {
              try {
                const messages = await ctx.session.context({ sessionID: context.sessionID })
                const image = newestImage(messages as unknown[])
                if (image) {
                  const uploaded = await fetch(BRIDGE + "/api/v2/engine/attachments", {
                    method: "POST",
                    headers: headers(context.sessionID),
                    body: JSON.stringify({ sessionId: context.sessionID, data: image.data, mime: image.mime, name: image.name }),
                    signal: context.signal,
                  })
                  if (uploaded.ok) {
                    const { imageId } = (await uploaded.json()) as { imageId?: string }
                    if (imageId) args = { ...(input as Record<string, unknown>), imageId }
                  }
                }
              } catch { /* the tool reports IMAGE_REQUIRED honestly */ }
            }
            const result = outputOf(await callTool(tool.name, args, context.sessionID, context.signal))
            // SAFE STATE: OpenCode 2.3.0's permission engine does not produce a
            // native prompt for in-chat tool actions here (custom actions
            // auto-allow; resource-scoped known actions are overridden by the
            // broad host-tool denies). NEVER auto-approve a backtest: return the
            // engine's approval_required gate unchanged with the real operator
            // path stated. The operator approves via POST /api/v2/engine/approvals
            // (proven on :3000) or the Stragy UI's approval card, then reruns
            // run_backtest with the same input.
            if (tool.name === "run_backtest" && result.status === "approval_required") {
              const approvalId = result.approvalId ?? (result.approval as { id?: unknown } | undefined)?.id
              const note = "Operator approval required; the backtest was NOT run. OpenCode's in-chat permission prompt is not available for this action. Approve approvalId " + String(approvalId) + " for session " + context.sessionID + " with POST /api/v2/engine/approvals (or the Stragy UI approval card), then call run_backtest again with the same input."
              return { content: JSON.stringify({ ...result, note }, null, 1) }
            }
            const final = await settle(tool.name, result, context.sessionID, context.signal)
            return { content: JSON.stringify(final, null, 1) }
          },
        })
      }
    })
    return () => { backend = undefined }
  },
})
