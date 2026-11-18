import { Plugin } from "@opencode/plugin"

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

const BRIDGE = (process.env.STRAGY_TOOL_BRIDGE ?? "http://127.0.0.1:3000").replace(/\/+$/, "")
const TOKEN = process.env.STRAGY_TOOL_TOKEN ?? ""
const RESULT_TOOL: Record<string, string> = {
  scan: "get_scan_result",
  chart: "get_chart_result",
  backtest: "get_backtest_result",
  refresh: "get_refresh_result",
}
const MAX_WAIT_MS = 15 * 60 * 1000
const POLL_MS = 3_000

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

async function settle(started: string, first: ToolEnvelope, sessionID: string, signal?: AbortSignal): Promise<ToolEnvelope> {
  const resultTool = RESULT_TOOL[first.kind ?? ""]
  const jobId = first.jobId
  if (!resultTool || !jobId) return first
  const deadline = Date.now() + MAX_WAIT_MS
  let current = first
  while (current.status === "running" && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, POLL_MS))
    if (signal?.aborted) return { ...current, note: "Stopped by the user. The job keeps running on the server; call " + resultTool + " with this jobId to read it later." }
    current = outputOf(await callTool(resultTool, { jobId, waitSeconds: 10 }, `${sessionID}:${jobId}`, signal))
  }
  if (current.status === "running") {
    return { ...current, status: "running", note: "Still running after " + Math.round(MAX_WAIT_MS / 60000) + " minutes. Call " + resultTool + " with jobId " + jobId + " to read it again." }
  }
  return current
}

export default Plugin.define({
  id: "stragy-tools",
  async setup(ctx) {
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
          execute: async (input: unknown, context: { sessionID: string; signal?: AbortSignal }) => {
            const result = outputOf(await callTool(tool.name, input, context.sessionID, context.signal))
            const final = await settle(tool.name, result, context.sessionID, context.signal)
            return { content: JSON.stringify(final, null, 1) }
          },
        })
      }
    })
  },
})
