import express, { type Request, type Response, type NextFunction } from 'express';
import path from 'node:path';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { parseConfig, redact, type RuntimeConfig } from './config';
import { sourceCommit } from './buildInfo';
import { ALL_SYMBOLS, NSE_SYMBOLS, UNIVERSE_OPTIONS, filterSymbolsByUniverse, getSymbolById, UnknownSymbolError } from './data/symbols';
import { loadMarketSeries, getAvailableTradingDates, findNearestTradingDate, MarketDataError } from './data/realMarketData';
import { calculateStockTrends, calculateMarketMovers, getSmartApiStatus, getSmartApiRateLimitsAndSpecs, getOptionChainData, getVolumeProfileAndVWAP, calculateGttBracketOrder, getBasisAndCalendarSpreads } from './data/smartApi';
import { getLiveQuotes } from './data/liveQuotes';
import { getMarketCacheStats } from './data/candleStore';
import { ANGEL_RATE_LIMIT_MESSAGE, getAngelCredentialStatus, getAngelSessionInfo, getAngelDebugMetrics } from './data/angelClient';
import { scanUniverse } from './backtest/scanner';
import { runBacktest } from './backtest/engine';
import { STRATEGY_TEMPLATES } from '../shared/strategy/templates';
import { canonicalStrategyJSON, validateStrategy } from '../shared/strategy/schema';
import { PATTERN_LIBRARY } from './ai/patterns';
import { createProposal, getAIStatus, parseStrategyPrompt, applyStrategyEdit, optimizeStrategyForProfitability } from './ai/copilot';
import { ResearchRepository, StorageError } from './storage/repository';
import { JobError, SCAN_HARD_CAP_MS, type ResearchPayload, type JobStatus, type JobSummary } from './jobs/manager';
import { plainScanFailure } from '../shared/contracts/scan-availability';
import { buildMarketSnapshot, type MarketSnapshot } from './backtest/marketSnapshot';
import { scanUniverseAsync } from './backtest/scanner';
import { parseBacktestResult } from '../shared/contracts/research';
import { SimulationInputError } from './backtest/engine';
import type { BacktestResponse, StrategyAST } from '../shared/strategy/types';
import { resolveFeatureSetup } from './ai/featureSetup';
import { analyzeChart, ChartImageError, parseChartImageDataUrl } from './ai/chartVision';
import { isVoiceConfigured, transcribeAudio, VoiceError, VOICE_MODEL } from './voice/transcribe';
import { createVoiceRateLimiter } from './voice/rateLimit';
import { resolveObservedUniverse } from './data/observedUniverse';
import { getProvidersResponse, upsertProvider, deleteProvider, setChain, resetProviders, listProviderModels, testProvider, ProviderError, initializeProviderRegistry } from './ai/providerRegistry';
import { initializeEngine, configureEngine, createSession as createEngineSession, getSession as getEngineSession, listSessions as listEngineSessions, renameSession as renameEngineSession, deleteSession as deleteEngineSession, switchSessionModel as switchEngineSessionModel, exportSession as exportEngineSession, availableModels as listEngineModels, usageReport as engineUsageReport, configuredModels as configuredEngineModels, prompt as promptEngineSession, messages as engineMessages, openSessionStream, interrupt as interruptEngineSession, stageContext, engineStatus, EngineError } from './ai/engine';
import { engineApprovals, ApprovalError } from './ai/engineApprovals';
import { EngineContextStore } from './ai/engineTools';
import { createToolBridge } from './ai/toolBridge';
import { initializeDatabase, getDbStatus } from './db/pool';

export class ApiFailure extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}
const IdSchema = z.coerce.number().int().positive();
const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();
const BacktestRequest = z.object({ strategy: z.unknown(), initialCapital: z.number().finite().min(100).max(1e9).optional(), start: DateSchema, end: DateSchema, asOf: DateSchema, seed: z.number().int().min(0).max(0xffffffff).optional(), robustness: z.boolean().optional() });
const ScanRequest = z.object({ universe: z.string().max(40).default('NIFTY_50'), strategyJson: z.unknown().optional(), strategy: z.unknown().optional(), limit: z.number().int().min(1).max(100).default(35), date: DateSchema, asOf: DateSchema });
export interface JobView { id: string; status: string; kind?: string; stage?: string; queuedBehind?: number; createdAt?: string; startedAt?: string; finishedAt?: string; progress?: { processed: number; total: number }; result?: unknown; error?: unknown; }
export interface AppJobService { enqueue: (payload: ResearchPayload, key?: string) => JobView; get: (id: string) => JobView | undefined; cancel: (id: string) => unknown; resume?: (id: string) => JobView; listSummaries?: (input: { limit?: number; status?: JobStatus }) => JobSummary[]; shutdown?: () => Promise<void>; }
export interface AppDependencies { config?: RuntimeConfig; enableVite?: boolean; jobs?: AppJobService; repository?: ResearchRepository; }
function parse<T>(schema: z.ZodType<T>, input: unknown): T { const r = schema.safeParse(input); if (!r.success) throw new ApiFailure(422, 'VALIDATION_FAILED', 'Input validation failed', r.error.issues.map(i => ({ path: i.path.join('.'), message: i.message }))); return r.data; }
function executable(raw: unknown): StrategyAST { const r = validateStrategy(raw); if (!r.success || !r.data) throw new ApiFailure(422, 'INVALID_STRATEGY', 'Strategy is invalid or unsupported', r.errors); return r.data; }
function tokenMatches(actual: string, expected: string): boolean { const a = Buffer.from(actual), b = Buffer.from(expected); return a.length === b.length && timingSafeEqual(a, b); }
const wrap = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) => { Promise.resolve().then(() => fn(req, res)).catch(next); };
// Warm-up must never tell the user the catalog is missing. Wait a bounded time for the
// official membership feed, then fall back to the bundled catalog for instrument ids.
function symbolsWarmupBudgetMs(): number {
  const raw = Number(process.env.SYMBOLS_WARMUP_BUDGET_MS ?? 20_000);
  return Number.isFinite(raw) && raw >= 0 ? raw : 20_000;
}
async function resolveSymbolMembership(): Promise<Awaited<ReturnType<typeof resolveObservedUniverse>>> {
  const deadline = Date.now() + symbolsWarmupBudgetMs();
  for (;;) {
    try { return await resolveObservedUniverse('NIFTY_50'); }
    catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise(resolve => setTimeout(resolve, 700));
    }
  }
}

