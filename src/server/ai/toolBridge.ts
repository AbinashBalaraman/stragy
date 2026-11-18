import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { createEnginePlugin, type EngineToolDepsGetter } from './engineTools';

/**
 * The standalone OpenCode server (the chat UI) runs as its own process, so its
 * plugin cannot hold Stragy's job manager, candle store or Angel session. This
 * bridge captures the same tool definitions the embedded engine uses and runs
 * them inside the Stragy server, then hands the OpenCode plugin a tiny HTTP
 * surface. One owner process fetches market data, exactly as before.
 */
export interface BridgeToolSummary {
  name: string;
  description: string;
  input: Record<string, unknown>;
}

interface CapturedTool {
  name: string;
  description: string;
  input: unknown;
  execute: (input: unknown, context: { sessionID: string }) => Promise<{ output?: unknown; content?: unknown }>;
}

/** Durable per-session research preferences (`remember_preference`). */
export class PreferenceStore {
  private db: DatabaseSync;
  private listStatement;
  private putStatement;
  private deleteStatement;

  constructor(file: string) {
    mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS session_preference (
        session_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (session_id, key)
      ) STRICT;`);
    this.listStatement = this.db.prepare('SELECT key, value FROM session_preference WHERE session_id = ? ORDER BY key');
    this.putStatement = this.db.prepare('INSERT INTO session_preference (session_id, key, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(session_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at');
    this.deleteStatement = this.db.prepare('DELETE FROM session_preference WHERE session_id = ? AND key = ?');
  }

  list(sessionId: string): { key: string; value: unknown }[] {
    return (this.listStatement.all(sessionId) as { key: string; value: string }[]).map(row => {
      try { return { key: row.key, value: JSON.parse(row.value) }; } catch { return { key: row.key, value: row.value }; }
    });
  }

  put(sessionId: string, key: string, value: unknown): void {
    this.putStatement.run(sessionId, key, JSON.stringify(value ?? null), new Date().toISOString());
  }

  remove(sessionId: string, key: string): void {
    this.deleteStatement.run(sessionId, key);
  }

  close(): void { this.db.close(); }
}

export interface ToolBridge {
  list(): Promise<BridgeToolSummary[]>;
  run(name: string, input: unknown, sessionID: string): Promise<{ status: number; body: unknown }>;
  close(): void;
}

export function createToolBridge(options: { getDeps: EngineToolDepsGetter; preferencesFile: string }): ToolBridge {
  const preferences = new PreferenceStore(options.preferencesFile);
  let captured: Map<string, CapturedTool> | null = null;

  const sessionApi = {
    instructions: {
      entry: {
        list: async ({ sessionID }: { sessionID: string }) => preferences.list(sessionID),
        put: async ({ sessionID, key, value }: { sessionID: string; key: string; value: unknown }) => { preferences.put(sessionID, key, value); },
      },
    },
  };

  /** Registering the plugin only builds definitions; executors read deps lazily. */
  async function capture(): Promise<Map<string, CapturedTool>> {
    if (captured) return captured;
    const tools = new Map<string, CapturedTool>();
    await createEnginePlugin(options.getDeps).setup({
      session: sessionApi,
      tool: {
        transform: (callback: (editor: { add: (tool: CapturedTool) => void }) => void) => {
          callback({ add: tool => { tools.set(tool.name, tool); } });
        },
      },
    });
    captured = tools;
    return tools;
  }

  return {
    async list() {
      const tools = await capture();
      return [...tools.values()].map(tool => ({
        name: tool.name,
        description: tool.description,
        input: toJsonSchema(tool.input),
      }));
    },
    async run(name, input, sessionID) {
      const tools = await capture();
      const tool = tools.get(name);
      if (!tool) return { status: 404, body: { code: 'TOOL_NOT_FOUND', message: 'Unknown Stragy tool: ' + name } };
      try {
        const parsed = parseInput(tool.input, input);
        if ('error' in parsed) return { status: 422, body: { code: 'TOOL_INPUT_INVALID', message: parsed.error } };
        const result = await tool.execute(parsed.value, { sessionID });
        return { status: 200, body: result };
      } catch (error) {
        return { status: 500, body: { code: 'TOOL_FAILED', message: (error as Error)?.message ?? 'The tool failed.' } };
      }
    },
    close() { preferences.close(); captured = null; },
  };
}

function isZod(schema: unknown): schema is z.ZodType {
  return Boolean(schema && typeof schema === 'object' && '_zod' in (schema as Record<string, unknown>));
}

function toJsonSchema(schema: unknown): Record<string, unknown> {
  if (isZod(schema)) {
    const json = z.toJSONSchema(schema) as Record<string, unknown>;
    delete json.$schema;
    return json;
  }
  return (schema && typeof schema === 'object' ? schema : { type: 'object', properties: {}, additionalProperties: false }) as Record<string, unknown>;
}

function parseInput(schema: unknown, input: unknown): { value: unknown } | { error: string } {
  if (!isZod(schema)) return { value: input ?? {} };
  const parsed = schema.safeParse(input ?? {});
  if (parsed.success) return { value: parsed.data };
  const issues = parsed.error.issues.slice(0, 5).map(issue => (issue.path.join('.') || '(root)') + ': ' + issue.message);
  return { error: issues.join('; ') };
}
