/**
 * ESM-only OpenCode packages loaded from the CommonJS production bundle.
 *
 * scripts/build-server.mjs emits CommonJS with moduleResolution Node10, and
 * @opencode/sdk has an `exports` map with only an `import` condition. A static
 * import therefore fails at build time and `require()` fails at runtime. This
 * shim performs a real dynamic `import()` (hidden from TypeScript's CJS
 * transform) and exposes the small typed surface Stragy uses.
 *
 * The plugin package is not loaded at all: a plugin is a plain
 * `{ id, setup }` object, so returning that object avoids a second ESM bridge.
 */
export interface EngineHostEvent {
  type: string;
  created?: number;
  durable?: { seq?: number; [key: string]: unknown };
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface EngineHostTokenUsage {
  input?: number;
  output?: number;
  reasoning?: number;
  cache?: { read?: number; write?: number };
}

export interface EngineHostSessionInfo {
  id: string;
  title?: string;
  agent?: string;
  model?: { providerID: string; id: string; variant?: string };
  location?: { directory?: string };
  time?: { created?: number; updated?: number };
  cost?: number;
  tokens?: EngineHostTokenUsage;
  outcome?: 'succeeded' | 'failed' | 'interrupted' | string;
}

export interface EngineHostMessagePage {
  data: unknown[];
}

/** SessionStatsInfo from @opencode/client; only the fields Stragy renders. */
export interface EngineHostStats {
  range?: { from?: number; to?: number };
  sessions?: number;
  subagents?: number;
  prompts?: number;
  steps?: number;
  tokens?: EngineHostTokenUsage;
  cost?: number;
  tools?: unknown;
  activeDays?: number;
  streak?: number;
  activity?: unknown[];
  models?: unknown[];
}

/** usage.limits() output: the workspace plus its plan meters, or null. */
export interface EngineHostUsageLimits {
  location?: unknown;
  data: unknown | null;
}

export interface EngineHost {
  sessions: {
    create(input: Record<string, unknown>): Promise<EngineHostSessionInfo>;
    get(input: { sessionID: string }): Promise<EngineHostSessionInfo>;
    list(input?: Record<string, unknown>): Promise<{ data: EngineHostSessionInfo[] }>;
    update(input: { sessionID: string; title?: string; archived?: boolean }): Promise<void>;
    remove(input: { sessionID: string }): Promise<void>;
    switchModel(input: { sessionID: string; model: { providerID: string; id: string } }): Promise<void>;
    stats(input?: Record<string, unknown>): Promise<EngineHostStats>;
    export(input: { sessionID: string; sanitize?: boolean }): Promise<unknown>;
    prompt(input: { sessionID: string; text: string }): Promise<{ id?: string }>;
    interrupt(input: { sessionID: string }): Promise<unknown>;
    log(input: { sessionID: string; after?: number; follow?: boolean }): AsyncIterable<unknown>;
  };
  message: {
    list(input: { sessionID: string; limit?: number; type?: string }): Promise<EngineHostMessagePage>;
  };
  usage: {
    limits(input?: Record<string, unknown>): Promise<EngineHostUsageLimits>;
  };
  events: {
    subscribe(options?: Record<string, unknown>): AsyncIterable<EngineHostEvent>;
  };
  close(): Promise<void>;
}

export interface EngineHostApi {
  create(options: Record<string, unknown>): Promise<EngineHost>;
}

export interface EnginePluginDefinition {
  readonly id: string;
  setup(context: unknown): Promise<void> | void;
}

type EsmImporter = (specifier: string) => Promise<Record<string, unknown>>;

/** A real dynamic import that survives the CJS transform untouched. */
const importEsm: EsmImporter = new Function('specifier', 'return import(specifier)') as EsmImporter;

let hostApi: Promise<EngineHostApi> | null = null;
let injectedHostApi: EngineHostApi | null = null;

/** Load @opencode/sdk once; the package is ESM-only. */
export function loadEngineHostApi(): Promise<EngineHostApi> {
  if (injectedHostApi) return Promise.resolve(injectedHostApi);
  hostApi ??= importEsm('@opencode/sdk').then(module => {
    const namespace = module.OpenCode ?? (module.default as { OpenCode?: unknown } | undefined)?.OpenCode;
    const candidate = namespace as { create?: unknown } | undefined;
    if (!candidate || typeof candidate.create !== 'function') {
      throw new Error('The installed @opencode/sdk does not export OpenCode.create.');
    }
    return candidate as EngineHostApi;
  }).catch(error => {
    hostApi = null;
    throw error;
  });
  return hostApi;
}

/** Test seam: inject a fake host factory without mocking an ESM package. */
export function setEngineHostApiForTests(api: EngineHostApi | null): void {
  injectedHostApi = api;
  hostApi = null;
}

/** Test seam: forget the cached module (the host still owns its own lifecycle). */
export function resetEngineHostApiForTests(): void {
  hostApi = null;
  injectedHostApi = null;
}
