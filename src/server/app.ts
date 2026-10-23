import express, { type Request, type Response, type NextFunction } from 'express';
import path from 'node:path';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { parseConfig, redact, type RuntimeConfig } from './config';
import { sourceCommit } from './buildInfo';
import { ALL_SYMBOLS, NSE_SYMBOLS, UNIVERSE_OPTIONS, filterSymbolsByUniverse, getSymbolById } from './data/symbols';
import { loadMarketSeries, getAvailableTradingDates, findNearestTradingDate, MarketDataError } from './data/realMarketData';
import { calculateStockTrends, calculateMarketMovers, getSmartApiStatus, getSmartApiRateLimitsAndSpecs, getOptionChainData, getVolumeProfileAndVWAP, calculateGttBracketOrder, getBasisAndCalendarSpreads } from './data/smartApi';
import { scanUniverse } from './backtest/scanner';
import { runBacktest } from './backtest/engine';
import { STRATEGY_TEMPLATES } from '../shared/strategy/templates';
import { validateStrategy } from '../shared/strategy/schema';
import { PATTERN_LIBRARY } from './ai/patterns';
import { createProposal, getAIStatus, handleAIChat, parseStrategyPrompt, applyStrategyEdit, optimizeStrategyForProfitability } from './ai/copilot';
import { ResearchRepository, StorageError } from './storage/repository';
import { JobError, type ResearchPayload } from './jobs/manager';
import { buildMarketSnapshot, type MarketSnapshot } from './backtest/marketSnapshot';
import { scanUniverseAsync } from './backtest/scanner';
import { parseBacktestResult } from '../shared/contracts/research';
import { SimulationInputError } from './backtest/engine';
import type { BacktestResponse, StrategyAST } from '../shared/strategy/types';
import { researchChat } from './ai/researchChat';
import { resolveObservedUniverse } from './data/observedUniverse';

export class ApiFailure extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}
const IdSchema = z.coerce.number().int().positive();
const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();
const BacktestRequest = z.object({ strategy: z.unknown(), initialCapital: z.number().finite().min(100).max(1e9).optional(), start: DateSchema, end: DateSchema, asOf: DateSchema, seed: z.number().int().min(0).max(0xffffffff).optional(), robustness: z.boolean().optional() });
const ScanRequest = z.object({ universe: z.string().max(40).default('NIFTY_50'), strategyJson: z.unknown().optional(), strategy: z.unknown().optional(), limit: z.number().int().min(1).max(100).default(35), date: DateSchema, asOf: DateSchema });
export interface JobView { id: string; status: string; kind?: string; result?: unknown; error?: unknown; }
export interface AppJobService { enqueue: (payload: ResearchPayload, key?: string) => JobView; get: (id: string) => JobView | undefined; cancel: (id: string) => unknown; shutdown?: () => Promise<void>; }
export interface AppDependencies { config?: RuntimeConfig; enableVite?: boolean; jobs?: AppJobService; repository?: ResearchRepository; }
function parse<T>(schema: z.ZodType<T>, input: unknown): T { const r = schema.safeParse(input); if (!r.success) throw new ApiFailure(422, 'VALIDATION_FAILED', 'Input validation failed', r.error.issues.map(i => ({ path: i.path.join('.'), message: i.message }))); return r.data; }
function executable(raw: unknown): StrategyAST { const r = validateStrategy(raw); if (!r.success || !r.data) throw new ApiFailure(422, 'INVALID_STRATEGY', 'Strategy is invalid or unsupported', r.errors); return r.data; }
function tokenMatches(actual: string, expected: string): boolean { const a = Buffer.from(actual), b = Buffer.from(expected); return a.length === b.length && timingSafeEqual(a, b); }
const wrap = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) => { Promise.resolve().then(() => fn(req, res)).catch(next); };