export async function createApp(deps: AppDependencies = {}) {
  const config = deps.config ?? parseConfig();
  process.env.DATA_MODE = config.DATA_MODE;
  process.env.AI_PROVIDER = config.AI_PROVIDER;
  process.env.MARKET_PROVIDER = config.MARKET_PROVIDER;
  process.env.QUOTES_PROVIDER = config.QUOTES_PROVIDER;
  // Start the official NIFTY 50 fetch and the Angel instrument master during boot so
  // the first scan joins in-flight work instead of paying a 40 MB cold download.
  // Tests never warm.
  if (config.NODE_ENV === 'production' && config.DATA_MODE === 'real') {
    void resolveObservedUniverse('NIFTY_50').catch(() => undefined);
    if (config.MARKET_PROVIDER === 'angel') void import('./data/angelSymbols').then(m => m.warmAngelInstrumentMaster()).catch(() => undefined);
  }
  process.env.AI_COST_POLICY = config.AI_COST_POLICY;
  if (config.VISION_PROVIDER) process.env.VISION_PROVIDER = config.VISION_PROVIDER;
  if (config.VISION_MODEL) process.env.VISION_MODEL = config.VISION_MODEL;
  await initializeDatabase(process.env);
  await initializeProviderRegistry(process.env);
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  
  const repository = deps.repository ?? await ResearchRepository.open({ maxRuns: config.MAX_STORED_RUNS });
  const clients = new Map<string, { time: number; count: number }>();
  app.use((req, res, next) => {
    res.locals.requestId = randomUUID(); res.setHeader('X-Request-ID', res.locals.requestId);
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Frame-Options', 'DENY');
    if (config.NODE_ENV === 'production') res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data:; connect-src 'self'; font-src 'self' data: https://fonts.gstatic.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
    next();
  });
  app.get('/health/live', (_req, res) => res.json({ status: 'ok' }));
  app.get('/health/ready', async (_req, res) => {
    const db = await getDbStatus(process.env);
    res.json({ status: 'ready', mode: config.DATA_MODE, persistence: config.STORAGE_MODE, db });
  });
  // Whole-site password gate for the owner's private deployment. Health probes stay open
  // so Render (and local tooling) can verify liveness without credentials. A valid Bearer
  // API token remains an alternative for API clients; browser sessions use Basic auth.
  if (config.SITE_PASSWORD) {
    const sitePassword = config.SITE_PASSWORD;
    const siteUser = config.SITE_USER;
    app.use((req, res, next) => {
      if (req.path === '/health/live' || req.path === '/health/ready') return next();
      const authorization = req.get('authorization') ?? '';
      let authorized = false;
      if (/^Basic\s+/i.test(authorization)) {
        const decoded = Buffer.from(authorization.replace(/^Basic\s+/i, ''), 'base64').toString('utf8');
        const separator = decoded.indexOf(':');
        if (separator >= 0) {
          const userOk = tokenMatches(decoded.slice(0, separator), siteUser);
          const passwordOk = tokenMatches(decoded.slice(separator + 1), sitePassword);
          authorized = userOk && passwordOk;
        }
      }
      if (!authorized && config.API_ACCESS_TOKEN && /^Bearer\s+/i.test(authorization)) {
        authorized = tokenMatches(authorization.replace(/^Bearer\s+/i, ''), config.API_ACCESS_TOKEN);
      }
      if (!authorized) {
        res.setHeader('WWW-Authenticate', 'Basic realm="Stragy", charset="UTF-8"');
        res.setHeader('Cache-Control', 'no-store');
        if (req.path.startsWith('/api/')) return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required.', requestId: res.locals.requestId, retryable: false } });
        return res.status(401).type('html').send('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Stragy · Authentication required</title></head><body style="margin:0;background:#101012;color:#ececec;font-family:Inter,system-ui,sans-serif;display:grid;min-height:100vh;place-items:center"><main style="max-width:32rem;padding:2rem"><h1 style="font-size:1.4rem;margin:0 0 .75rem">Stragy is private</h1><p style="color:#a1a1aa;line-height:1.6;margin:0">This research workspace requires the owner password. Your browser should show a sign-in prompt; reload after entering it.</p></main></body></html>');
      }
      res.locals.siteAuthenticated = true;
      next();
    });
  }
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString(), platform: 'Stragy research', mode: config.DATA_MODE }));
  app.use('/api', (req, _res, next) => {
    if (config.NODE_ENV === 'production' && config.EXPOSURE_MODE === 'private' && !_res.locals.siteAuthenticated) {
      const authorization = req.get('authorization') ?? '';
      const match = /^Bearer ([^\s]+)$/i.exec(authorization);
      const value = match?.[1] ?? '';
      if (!match || !config.API_ACCESS_TOKEN || !tokenMatches(value, config.API_ACCESS_TOKEN)) return next(new ApiFailure(401, 'UNAUTHORIZED', 'A private API access token is required.'));
    }
    // Same host is enough: a TLS-terminating tunnel can present https to the
    // browser while Express sees http. Cross-host writes still fail closed.
    const origin = req.get('origin');
    if (req.method !== 'GET' && origin) {
      let sameHost = false;
      try { sameHost = new URL(origin).host === req.get('host'); } catch { sameHost = false; }
      if (!sameHost && origin !== config.PUBLIC_ORIGIN) return next(new ApiFailure(403, 'ORIGIN_REJECTED', 'Cross-origin writes are not allowed.'));
    }
    const key = req.socket.remoteAddress ?? 'unknown', now = Date.now();
    const c = clients.get(key);
    if (!c || now - c.time >= 60_000) clients.set(key, { time: now, count: 1 });
    else if (++c.count > 90) return next(new ApiFailure(429, 'RATE_LIMITED', 'Request budget exceeded; retry after one minute.'));
    if (clients.size > 1024) clients.delete(clients.keys().next().value!);
    next();
  });
  // Chart screenshots need a larger route-scoped JSON body than the global API limit.
  const ChartAnalysisBody = z.object({ image: z.string().min(1), hint: z.string().max(1_000).optional(), currentStrategy: z.unknown().optional() }).strict();
  app.post('/api/v2/chart-analysis', express.json({ limit: '8mb' }), wrap(async (req, res) => {
    const p = parse(ChartAnalysisBody, req.body ?? {});
    let image;
    try { image = parseChartImageDataUrl(p.image); }
    catch (error) { if (error instanceof ChartImageError) throw new ApiFailure(error.status, error.code, error.message); throw error; }
    const current = p.currentStrategy === undefined ? undefined : executable(p.currentStrategy);
    // Two model passes can run for 200 s, far past the ~100 s origin ceiling a
    // proxied request survives (Cloudflare answers 524 first). The upload only
    // returns a job receipt; the client polls GET /api/v2/jobs/:id with short
    // requests and may DELETE that job to cancel.
    if (!deps.jobs) {
      if (config.NODE_ENV !== 'test') throw new ApiFailure(503, 'JOB_RUNNER_UNAVAILABLE', 'Chart analysis requires the bounded job runner.');
      res.json(await analyzeChart({ image, hint: p.hint, currentStrategy: current }));
      return;
    }
    const job = deps.jobs.enqueue({ kind: 'chart', image: image.dataUrl, hint: p.hint, currentStrategy: current }, req.get('Idempotency-Key'));
    res.status(202).json({ schemaVersion: 2, jobId: job.id, status: job.status });
  }));
  // === Voice: server-side speech-to-text fallback (Agent D) =====================
  // Browser SpeechRecognition is the primary path; this route is the server
  // fallback (Firefox, or when the browser API fails). Body parsing is
  // route-scoped because a 4 MB clip is ~5.4 MB of base64, far above the global
  // 256 KB API limit. The app-wide /api budget still applies; this adds a tighter
  // 10 requests/minute/IP budget around the free OpenRouter omni model.
  const voiceLimiter = createVoiceRateLimiter({ limit: 10, windowMs: 60_000 });
  app.get('/api/v2/voice/status', (_req, res) => {
    res.json({ configured: isVoiceConfigured(), model: VOICE_MODEL, free: true });
  });
  app.post('/api/v2/voice/transcribe', express.json({ limit: '10mb' }), wrap(async (req, res) => {
    if (!voiceLimiter.take(req.socket.remoteAddress ?? 'unknown')) {
      throw new ApiFailure(429, 'VOICE_RATE_LIMITED', 'Voice transcription is limited to 10 clips per minute. Wait a moment and try again.');
    }
    try { res.json(await transcribeAudio(req.body ?? {})); }
    catch (error) {
      if (error instanceof VoiceError) throw new ApiFailure(error.status, error.code, error.message, error.details);
      throw error;
    }
  }));
  // === end Voice ================================================================
  // === OpenCode engine (Agent B) ==============================================
  // The embedded OpenCode host is Stragy's chat backend: one SQLite database
  // under .data/opencode, one empty workspace, our provider registry as the
  // model catalog, and only our plugin tools. The origin/auth/rate middleware
  // above applies to every route here. Long work is 202 + SSE, never a blocking
  // request. See src/server/ai/engine*.ts.
  configureEngine({
    rootDir: process.env.STRAGY_ENGINE_DIR || path.join(process.cwd(), config.NODE_ENV === 'test' ? 'src/test/.tmp/engine-data' : '.data/opencode'),
    env: process.env,
    dataMode: config.DATA_MODE,
    jobs: deps.jobs,
    prepareBacktest: prepareRun,
    rememberRun: async result => { await remember(parseBacktestResult(result)); },
    repository,
  });
  // Writes .data/opencode/config/opencode.json at boot, never throws. A missing
  // provider key is reported by the routes as the typed ENGINE_UNAVAILABLE.
  await initializeEngine();
  // === Standalone OpenCode UI tool bridge =====================================
  // `opencode serve` hosts the chat UI in its own process. Its plugin cannot
  // own Stragy's jobs, candle cache or Angel session, so it calls these routes
  // on loopback and this process runs the same tool executors. The bridge is
  // loopback-only and, when STRAGY_TOOL_TOKEN is set, requires that token.
  const bridgeContexts = new EngineContextStore();
  const toolBridge = createToolBridge({
    preferencesFile: path.join(process.env.STRAGY_ENGINE_DIR || path.join(process.cwd(), config.NODE_ENV === 'test' ? 'src/test/.tmp/engine-data' : '.data/opencode'), 'tool-preferences.db'),
    getDeps: () => ({
      jobs: deps.jobs,
      dataMode: config.DATA_MODE,
      prepareBacktest: prepareRun,
      rememberRun: async result => { await remember(parseBacktestResult(result)); },
      repository,
      approvals: engineApprovals,
      contexts: bridgeContexts,
    }),
  });
  const toolToken = (process.env.STRAGY_TOOL_TOKEN ?? '').trim();
  const localToolRequest = (req: Request): boolean => {
    const address = req.socket.remoteAddress ?? '';
    const local = address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
    if (!local) return false;
    return toolToken ? req.get('x-stragy-tool-token') === toolToken : true;
  };
  app.get('/api/v2/engine/tools', wrap(async (req, res) => {
    if (!localToolRequest(req)) throw new ApiFailure(403, 'TOOL_BRIDGE_LOCAL_ONLY', 'The tool bridge is only reachable from this machine.');
    res.json({ tools: await toolBridge.list() });
  }));
  app.post('/api/v2/engine/tools/:name', express.json({ limit: '2mb' }), wrap(async (req, res) => {
    if (!localToolRequest(req)) throw new ApiFailure(403, 'TOOL_BRIDGE_LOCAL_ONLY', 'The tool bridge is only reachable from this machine.');
    const name = String(req.params.name ?? '');
    if (!/^[a-z][a-z0-9_]{1,60}$/.test(name)) throw new ApiFailure(400, 'TOOL_NAME_INVALID', 'That tool name is not valid.');
    const sessionId = String(req.get('x-stragy-session') ?? 'opencode-ui').slice(0, 120);
    const body = (req.body ?? {}) as { input?: unknown };
    const outcome = await toolBridge.run(name, body.input ?? {}, sessionId);
    res.status(outcome.status).json(outcome.body);
  }));
  const engineRoute = (handler: (req: Request, res: Response) => Promise<void> | void) => wrap(async (req, res) => {
    try { await handler(req, res); }
    catch (error) {
      if (error instanceof EngineError) throw new ApiFailure(error.status, error.code, error.message);
      if (error instanceof ApprovalError) throw new ApiFailure(error.status, error.code, error.message);
      if (error instanceof ChartImageError) throw new ApiFailure(error.status, error.code, error.message);
      throw error;
    }
  });
  const EngineSessionCreate = z.object({
    title: z.string().trim().max(200).optional(),
    model: z.object({ providerID: z.string().min(1).max(80), model: z.string().min(1).max(160) }).strict().optional(),
  }).strict();
  app.post('/api/v2/engine/sessions', express.json({ limit: '64kb' }), engineRoute(async (req, res) => {
    const body = parse(EngineSessionCreate, req.body ?? {});
    res.status(201).json(await createEngineSession(body));
  }));
  const EngineSessionListQuery = z.object({
    q: z.string().trim().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
  });
  app.get('/api/v2/engine/sessions', engineRoute(async (req, res) => {
    const query = parse(EngineSessionListQuery, req.query ?? {});
    res.json({ sessions: await listEngineSessions({ search: query.q, limit: query.limit }) });
  }));
  app.get('/api/v2/engine/status', (_req, res) => res.json({ ...engineStatus() }));
  // Session management. Every route uses the same auth/origin/rate middleware
  // above and the shared {success:false,error} envelope below.
  const EngineSessionId = z.string().trim().min(1).max(200);
  const EngineSessionRename = z.object({ title: z.string().trim().min(1).max(200) }).strict();
  app.patch('/api/v2/engine/sessions/:id', express.json({ limit: '16kb' }), engineRoute(async (req, res) => {
    const sessionId = parse(EngineSessionId, req.params.id);
    const body = parse(EngineSessionRename, req.body ?? {});
    res.json({ session: await renameEngineSession(sessionId, body.title) });
  }));
  app.delete('/api/v2/engine/sessions/:id', engineRoute(async (req, res) => {
    await deleteEngineSession(parse(EngineSessionId, req.params.id));
    res.json({ deleted: true });
  }));
  const EngineSessionModel = z.object({
    providerID: z.string().trim().min(1).max(80),
    model: z.string().trim().min(1).max(160),
  }).strict();
  app.post('/api/v2/engine/sessions/:id/model', express.json({ limit: '16kb' }), engineRoute(async (req, res) => {
    const sessionId = parse(EngineSessionId, req.params.id);
    const body = parse(EngineSessionModel, req.body ?? {});
    res.json({ session: await switchEngineSessionModel(sessionId, body) });
  }));
  const EngineExportQuery = z.object({ format: z.enum(['md', 'json']).default('md') });
  app.get('/api/v2/engine/sessions/:id/export', engineRoute(async (req, res) => {
    const sessionId = parse(EngineSessionId, req.params.id);
    const query = parse(EngineExportQuery, req.query ?? {});
    res.json(await exportEngineSession(sessionId, query.format));
  }));
  app.get('/api/v2/engine/models', engineRoute(async (_req, res) => {
    res.json(await listEngineModels());
  }));
  app.get('/api/v2/engine/usage', engineRoute(async (_req, res) => {
    res.json(await engineUsageReport());
  }));
  const EnginePromptBody = z.object({
    text: z.string().max(12_000).optional(),
    // A raw data URL (legacy) or the chat client's { dataUrl, mimeType, name }.
    image: z.union([
      z.string().min(1),
      z.object({ dataUrl: z.string().min(1), mimeType: z.string().max(100).optional(), name: z.string().max(200).optional() }).strict(),
    ]).optional(),
    hint: z.string().max(1_000).optional(),
    currentStrategy: z.unknown().optional(),
    screenContext: z.unknown().optional(),
    // The engine session already stores history; the field is accepted so the
    // existing client can send it, but it is never replayed twice.
    history: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(6_000) })).max(20).optional(),
  }).strict();
  app.post('/api/v2/engine/sessions/:id/messages', express.json({ limit: '8mb' }), engineRoute(async (req, res) => {
    const body = parse(EnginePromptBody, req.body ?? {});
    const sessionId = String(req.params.id);
    const text = (body.text ?? '').trim();
    if (!text && !body.image) throw new ApiFailure(422, 'ENGINE_EMPTY_MESSAGE', 'A message needs text or a chart image.');
    let currentStrategy;
    if (body.currentStrategy !== undefined) {
      const validated = validateStrategy(body.currentStrategy);
      if (!validated.success || !validated.data) throw new ApiFailure(422, 'INVALID_STRATEGY', 'The current strategy is invalid.', validated.errors);
      currentStrategy = validated.data;
    }
    let image;
    if (body.image) {
      const raw = typeof body.image === 'string' ? body.image : body.image.dataUrl;
      const imageName = typeof body.image === 'string' ? 'chart' : (body.image.name ?? 'chart');
      try { image = { ...parseChartImageDataUrl(raw), name: imageName, hint: body.hint, currentStrategy }; }
      catch (error) { if (error instanceof ChartImageError) throw new ApiFailure(error.status, error.code, error.message); throw error; }
    }
    await getEngineSession(sessionId);
    if (currentStrategy !== undefined || body.screenContext !== undefined) {
      stageContext(sessionId, { currentStrategy, screenContext: body.screenContext });
    }
    const receipt = await promptEngineSession(sessionId, { text: text || 'Analyze the attached chart.', ...(image ? { image } : {}) });
    res.status(202).json({ accepted: true, sessionId, ...(receipt.receiptId ? { receiptId: receipt.receiptId } : {}) });
  }));
  app.get('/api/v2/engine/sessions/:id/messages', engineRoute(async (req, res) => {
    res.json(await engineMessages(String(req.params.id)));
  }));
  app.get('/api/v2/engine/sessions/:id/events', engineRoute(async (req, res) => {
    const after = parse(z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER), req.query.after ?? 0);
    const sessionId = String(req.params.id);
    // Validate before writing SSE headers so a missing session is a JSON 404.
    await getEngineSession(sessionId);
    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();
    res.write(': connected\n\n');
    let unsubscribe: () => void = () => undefined;
    const heartbeat = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed */ } }, 15_000);
    heartbeat.unref?.();
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      clearInterval(heartbeat);
      unsubscribe();
    };
    req.on('close', cleanup);
    req.on('aborted', cleanup);
    try {
      unsubscribe = await openSessionStream(sessionId, after, event => {
        res.write('id: ' + event.seq + '\ndata: ' + JSON.stringify(event) + '\n\n');
      });
    } catch (error) {
      const message = error instanceof EngineError ? error.message : 'The engine event stream could not start.';
      try { res.write('event: error\ndata: ' + JSON.stringify({ seq: 0, type: 'error', error: message }) + '\n\n'); } catch { /* closed */ }
      cleanup();
      res.end();
    }
  }));
  app.post('/api/v2/engine/sessions/:id/interrupt', express.json({ limit: '16kb' }), engineRoute(async (req, res) => {
    res.json(await interruptEngineSession(String(req.params.id)));
  }));
  // Only this operator route mints a one-time approval token. The UI posts
  // either a gate id it reviewed or the reviewed assumptions themselves.
  const EngineApprovalBody = z.object({
    sessionId: z.string().min(1).max(200),
    approvalId: z.string().min(1).max(120).optional(),
    decision: z.enum(['approve', 'reject']).optional(),
    note: z.string().max(1_000).optional(),
    title: z.string().max(300).optional(),
    summary: z.array(z.string().max(500)).max(20).optional(),
    assumptions: z.object({
      strategy: z.unknown(),
      asOf: DateSchema,
      start: DateSchema,
      end: DateSchema,
      initialCapital: z.number().finite().min(100).max(1e9).optional(),
      summary: z.array(z.string().max(500)).max(20).optional(),
      title: z.string().max(300).optional(),
    }).passthrough().optional(),
  }).strict();
  app.post('/api/v2/engine/approvals', express.json({ limit: '128kb' }), engineRoute(async (req, res) => {
    const body = parse(EngineApprovalBody, req.body ?? {});
    await getEngineSession(body.sessionId);
    if (body.approvalId) {
      const existing = engineApprovals.get(body.approvalId);
      if (!existing) throw new ApiFailure(404, 'APPROVAL_NOT_FOUND', 'This approval request no longer exists. Ask the assistant to prepare it again.');
      if (existing.sessionId !== body.sessionId) throw new ApiFailure(403, 'APPROVAL_SESSION_MISMATCH', 'This approval belongs to a different session.');
      const decided = engineApprovals.decide(body.approvalId, body.decision ?? 'approve', body.note);
      res.json({
        approval: decided.approval,
        ...(decided.token ? { token: decided.token.token, expiresAt: new Date(decided.token.expiresAt).toISOString(), approvalId: decided.approval.id } : {}),
      });
      return;
    }
    if (body.assumptions) {
      if (body.decision === 'reject') throw new ApiFailure(422, 'APPROVAL_INPUT_REQUIRED', 'Rejections need the approval id from the engine gate.');
      const validated = validateStrategy(body.assumptions.strategy);
      if (!validated.success || !validated.data) throw new ApiFailure(422, 'INVALID_STRATEGY', 'The reviewed strategy is invalid.', validated.errors);
      const canonical = validated.canonicalData ? canonicalStrategyJSON(validated.canonicalData) : canonicalStrategyJSON(validated.data);
      const approved = engineApprovals.approveAssumptions({
        sessionId: body.sessionId,
        tool: 'run_backtest',
        assumptions: {
          strategy: canonical,
          ...(body.assumptions.asOf ? { asOf: body.assumptions.asOf } : {}),
          ...(body.assumptions.start ? { start: body.assumptions.start } : {}),
          ...(body.assumptions.end ? { end: body.assumptions.end } : {}),
          ...(body.assumptions.initialCapital !== undefined ? { initialCapital: body.assumptions.initialCapital } : {}),
        },
        title: body.assumptions.title ?? body.title,
        summary: body.assumptions.summary ?? body.summary,
        note: body.note,
      });
      res.json({
        approval: approved.approval,
        token: approved.token.token,
        expiresAt: new Date(approved.token.expiresAt).toISOString(),
        approvalId: approved.approval.id,
      });
      return;
    }
    throw new ApiFailure(422, 'APPROVAL_INPUT_REQUIRED', 'Provide an approvalId or the reviewed backtest assumptions.');
  }));
  // === end OpenCode engine =====================================================

  // === Provider status (auth required; no login calls, no secrets) ============
  // The System panel reads this. engine.modelChain is the exact configured
  // allow-list; market.rate is the process-local Angel pacing/backoff counters.
  app.get('/api/v2/providers', wrap(async (_req, res) => {
    const status = engineStatus();
    const catalog = configuredEngineModels();
    const engine = {
      ready: status.ready,
      hostStarted: status.hostStarted,
      defaultModel: status.defaultModel,
      models: catalog.models,
      modelChain: catalog.models,
      warnings: status.warnings,
      ...(status.error ? { error: status.error } : {}),
    };
    const credentials = getAngelCredentialStatus();
    const session = getAngelSessionInfo();
    res.json({
      ai: engine,
      engine,
      market: {
        configured: credentials.configured,
        connected: session.connected,
        credentials,
        session: { ...session, ...(session.lastError ? { lastError: redact(session.lastError) } : {}) },
        rate: getAngelDebugMetrics(),
      },
      voice: { configured: isVoiceConfigured(), model: VOICE_MODEL, free: true },
    });
  }));

  // === Market candle cache (Agent F data layer; routes wired by E) ============
  // GET is a pure read: stats come from SQLite, no provider call. The refresh
  // route queues the cache-first job; the worker calls runMarketCacheRefresh so
  // the API never blocks on a cold download.
  app.get('/api/v2/market/cache', wrap(async (_req, res) => {
    res.json({ stats: getMarketCacheStats() });
  }));
  const CacheRefreshBody = z.object({
    universe: z.string().trim().max(40).optional(),
    symbolIds: z.array(z.number().int().positive().max(1_000_000_000)).max(500).optional(),
    maxSymbols: z.number().int().min(1).max(500).optional(),
  }).strict();
  app.post('/api/v2/market/cache/refresh', express.json({ limit: '64kb' }), wrap(async (req, res) => {
    if (!deps.jobs) throw new ApiFailure(503, 'JOB_RUNNER_UNAVAILABLE', 'The bounded job runner is required to refresh market data.');
    const body = parse(CacheRefreshBody, req.body ?? {});
    // The manager dedupes an identical active cache job by payload hash, so a
    // double-click can never start a second cold download.
    const job = deps.jobs.enqueue({
      kind: 'cache',
      ...(body.universe ? { universe: body.universe } : {}),
      ...(body.symbolIds?.length ? { symbolIds: body.symbolIds } : {}),
      ...(body.maxSymbols !== undefined ? { maxSymbols: body.maxSymbols } : {}),
    }, req.get('Idempotency-Key'));
    res.status(202).json({ jobId: job.id, status: job.status });
  }));
  // === end market candle cache ===============================================

  app.use(express.json({ limit: config.MAX_BODY_BYTES }));  app.get('/api/v2/capabilities', wrap(async (_req, res) => res.json({ schemaVersion: 2, mode: config.DATA_MODE, demo: config.DATA_MODE === 'demo', engineVersion: 'stragy-next-open-v2', executionPolicy: 'next_open_long_cash_v1', timeframes: ['1D'], directions: ['LONG'], orders: ['MARKET'], liveTrading: false, realDataConfigured: ['yahoo', 'angel'].includes(config.MARKET_PROVIDER), marketProvider: config.MARKET_PROVIDER, quotesProvider: config.QUOTES_PROVIDER, liveQuotes: config.QUOTES_PROVIDER === 'angel', dataDescription: config.DATA_MODE === 'real' ? (config.MARKET_PROVIDER === 'angel' ? 'Angel One SmartAPI broker daily candles and live quotes (read-only), with provenance' : config.QUOTES_PROVIDER === 'angel' ? 'Delayed/end-of-day observed daily bars plus live Angel One quotes, labeled separately' : 'Observed public daily OHLCV, delayed/end-of-day, not exchange tick streaming') : 'Generated demo data', persistence: config.STORAGE_MODE, jobs: !!deps.jobs, ai: getAIStatus(), limitations: ['Real data entitlement, instrument metadata, calendars, and fee schedules require verification.', 'Research only. No broker orders are submitted.', 'Angel One redistribution terms apply to any public display of broker data.'] })));
  app.get('/api/symbols', wrap(async (_req, res) => {
    if (config.DATA_MODE === 'demo') return res.json({ success: true, symbols: ALL_SYMBOLS, mode: 'demo', membershipBasis: 'illustrative' });
    try {
      const membership = await resolveSymbolMembership();
      const symbols = [...ALL_SYMBOLS.filter(s => s.ticker.startsWith('^')), ...membership.symbols];
      const official = membership.verified !== undefined
        ? membership.verified
        : (membership.basis ?? (membership.source === 'https://nsearchives.nseindia.com/content/indices/ind_nifty50list.csv' ? 'official-feed' : 'bundled-catalog')) === 'official-feed';
      res.json({
        success: true,
        symbols,
        mode: 'real',
        membershipBasis: official ? 'official-current-feed; historical survivorship bias' : 'bundled-catalog; official NIFTY 50 membership unverified',
        membership: { source: membership.source, observedAt: membership.observedAt, requested: membership.requested, unmapped: membership.unmapped, basis: membership.basis, verified: membership.verified, warnings: membership.warnings },
        ...(official ? {} : { warning: 'Official NIFTY 50 membership could not be loaded; showing the bundled configured catalog. Membership-dependent labels are unverified until the feed recovers.' }),
        referencePricesObserved: false
      });
    } catch {
      // Last resort: identifiers, not membership evidence. Scans that require the
      // official feed still fail honestly; chat can resolve a ticker immediately.
      const bundled = filterSymbolsByUniverse('NIFTY_50').map(symbol => ({ ...symbol }));
      const symbols = [...ALL_SYMBOLS.filter(s => s.ticker.startsWith('^')), ...bundled];
      res.json({
        success: true,
        symbols,
        mode: 'real',
        membershipBasis: 'bundled-catalog-fallback; official NIFTY 50 membership unavailable',
        membership: { source: 'BUNDLED_INSTRUMENT_CATALOG', observedAt: null, requested: 50, unmapped: [], unavailable: true },
        referencePricesObserved: false,
        warning: 'Official NIFTY 50 membership could not be loaded; showing bundled instrument ids only. Membership-dependent scans will report unavailable until the feed recovers.'
      });
    }
  }));
  app.get('/api/symbols/:id/bars', wrap(async (req, res) => { const id = parse(IdSchema, req.params.id); const series = await loadMarketSeries(id, { asOf: parse(DateSchema, req.query.date), mode: config.DATA_MODE }); res.json({ success: true, symbol: getSymbolById(id), count: series.bars.length, ...series }); }));
  app.get('/api/strategy/templates', (_req, res) => res.json({ success: true, templates: STRATEGY_TEMPLATES }));
  app.get('/api/patterns', (_req, res) => res.json({ success: true, patterns: PATTERN_LIBRARY, method: 'local_reference' }));
  app.get('/api/smartapi/status', wrap(async (_req, res) => res.json({ success: true, ...await getSmartApiStatus() })));
  app.get('/api/v2/quotes', wrap(async (req, res) => {
    const query = parse(z.object({ symbolIds: z.string().trim().min(1).max(160) }), req.query);
    const parts = query.symbolIds.split(',').map(part => part.trim()).filter(Boolean);
    if (!parts.length || parts.length > 10 || parts.some(part => !/^\d{1,9}$/.test(part))) throw new ApiFailure(422, 'VALIDATION_FAILED', 'symbolIds must be 1 to 10 comma-separated positive integer ids.', [{ path: 'symbolIds', message: 'Expected e.g. symbolIds=1,9' }]);
    const ids = [...new Set(parts.map(Number))];
    const symbols = ids.map(id => getSymbolById(id));
    const result = await getLiveQuotes(ids);
    res.json({
      success: true,
      ...result,
      labels: symbols.map(symbol => ({ symbolId: symbol.id, ticker: symbol.ticker, name: symbol.name, exchange: symbol.exchange }))
    });
  }));
  app.get('/api/smartapi/rate-limits', (_req, res) => res.json({ success: true, ...getSmartApiRateLimitsAndSpecs() }));
  app.get('/api/market/universes', (_req, res) => res.json({ success: true, universes: UNIVERSE_OPTIONS }));
  app.get('/api/market/dates', wrap(async (_req, res) => { await loadMarketSeries(NSE_SYMBOLS[0].id,{mode:config.DATA_MODE});const dates = getAvailableTradingDates(250); res.json({ success: true, count: dates.length, dates, mode: config.DATA_MODE, warning: 'Calendar sessions are not evidence of observed price availability for every symbol.' }); }));
  app.get('/api/market/calendar', wrap(async (req, res) => { const requested = parse(DateSchema, req.query.date); await loadMarketSeries(NSE_SYMBOLS[0].id,{mode:config.DATA_MODE});const dates = getAvailableTradingDates(250), resolved = findNearestTradingDate(requested); res.json({ success: true, totalSessions: dates.length, minDate: dates.at(-1)?.date, maxDate: dates[0]?.date, latestSessionDate: dates[0]?.date, latestSessionLabel: dates[0]?.fullLabel, requestedDate: requested ?? dates[0]?.date, ...resolved, tradingDates: dates }); }));
  async function waitResult(id: string, timeoutMs = config.MAX_JOB_MS + 5000): Promise<unknown> {
    const deadline = Date.now() + timeoutMs;
    for (;;) { const job = deps.jobs?.get(id); if (!job) throw new ApiFailure(404, 'JOB_NOT_FOUND', 'Job expired.'); if (job.status === 'succeeded') return job.result; if (['failed','cancelled'].includes(job.status)) throw new ApiFailure(422, 'JOB_FAILED', 'Research job did not complete.', job.error); if (Date.now() > deadline) throw new ApiFailure(504, 'JOB_TIMEOUT', 'Research deadline exceeded.'); await new Promise(r => setTimeout(r, 30)); }
  }
  function checkedUniverse(raw: string): string { const normalized = ({ NIFTY50: 'NIFTY_50', BANKNIFTY: 'BANK_NIFTY', INDICES: 'POPULAR_INDICES' } as Record<string,string>)[raw.toUpperCase()] ?? raw.toUpperCase(); if (!UNIVERSE_OPTIONS.some(u => u.id === normalized)) throw new ApiFailure(422, 'UNKNOWN_UNIVERSE', 'Unknown universe.'); return normalized; }
  const marketCache = new Map<string, {time:number;ttl:number;value:Promise<MarketSnapshot>}>();
  async function trendsFor(rawUniverse: string, date?: string): Promise<MarketSnapshot> {
    const universe = checkedUniverse(rawUniverse), key = universe + ':' + (date ?? 'latest');
    const existing = marketCache.get(key); if (existing && Date.now() - existing.time < existing.ttl) return existing.value;
    const value = (async () => { if (deps.jobs) return await waitResult(deps.jobs.enqueue({kind:'market',universe,asOf:date,mode:config.DATA_MODE}).id, SCAN_HARD_CAP_MS + 5_000) as MarketSnapshot; if (config.NODE_ENV !== 'test') throw new ApiFailure(503,'JOB_RUNNER_UNAVAILABLE','Bounded market worker is required.'); return buildMarketSnapshot(universe,date,config.DATA_MODE); })();
    marketCache.set(key,{time:Date.now(),ttl:300000,value});
    while(marketCache.size>5)marketCache.delete(marketCache.keys().next().value!);
    value.then(snapshot=>{
      // Never serve a dead-end or deadline-truncated snapshot from cache: a retry
      // must be able to reach the provider again.
      const ttl = snapshot.status === 'complete' ? 300000 : snapshot.status === 'partial' && !snapshot.deadline?.truncated ? 60000 : 0;
      const entry = marketCache.get(key);
      if (!entry || entry.value !== value) return;
      if (ttl <= 0) marketCache.delete(key); else { entry.time = Date.now(); entry.ttl = ttl; }
    },()=>{if(marketCache.get(key)?.value===value)marketCache.delete(key);});
    return value;
  }
  app.post('/api/v2/market-snapshots', wrap(async(req,res)=>{if(!deps.jobs)throw new ApiFailure(503,'JOB_RUNNER_UNAVAILABLE','Market worker unavailable.');const p=parse(z.object({universe:z.string().max(40),asOf:DateSchema}),req.body);const job=deps.jobs.enqueue({kind:'market',universe:checkedUniverse(p.universe),asOf:p.asOf,mode:config.DATA_MODE},req.get('Idempotency-Key'));res.status(202).json({schemaVersion:2,jobId:job.id,status:job.status});}));
  app.get('/api/market/trends', wrap(async (req, res) => { const universe = parse(z.string().max(40), req.query.universe ?? 'ALL'); const date = parse(DateSchema, req.query.date); const data = await trendsFor(universe, date); res.json({ success: true, ...data, count: data.trends.length, date: data.trends[0]?.date ?? date, formattedDate: data.trends[0]?.formattedDate ?? date, isHistorical: !!date, mode: config.DATA_MODE }); }));
  app.get('/api/market/movers', wrap(async (req, res) => { const universe = parse(z.string().max(40), req.query.universe ?? 'ALL'); const date = parse(DateSchema, req.query.date); const data = await trendsFor(universe, date); res.json({ success: true, ...calculateMarketMovers(data.trends, universe, date), coverage: data.coverage, errors: data.errors, provenance: data.provenance, requestedDate: date, mode: config.DATA_MODE, status: data.status, statusReason: data.statusReason, recommendations: data.recommendations, retryable: data.retryable, warnings: data.warnings, membership: data.membership, deadline: data.deadline, progress: data.progress }); }));
  app.post('/api/market/refresh', (_req, _res, next) => next(new ApiFailure(503, 'REFRESH_UNAVAILABLE', 'No verified production provider is configured. Demo data is immutable.')));
  const optionChain = wrap(async (req, res) => { const symbolId = parse(IdSchema, req.query.symbolId ?? 2); res.json({ success: true, ...getOptionChainData(symbolId), mode: config.DATA_MODE, model: true }); });
  app.get('/api/derivatives/option-chain', optionChain); app.get('/api/market/option-chain', optionChain);
  app.get('/api/market/volume-profile', wrap(async (req, res) => res.json({ success: true, ...getVolumeProfileAndVWAP(parse(IdSchema, req.query.symbolId ?? 4)), mode: config.DATA_MODE, model: true })));
  app.get('/api/market/basis-spreads', wrap(async (_req, res) => { const spreads = getBasisAndCalendarSpreads(); res.json({ success: true, count: spreads.length, spreads, mode: config.DATA_MODE, model: true }); }));
  // Default preview symbol: RELIANCE (catalog id 9) is present in SMARTAPI_TOKEN_MAP.
  app.post('/api/orders/gtt-bracket', wrap(async (req, res) => { const p = parse(z.object({ symbolId: IdSchema.default(9), action: z.enum(['BUY', 'SELL']).default('BUY'), capitalAllocated: z.number().positive().max(1e8).default(100000), riskPct: z.number().positive().max(50).default(1.5), rewardRatio: z.number().positive().max(20).default(2.5), trailPct: z.number().positive().max(50).default(0.5) }), req.body ?? {}); res.json({ success: true, ...calculateGttBracketOrder(p.symbolId, p.action, p.capitalAllocated, p.riskPct, p.rewardRatio, p.trailPct), previewOnly: true, mode: config.DATA_MODE }); }));
  async function remember(result: BacktestResponse) { await repository.putRun(result); }
  async function prepareRun(body: unknown) {
    const raw = body as Record<string, unknown>;
    const p = parse(BacktestRequest, raw && typeof raw === 'object' && 'strategy' in raw ? raw : { strategy: body });
    const strategy = executable(p.strategy);
    const { validateRequestWindow, resolveRequestWindow } = await import('./backtest/requestWindow');
    validateRequestWindow(p);
    // Do not filter start here: permitted pre-start bars are indicator warmup only.
    // The loader still enforces end/asOf and the latest completed-session cutoff.
    const data = await loadMarketSeries(strategy.universe.symbolId, { mode: config.DATA_MODE, end: p.end, asOf: p.asOf });
    const window = resolveRequestWindow(data, p);
    return { strategy, bars: data.bars, provenance: window.provenance, options: { ...window.options, initialCapital: p.initialCapital, seed: p.seed, robustness: p.robustness } };
  }
  async function runPrepared(payload: Awaited<ReturnType<typeof prepareRun>>, key?: string) {
    let result: BacktestResponse;
    if (deps.jobs) { const job = deps.jobs.enqueue(payload, key); const deadline = Date.now() + config.MAX_JOB_MS + 5_000; for (;;) { const current = deps.jobs.get(job.id); if (!current) throw new ApiFailure(404, 'JOB_NOT_FOUND', 'Job expired.'); if (current.status === 'succeeded' && current.result) { result = parseBacktestResult(current.result); break; } if (['failed', 'cancelled'].includes(current.status)) throw new ApiFailure(422, current.status === 'cancelled' ? 'JOB_CANCELLED' : 'JOB_FAILED', 'Research job did not complete.', current.error); if (Date.now() > deadline) throw new ApiFailure(504, 'JOB_TIMEOUT', 'Research job timed out.'); await new Promise(r => setTimeout(r, 30)); } }
    else { if (config.NODE_ENV !== 'test') throw new ApiFailure(503, 'JOB_RUNNER_UNAVAILABLE', 'Bounded job runner is required.'); result = runBacktest(payload.strategy, payload.bars, payload.options); }
    const withManifest = Object.assign(result, { provenance: payload.provenance, manifest: result.manifest ?? { schemaVersion: 2, sourceCommit: sourceCommit(), engineVersion: 'stragy-next-open-v2', executionPolicy: 'next_open_long_cash_v1', strategy: payload.strategy, data: payload.provenance, options: payload.options, limitations: ['Fee schedules are approximate until independently verified.', 'Long-only daily cash-funded market-order research.'] } }); await remember(withManifest); return withManifest;
  }
  app.post('/api/backtests', wrap(async (req, res) => { const result = await runPrepared(await prepareRun(req.body), req.get('Idempotency-Key')); res.json({ success: true, backtestId: result.backtestId, metrics: result.metrics, tradesCount: result.trades.length, result }); }));
  app.post('/api/v2/backtests', wrap(async (req, res) => { if (!deps.jobs) throw new ApiFailure(503, 'JOB_RUNNER_UNAVAILABLE', 'Job runner is unavailable.'); const payload = await prepareRun(req.body); const job = deps.jobs.enqueue(payload, req.get('Idempotency-Key')); res.status(202).json({ schemaVersion: 2, jobId: job.id, status: job.status }); }));
  const JobListQuery = z.object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted']).optional(),
  });
  // History only: summaries never include a result payload. GET /:id below
  // remains the full (bounded) record for a single job.
  app.get('/api/v2/jobs', wrap(async (req, res) => {
    if (!deps.jobs?.listSummaries) throw new ApiFailure(503, 'JOB_RUNNER_UNAVAILABLE', 'Job history is unavailable.');
    const query = parse(JobListQuery, req.query ?? {});
    res.json({ jobs: deps.jobs.listSummaries({ limit: query.limit, status: query.status }) });
  }));
  app.get('/api/v2/jobs/:id', wrap(async (req, res) => { const job = deps.jobs?.get(req.params.id); if (!job) throw new ApiFailure(404, 'JOB_NOT_FOUND', 'Job not found.'); if (job.status === 'succeeded' && !job.result) throw new ApiFailure(500, 'INTERNAL_ERROR', 'The computation worker did not return a result.'); if (job.status === 'succeeded' && job.result && (!job.kind || job.kind === 'backtest')) await remember(parseBacktestResult(job.result)); res.json(job); }));
  app.delete('/api/v2/jobs/:id', wrap(async (req, res) => { if (!deps.jobs?.get(req.params.id)) throw new ApiFailure(404, 'JOB_NOT_FOUND', 'Job not found.'); res.json(deps.jobs.cancel(req.params.id)); }));
  // --- Durable job resume (Agent A) ----------------------------------------
  // A job interrupted by a restart keeps its id and stored payload. Resume
  // re-enqueues it in its own lane; only `interrupted` jobs qualify (409).
  // The origin/auth/rate middleware above applies to this POST like any other.
  app.post('/api/v2/jobs/:id/resume', wrap(async (req, res) => {
    if (!deps.jobs?.resume) throw new ApiFailure(503, 'JOB_RUNNER_UNAVAILABLE', 'Job resume is unavailable.');
    res.json(deps.jobs.resume(req.params.id));
  }));
  const getRun = wrap(async (req, res) => { const result = repository.getRun(req.params.id); if (!result) throw new ApiFailure(404, 'BACKTEST_NOT_FOUND', 'Backtest not found or expired.'); res.json({ success: true, result }); }); app.get('/api/backtests/:id', getRun); app.get('/api/v2/backtests/:id', getRun);
  async function scanPayload(body:unknown) { const p=parse(ScanRequest,body);return {kind:'scan' as const,strategy:executable(p.strategy??p.strategyJson??STRATEGY_TEMPLATES[0].strategy),universe:checkedUniverse(p.universe),asOf:p.asOf??p.date,mode:config.DATA_MODE,limit:p.limit}; }
  const scan = wrap(async(req,res)=>{const payload=await scanPayload(req.body);const result=deps.jobs?await waitResult(deps.jobs.enqueue(payload,req.get('Idempotency-Key')).id, SCAN_HARD_CAP_MS + 5_000):config.NODE_ENV==='test'?await scanUniverseAsync(payload.strategy,payload.universe,{asOf:payload.asOf,mode:payload.mode,limit:payload.limit}):undefined;if(!result)throw new ApiFailure(503,'JOB_RUNNER_UNAVAILABLE','Bounded scan worker required.');res.json({success:true,...result as object});});app.post('/api/scan',scan);app.post('/api/market/scan',scan);
  app.post('/api/v2/scans',wrap(async(req,res)=>{if(!deps.jobs)throw new ApiFailure(503,'JOB_RUNNER_UNAVAILABLE','Scan worker unavailable.');const job=deps.jobs.enqueue(await scanPayload(req.body),req.get('Idempotency-Key'));res.status(202).json({schemaVersion:2,jobId:job.id,status:job.status});}));
  app.get('/api/ai/status', (_req, res) => res.json({ success: true, ...getAIStatus() }));
  const promptInput = z.object({ prompt: z.string().min(1).max(4000), symbolId: IdSchema.optional() });
  app.post('/api/ai/parse-strategy', wrap(async (req, res) => { const p = parse(promptInput, req.body); res.json({ success: true, ...await parseStrategyPrompt(p.prompt, p.symbolId ?? 1) }); }));
  app.post('/api/ai/apply-edit', wrap(async (req, res) => { const p = parse(z.object({ strategy: z.unknown(), instruction: z.string().min(1).max(4000) }), req.body); res.json({ success: true, ...applyStrategyEdit(executable(p.strategy), p.instruction) }); }));
  app.post('/api/ai/optimize', (_req, _res, next) => next(new ApiFailure(503, 'OPTIMIZER_WORKER_REQUIRED', 'Legacy optimization is disabled. Review a draft proposal and run bounded research explicitly.')));
  app.post('/api/v2/ai/proposals', wrap(async (req, res) => { const p = parse(z.object({ prompt: z.string().min(1).max(4000), currentStrategy: z.unknown().optional(), originatingRevision: z.union([z.number().int().nonnegative(), z.string().max(100)]).optional(), allowLocalFallback: z.boolean().default(false), history: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(4000) })).max(20).optional() }), req.body); const input = { ...p, currentStrategy: p.currentStrategy ? executable(p.currentStrategy) : undefined }; const result = await createProposal(input); res.status(result.ok ? 200 : 422).json(result); }));
  app.post('/api/v2/feature-setup', wrap(async (req, res) => res.json(resolveFeatureSetup(req.body))));


  const providerRoute = (handler: (req: Request, res: Response) => Promise<void> | void) => wrap(async (req, res) => {
    try { await handler(req, res); }
    catch (error) {
      if (error instanceof ProviderError) throw new ApiFailure(error.status, error.code, error.message);
      if (error instanceof z.ZodError) throw new ApiFailure(400, 'INVALID_REQUEST', error.issues.map(issue => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; '));
      throw error;
    }
  });
  app.get('/api/v2/ai/providers', providerRoute(async (_req, res) => { res.json(getProvidersResponse()); }));
  app.post('/api/v2/ai/providers', providerRoute(async (req, res) => { res.status(201).json({ provider: await upsertProvider(req.body) }); }));
  app.put('/api/v2/ai/providers/:id', providerRoute(async (req, res) => { res.json({ provider: await upsertProvider({ ...req.body, id: req.params.id }) }); }));
  app.delete('/api/v2/ai/providers/:id', providerRoute(async (req, res) => { await deleteProvider(req.params.id); res.status(204).end(); }));
  app.get('/api/v2/ai/providers/:id/models', providerRoute(async (req, res) => { res.json({ models: await listProviderModels(req.params.id) }); }));
  app.post('/api/v2/ai/providers/:id/test', providerRoute(async (req, res) => { res.json(await testProvider(req.params.id, req.body)); }));
  app.put('/api/v2/ai/chain', providerRoute(async (req, res) => { res.json(await setChain(req.body)); }));
  app.post('/api/v2/ai/reset', providerRoute(async (_req, res) => { res.json(await resetProviders()); }));
  app.post('/api/ai/scan-live', (_req, _res, next) => next(new ApiFailure(422, 'EXPLICIT_SCAN_REQUIRED', 'Build or select a validated strategy and request a scan explicitly.')));
  app.get('/api/web/search', (req, res) => { const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 200) : ''; const pattern = PATTERN_LIBRARY.find(p => p.keywords.some(k => q.toLowerCase().includes(k))); res.json({ query: q, method: 'local_reference', source: 'Bundled pattern library, not web search', abstract: pattern?.summary ?? 'No matching local reference.', details: pattern?.description ?? '', family: pattern?.family }); });
  app.get('/api/strategies', (_req, res) => res.json({ success: true, strategies: repository.listStrategies().map(r => ({ ...r.strategy, savedRevision: r.revision })), persistence: config.STORAGE_MODE }));
  app.post('/api/strategies', wrap(async (req, res) => { if (config.EXPOSURE_MODE !== 'private') throw new ApiFailure(403, 'PRIVATE_WRITE_REQUIRED', 'Server saves are disabled on the public service. Use My Strategies or local export.'); const body = req.body; const record = await repository.saveStrategy(body?.strategy ?? body, body?.expectedRevision); res.status(201).json({ success: true, id: record.id, revision: record.revision, strategy: record.strategy, persistence: config.STORAGE_MODE }); }));
  app.get('/api/v2/runs', (_req, res) => res.json({ runs: repository.listRuns(), persistence: config.STORAGE_MODE }));
  app.all('/api/*', (_req, _res, next) => next(new ApiFailure(404, 'ROUTE_NOT_FOUND', 'API route not found.')));
  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith('/api')) return next(err);
    const bodyError = err as { type?: string; status?: number };
    const status = err instanceof ApiFailure || err instanceof JobError || err instanceof StorageError ? err.status : err instanceof UnknownSymbolError || err instanceof SimulationInputError ? 422 : err instanceof MarketDataError ? (/^(UNKNOWN|INVALID|OUT_OF_COVERAGE)/.test(err.code) ? 422 : 503) : bodyError.type === 'entity.too.large' ? 413 : bodyError.type === 'entity.parse.failed' ? 400 : 500;
    const code = err instanceof ApiFailure || err instanceof UnknownSymbolError || err instanceof MarketDataError || err instanceof JobError || err instanceof StorageError || err instanceof SimulationInputError ? err.code : status === 413 ? 'BODY_TOO_LARGE' : status === 400 ? 'MALFORMED_JSON' : 'INTERNAL_ERROR';
    const rateLimited = err instanceof MarketDataError && err.code === 'PROVIDER_RATE_LIMITED';
    const membershipMessage = plainScanFailure(code, err instanceof Error ? err.message : undefined, (req.body as { universe?: string } | undefined)?.universe);
    const message = membershipMessage ?? (rateLimited ? ANGEL_RATE_LIMIT_MESSAGE : err instanceof ApiFailure || err instanceof UnknownSymbolError || err instanceof MarketDataError || err instanceof JobError || err instanceof StorageError || err instanceof SimulationInputError ? redact(err.message) : status === 500 ? 'Internal request error.' : 'Invalid request body.');
    res.status(status).json({ success: false, error: { code, message, requestId: res.locals.requestId, retryable: [429, 503, 504].includes(status), ...(err instanceof ApiFailure && err.details ? { fieldErrors: err.details } : {}) } });
  });
  app.use((req, res, next) => { if (/\.(?:cjs|map)$|(?:^|\/)\.env|(?:^|\/)server(?:\/|\.)/i.test(req.path)) return res.status(404).end(); next(); });
  if (deps.enableVite && config.NODE_ENV !== 'production') { const { createServer } = await import('vite'); const vite = await createServer({ configLoader: 'native', server: { middlewareMode: true }, appType: 'spa' }); app.use(vite.middlewares); }
  else if (config.NODE_ENV === 'production') { const client = path.join(process.cwd(), 'dist/client'); app.use(express.static(client, { dotfiles: 'deny', index: false })); app.get('*', (_req, res) => res.sendFile(path.join(client, 'index.html'))); }
  return app;
}