export async function createApp(deps: AppDependencies = {}) {
  const config = deps.config ?? parseConfig();
  process.env.DATA_MODE = config.DATA_MODE;
  process.env.AI_PROVIDER = config.AI_PROVIDER;
  process.env.MARKET_PROVIDER = config.MARKET_PROVIDER;
  process.env.AI_COST_POLICY = config.AI_COST_POLICY;
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  
  const repository = deps.repository ?? await ResearchRepository.open({ maxRuns: config.MAX_STORED_RUNS });
  const clients = new Map<string, { time: number; count: number }>();
  app.use((req, res, next) => {
    res.locals.requestId = randomUUID(); res.setHeader('X-Request-ID', res.locals.requestId);
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Frame-Options', 'DENY');
    if (config.NODE_ENV === 'production') res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
    next();
  });
  app.get('/health/live', (_req, res) => res.json({ status: 'ok' }));
  app.get('/health/ready', (_req, res) => res.json({ status: 'ready', mode: config.DATA_MODE, persistence: config.STORAGE_MODE }));
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString(), platform: 'Stragy research', mode: config.DATA_MODE }));
  app.use('/api', (req, _res, next) => {
    if (config.NODE_ENV === 'production' && config.EXPOSURE_MODE === 'private') {
      const authorization = req.get('authorization') ?? '';
      const match = /^Bearer ([^\s]+)$/i.exec(authorization);
      const value = match?.[1] ?? '';
      if (!match || !config.API_ACCESS_TOKEN || !tokenMatches(value, config.API_ACCESS_TOKEN)) return next(new ApiFailure(401, 'UNAUTHORIZED', 'A private API access token is required.'));
    }
    const expectedOrigin = config.PUBLIC_ORIGIN ?? `${req.protocol}://${req.get('host')}`;
    if (req.method !== 'GET' && req.get('origin') && req.get('origin') !== expectedOrigin) return next(new ApiFailure(403, 'ORIGIN_REJECTED', 'Cross-origin writes are not allowed.'));
    const key = req.socket.remoteAddress ?? 'unknown', now = Date.now();
    const c = clients.get(key);
    if (!c || now - c.time >= 60_000) clients.set(key, { time: now, count: 1 });
    else if (++c.count > 90) return next(new ApiFailure(429, 'RATE_LIMITED', 'Request budget exceeded; retry after one minute.'));
    if (clients.size > 1024) clients.delete(clients.keys().next().value!);
    next();
  });
  app.use(express.json({ limit: config.MAX_BODY_BYTES }));
  app.get('/api/v2/capabilities', wrap(async (_req, res) => res.json({ schemaVersion: 2, mode: config.DATA_MODE, demo: config.DATA_MODE === 'demo', engineVersion: 'stragy-next-open-v2', executionPolicy: 'next_open_long_cash_v1', timeframes: ['1D'], directions: ['LONG'], orders: ['MARKET'], liveTrading: false, realDataConfigured: config.MARKET_PROVIDER === 'yahoo', marketProvider: config.MARKET_PROVIDER, dataDescription: config.DATA_MODE === 'real' ? 'Observed public daily OHLCV, delayed/end-of-day, not exchange tick streaming' : 'Generated demo data', persistence: config.STORAGE_MODE, jobs: !!deps.jobs, ai: getAIStatus(), limitations: ['Real data entitlement, instrument metadata, calendars, and fee schedules require verification.', 'Research only. No broker orders are submitted.'] })));
  app.get('/api/symbols', wrap(async (_req, res) => {
    if (config.DATA_MODE === 'demo') return res.json({ success: true, symbols: ALL_SYMBOLS, mode: 'demo', membershipBasis: 'illustrative' });
    const membership = await resolveObservedUniverse('NIFTY_50');
    const symbols = [...ALL_SYMBOLS.filter(s => s.ticker.startsWith('^')), ...membership.symbols];
    res.json({ success: true, symbols, mode: 'real', membershipBasis: 'official-current-feed; historical survivorship bias', membership: { source: membership.source, observedAt: membership.observedAt, requested: membership.requested, unmapped: membership.unmapped }, referencePricesObserved: false });
  }));
  app.get('/api/symbols/:id/bars', wrap(async (req, res) => { const id = parse(IdSchema, req.params.id); const series = await loadMarketSeries(id, { asOf: parse(DateSchema, req.query.date), mode: config.DATA_MODE }); res.json({ success: true, symbol: getSymbolById(id), count: series.bars.length, ...series }); }));
  app.get('/api/strategy/templates', (_req, res) => res.json({ success: true, templates: STRATEGY_TEMPLATES }));
  app.get('/api/patterns', (_req, res) => res.json({ success: true, patterns: PATTERN_LIBRARY, method: 'local_reference' }));
  app.get('/api/smartapi/status', wrap(async (_req, res) => res.json({ success: true, ...await getSmartApiStatus() })));
  app.get('/api/smartapi/rate-limits', (_req, res) => res.json({ success: true, ...getSmartApiRateLimitsAndSpecs() }));
  app.get('/api/market/universes', (_req, res) => res.json({ success: true, universes: UNIVERSE_OPTIONS }));
  app.get('/api/market/dates', wrap(async (_req, res) => { await loadMarketSeries(NSE_SYMBOLS[0].id,{mode:config.DATA_MODE});const dates = getAvailableTradingDates(250); res.json({ success: true, count: dates.length, dates, mode: config.DATA_MODE, warning: 'Calendar sessions are not evidence of observed price availability for every symbol.' }); }));
  app.get('/api/market/calendar', wrap(async (req, res) => { const requested = parse(DateSchema, req.query.date); await loadMarketSeries(NSE_SYMBOLS[0].id,{mode:config.DATA_MODE});const dates = getAvailableTradingDates(250), resolved = findNearestTradingDate(requested); res.json({ success: true, totalSessions: dates.length, minDate: dates.at(-1)?.date, maxDate: dates[0]?.date, latestSessionDate: dates[0]?.date, latestSessionLabel: dates[0]?.fullLabel, requestedDate: requested ?? dates[0]?.date, ...resolved, tradingDates: dates }); }));
  async function waitResult(id: string): Promise<unknown> {
    const deadline = Date.now() + config.MAX_JOB_MS + 5000;
    for (;;) { const job = deps.jobs?.get(id); if (!job) throw new ApiFailure(404, 'JOB_NOT_FOUND', 'Job expired.'); if (job.status === 'succeeded') return job.result; if (['failed','cancelled'].includes(job.status)) throw new ApiFailure(422, 'JOB_FAILED', 'Research job did not complete.', job.error); if (Date.now() > deadline) throw new ApiFailure(504, 'JOB_TIMEOUT', 'Research deadline exceeded.'); await new Promise(r => setTimeout(r, 30)); }
  }
  function checkedUniverse(raw: string): string { const normalized = ({ NIFTY50: 'NIFTY_50', BANKNIFTY: 'BANK_NIFTY', INDICES: 'POPULAR_INDICES' } as Record<string,string>)[raw.toUpperCase()] ?? raw.toUpperCase(); if (!UNIVERSE_OPTIONS.some(u => u.id === normalized)) throw new ApiFailure(422, 'UNKNOWN_UNIVERSE', 'Unknown universe.'); return normalized; }
  const marketCache = new Map<string, {time:number;value:Promise<MarketSnapshot>}>();
  async function trendsFor(rawUniverse: string, date?: string): Promise<MarketSnapshot> {
    const universe = checkedUniverse(rawUniverse), key = universe + ':' + (date ?? 'latest');
    const existing = marketCache.get(key); if (existing && Date.now() - existing.time < 300000) return existing.value;
    const value = (async () => { if (deps.jobs) return await waitResult(deps.jobs.enqueue({kind:'market',universe,asOf:date,mode:config.DATA_MODE}).id) as MarketSnapshot; if (config.NODE_ENV !== 'test') throw new ApiFailure(503,'JOB_RUNNER_UNAVAILABLE','Bounded market worker is required.'); return buildMarketSnapshot(universe,date,config.DATA_MODE); })();
    marketCache.set(key,{time:Date.now(),value}); while(marketCache.size>5)marketCache.delete(marketCache.keys().next().value!);
    value.catch(()=>{if(marketCache.get(key)?.value===value)marketCache.delete(key);});return value;
  }
  app.post('/api/v2/market-snapshots', wrap(async(req,res)=>{if(!deps.jobs)throw new ApiFailure(503,'JOB_RUNNER_UNAVAILABLE','Market worker unavailable.');const p=parse(z.object({universe:z.string().max(40),asOf:DateSchema}),req.body);const job=deps.jobs.enqueue({kind:'market',universe:checkedUniverse(p.universe),asOf:p.asOf,mode:config.DATA_MODE},req.get('Idempotency-Key'));res.status(202).json({schemaVersion:2,jobId:job.id,status:job.status});}));
  app.get('/api/market/trends', wrap(async (req, res) => { const universe = parse(z.string().max(40), req.query.universe ?? 'ALL'); const date = parse(DateSchema, req.query.date); const data = await trendsFor(universe, date); res.json({ success: true, ...data, count: data.trends.length, date: data.trends[0]?.date ?? date, formattedDate: data.trends[0]?.formattedDate ?? date, isHistorical: !!date, mode: config.DATA_MODE }); }));
  app.get('/api/market/movers', wrap(async (req, res) => { const universe = parse(z.string().max(40), req.query.universe ?? 'ALL'); const date = parse(DateSchema, req.query.date); const data = await trendsFor(universe, date); res.json({ success: true, ...calculateMarketMovers(data.trends, universe, date), coverage: data.coverage, errors: data.errors, provenance: data.provenance, requestedDate: date, mode: config.DATA_MODE }); }));
  app.post('/api/market/refresh', (_req, _res, next) => next(new ApiFailure(503, 'REFRESH_UNAVAILABLE', 'No verified production provider is configured. Demo data is immutable.')));
  const optionChain = wrap(async (req, res) => { const symbolId = parse(IdSchema, req.query.symbolId ?? 2); res.json({ success: true, ...getOptionChainData(symbolId), mode: config.DATA_MODE, model: true }); });
  app.get('/api/derivatives/option-chain', optionChain); app.get('/api/market/option-chain', optionChain);
  app.get('/api/market/volume-profile', wrap(async (req, res) => res.json({ success: true, ...getVolumeProfileAndVWAP(parse(IdSchema, req.query.symbolId ?? 4)), mode: config.DATA_MODE, model: true })));
  app.get('/api/market/basis-spreads', wrap(async (_req, res) => { const spreads = getBasisAndCalendarSpreads(); res.json({ success: true, count: spreads.length, spreads, mode: config.DATA_MODE, model: true }); }));
  app.post('/api/orders/gtt-bracket', wrap(async (req, res) => { const p = parse(z.object({ symbolId: IdSchema.default(4), action: z.enum(['BUY', 'SELL']).default('BUY'), capitalAllocated: z.number().positive().max(1e8).default(100000), riskPct: z.number().positive().max(50).default(1.5), rewardRatio: z.number().positive().max(20).default(2.5), trailPct: z.number().positive().max(50).default(0.5) }), req.body); res.json({ success: true, ...calculateGttBracketOrder(p.symbolId, p.action, p.capitalAllocated, p.riskPct, p.rewardRatio, p.trailPct), previewOnly: true, mode: config.DATA_MODE }); }));
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
  app.get('/api/v2/jobs/:id', wrap(async (req, res) => { const job = deps.jobs?.get(req.params.id); if (!job) throw new ApiFailure(404, 'JOB_NOT_FOUND', 'Job not found.'); if (job.status === 'succeeded' && !job.result) throw new ApiFailure(500, 'INTERNAL_ERROR', 'The computation worker did not return a result.'); if (job.status === 'succeeded' && job.result && (!job.kind || job.kind === 'backtest')) await remember(parseBacktestResult(job.result)); res.json(job); }));
  app.delete('/api/v2/jobs/:id', wrap(async (req, res) => { if (!deps.jobs?.get(req.params.id)) throw new ApiFailure(404, 'JOB_NOT_FOUND', 'Job not found.'); res.json(deps.jobs.cancel(req.params.id)); }));
  const getRun = wrap(async (req, res) => { const result = repository.getRun(req.params.id); if (!result) throw new ApiFailure(404, 'BACKTEST_NOT_FOUND', 'Backtest not found or expired.'); res.json({ success: true, result }); }); app.get('/api/backtests/:id', getRun); app.get('/api/v2/backtests/:id', getRun);
  async function scanPayload(body:unknown) { const p=parse(ScanRequest,body);return {kind:'scan' as const,strategy:executable(p.strategy??p.strategyJson??STRATEGY_TEMPLATES[0].strategy),universe:checkedUniverse(p.universe),asOf:p.asOf??p.date,mode:config.DATA_MODE,limit:p.limit}; }
  const scan = wrap(async(req,res)=>{const payload=await scanPayload(req.body);const result=deps.jobs?await waitResult(deps.jobs.enqueue(payload,req.get('Idempotency-Key')).id):config.NODE_ENV==='test'?await scanUniverseAsync(payload.strategy,payload.universe,{asOf:payload.asOf,mode:payload.mode,limit:payload.limit}):undefined;if(!result)throw new ApiFailure(503,'JOB_RUNNER_UNAVAILABLE','Bounded scan worker required.');res.json({success:true,...result as object});});app.post('/api/scan',scan);app.post('/api/market/scan',scan);
  app.post('/api/v2/scans',wrap(async(req,res)=>{if(!deps.jobs)throw new ApiFailure(503,'JOB_RUNNER_UNAVAILABLE','Scan worker unavailable.');const job=deps.jobs.enqueue(await scanPayload(req.body),req.get('Idempotency-Key'));res.status(202).json({schemaVersion:2,jobId:job.id,status:job.status});}));
  app.get('/api/ai/status', (_req, res) => res.json({ success: true, ...getAIStatus() }));
  const promptInput = z.object({ prompt: z.string().min(1).max(4000), symbolId: IdSchema.optional() });
  app.post('/api/ai/parse-strategy', wrap(async (req, res) => { const p = parse(promptInput, req.body); res.json({ success: true, ...await parseStrategyPrompt(p.prompt, p.symbolId ?? 1) }); }));
  app.post('/api/ai/chat', wrap(async (req, res) => { const p = parse(z.object({ message: z.string().min(1).max(4000), history: z.array(z.unknown()).max(24).default([]), currentStrategy: z.unknown().optional() }), req.body); if (p.currentStrategy) executable(p.currentStrategy); res.json({ success: true, ...await handleAIChat(p as Parameters<typeof handleAIChat>[0]) }); }));
  app.post('/api/ai/apply-edit', wrap(async (req, res) => { const p = parse(z.object({ strategy: z.unknown(), instruction: z.string().min(1).max(4000) }), req.body); res.json({ success: true, ...applyStrategyEdit(executable(p.strategy), p.instruction) }); }));
  app.post('/api/ai/optimize', (_req, _res, next) => next(new ApiFailure(503, 'OPTIMIZER_WORKER_REQUIRED', 'Legacy optimization is disabled. Review a draft proposal and run bounded research explicitly.')));
  app.post('/api/v2/ai/proposals', wrap(async (req, res) => { const p = parse(z.object({ prompt: z.string().min(1).max(4000), currentStrategy: z.unknown().optional(), originatingRevision: z.union([z.number().int().nonnegative(), z.string().max(100)]).optional(), allowLocalFallback: z.boolean().default(false), history: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(4000) })).max(20).optional() }), req.body); const input = { ...p, currentStrategy: p.currentStrategy ? executable(p.currentStrategy) : undefined }; const result = await createProposal(input); res.status(result.ok ? 200 : 422).json(result); }));
  app.post('/api/v2/research-chat', wrap(async (req, res) => res.json(await researchChat(req.body))));
  app.post('/api/ai/scan-live', (_req, _res, next) => next(new ApiFailure(422, 'EXPLICIT_SCAN_REQUIRED', 'Build or select a validated strategy and request a scan explicitly.')));
  app.get('/api/web/search', (req, res) => { const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 200) : ''; const pattern = PATTERN_LIBRARY.find(p => p.keywords.some(k => q.toLowerCase().includes(k))); res.json({ query: q, method: 'local_reference', source: 'Bundled pattern library, not web search', abstract: pattern?.summary ?? 'No matching local reference.', details: pattern?.description ?? '', family: pattern?.family }); });
  app.get('/api/strategies', (_req, res) => res.json({ success: true, strategies: repository.listStrategies().map(r => ({ ...r.strategy, savedRevision: r.revision })), persistence: config.STORAGE_MODE }));
  app.post('/api/strategies', wrap(async (req, res) => { if (config.EXPOSURE_MODE !== 'private') throw new ApiFailure(403, 'PRIVATE_WRITE_REQUIRED', 'Server saves are disabled on the public service. Use My Strategies or local export.'); const body = req.body; const record = await repository.saveStrategy(body?.strategy ?? body, body?.expectedRevision); res.status(201).json({ success: true, id: record.id, revision: record.revision, strategy: record.strategy, persistence: config.STORAGE_MODE }); }));
  app.get('/api/v2/runs', (_req, res) => res.json({ runs: repository.listRuns(), persistence: config.STORAGE_MODE }));
  app.all('/api/*', (_req, _res, next) => next(new ApiFailure(404, 'ROUTE_NOT_FOUND', 'API route not found.')));
  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith('/api')) return next(err);
    const bodyError = err as { type?: string; status?: number };
    const status = err instanceof ApiFailure || err instanceof JobError || err instanceof StorageError ? err.status : err instanceof SimulationInputError ? 422 : err instanceof MarketDataError ? (/^(UNKNOWN|INVALID|OUT_OF_COVERAGE)/.test(err.code) ? 422 : 503) : bodyError.type === 'entity.too.large' ? 413 : bodyError.type === 'entity.parse.failed' ? 400 : 500;
    const code = err instanceof ApiFailure || err instanceof MarketDataError || err instanceof JobError || err instanceof StorageError || err instanceof SimulationInputError ? err.code : status === 413 ? 'BODY_TOO_LARGE' : status === 400 ? 'MALFORMED_JSON' : 'INTERNAL_ERROR';
    const message = err instanceof ApiFailure || err instanceof MarketDataError || err instanceof JobError || err instanceof StorageError || err instanceof SimulationInputError ? redact(err.message) : status === 500 ? 'Internal request error.' : 'Invalid request body.';
    res.status(status).json({ success: false, error: { code, message, requestId: res.locals.requestId, retryable: [429, 503, 504].includes(status), ...(err instanceof ApiFailure && err.details ? { fieldErrors: err.details } : {}) } });
  });
  app.use((req, res, next) => { if (/\.(?:cjs|map)$|(?:^|\/)\.env|(?:^|\/)server(?:\/|\.)/i.test(req.path)) return res.status(404).end(); next(); });
  if (deps.enableVite && config.NODE_ENV !== 'production') { const { createServer } = await import('vite'); const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' }); app.use(vite.middlewares); }
  else if (config.NODE_ENV === 'production') { const client = path.join(process.cwd(), 'dist/client'); app.use(express.static(client, { dotfiles: 'deny', index: false })); app.get('*', (_req, res) => res.sendFile(path.join(client, 'index.html'))); }
  return app;
}
