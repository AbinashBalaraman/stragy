import { createHmac } from 'node:crypto';
import { BroadcastChannel, isMainThread } from 'node:worker_threads';
import { MarketDataError } from './marketSeries';

// Read-only Angel One SmartAPI adapter. Quotes and daily candles only.
// There is intentionally no order, GTT, portfolio, logout or profile code here.
// Credentials come ONLY from process.env: ANGEL_* primary, SMARTAPI_* aliases.
// Nothing is read from .env files at runtime; the process environment is the source of truth.

export const ANGEL_DOCS = {
  docs: 'https://smartapi.angelone.in/docs',
  historical: 'https://smartapi.angelone.in/docs/Historical',
  marketData: 'https://smartapi.angelone.in/docs/MarketData',
  rateLimits: 'https://smartapi.angelone.in/docs/RateLimit',
  instruments: 'https://smartapi.angelone.in/docs/Instruments'
} as const;

const ENDPOINTS = {
  login: 'https://apiconnect.angelbroking.com/rest/auth/angelbroking/user/v1/loginByPassword',
  quote: 'https://apiconnect.angelbroking.com/rest/secure/angelbroking/market/v1/quote',
  candles: 'https://apiconnect.angelbroking.com/rest/secure/angelbroking/historical/v1/getCandleData'
} as const;
const ALLOWED_HOSTS = new Set(['apiconnect.angelbroking.com']);
const ALLOWED_ENDPOINTS = new Set<string>(Object.values(ENDPOINTS));

// Documented limits (docs/RateLimit, observed 2026-11-16):
//   loginByPassword        1/s
//   market/v1/quote       10/s, 500/min, 5000/hour
//   historical/getCandleData 2/s, 80/min, 5000/hour
// Stay just under each documented ceiling.
const LIMITS = {
  login: [{ limit: 1, windowMs: 1_000, minIntervalMs: 1_000 }],
  quote: [{ limit: 9, windowMs: 1_000, minIntervalMs: 120 }, { limit: 480, windowMs: 60_000 }],
  candles: [{ limit: 2, windowMs: 1_000, minIntervalMs: 500 }, { limit: 76, windowMs: 60_000 }]
} as const satisfies Record<string, readonly { limit: number; windowMs: number; minIntervalMs?: number }[]>;
// Angel also answers bursts with HTTP 403 "Access denied because of exceeding access rate",
// so requests are smoothly spaced (500 ms for candles) rather than fired two-at-once.;

// Angel One kills the previous JWT when the same client logs in again, so the whole
// process (HTTP server thread plus every scan/backtest worker thread) must share exactly
// one session and one re-login. Worker threads ask the main thread over BroadcastChannel;
// the JWT stays in process memory and is never written to disk or logged.
const LOGIN_FAILURE_BACKOFF_MS = 2_000;
const RELOGIN_COOLDOWN_MS = 60_000;
const SESSION_SAFETY_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const SESSION_CHANNEL = 'stragy-angel-session-v1';
const BROKER_TIMEOUT_MS = 15_000;

export interface AngelCredentials {
  apiKey: string;
  clientCode: string;
  password: string;
  totpSecret: string;
}

export interface AngelCredentialStatus {
  configured: boolean;
  /** Secret-free list of expected variable names that are absent. */
  missing: string[];
  /** Which prefix supplied the values; never the values themselves. */
  envSource: 'ANGEL' | 'SMARTAPI' | 'MIXED' | 'NONE';
}

export const ANGEL_RATE_LIMIT_MESSAGE = 'Angel One is busy. Try again in a minute.';

export class AngelRequestError extends MarketDataError {
  constructor(public status: number, public errorCode: string, message: string, public authFailure: boolean, public rateLimited: boolean, code: 'PROVIDER_UNAVAILABLE' | 'PROVIDER_AUTH_FAILED' | 'PROVIDER_RATE_LIMITED', public retryAfterMs?: number) {
    super(code, message);
  }
}

interface AngelSession {
  jwt: string;
  refreshToken: string;
  feedToken: string;
  clientCode: string;
  obtainedAt: number;
  expiresAt: number;
}
interface LoginFailure { at: number; message: string; code: string }
interface SessionWire { jwt: string; refreshToken: string; feedToken: string; obtainedAt: number; expiresAt: number }
type BrokerMessage =
  | { type: 'angel-session-request'; id: string; staleJwt?: string }
  | { type: 'angel-session-response'; id: string; session?: SessionWire; error?: { code?: string; message?: string } }
  | { type: 'angel-session-broadcast'; session?: SessionWire }
  | { type: 'angel-rate-request'; id: string; kind: 'quote' | 'candles' }
  | { type: 'angel-rate-response'; id: string; error?: { code?: string; message?: string } };

let cachedSession: AngelSession | null = null;
let loginPromise: Promise<AngelSession> | null = null;
let lastLoginFailure: LoginFailure | null = null;
let lastReloginAttempt = 0;
let reloginPromise: Promise<AngelSession> | null = null;
let fetchImpl: typeof fetch = (...args: Parameters<typeof fetch>) => fetch(...args);
let nowImpl: () => number = () => Date.now();
let pacingEnabled = true;
let loginFailureBackoffMs = LOGIN_FAILURE_BACKOFF_MS;
let reloginCooldownMs = RELOGIN_COOLDOWN_MS;
let rateLimitBaseMs = 1_000;
let rateLimitBudgetMs = 30_000;
const brokerEnabled = process.env.NODE_ENV !== 'test';
const sessionAuthority = isMainThread || !brokerEnabled;
let brokerChannel: BroadcastChannel | null = null;
let brokerRequestSeq = 0;

/** Test seam: injected fetch/clock only. Never used in production paths. */
export function configureAngelTransport(options: {
  fetch?: typeof fetch;
  now?: () => number;
  resetSession?: boolean;
  /** Disable the 2/s candle pacing in tests that assert concurrency behaviour. */
  pacing?: boolean;
  loginFailureBackoffMs?: number;
  reloginCooldownMs?: number;
  /** Test seam: shorten the bounded rate-limit wait. */
  rateLimitBaseMs?: number;
  rateLimitBudgetMs?: number;
}): void {
  if (options.fetch) fetchImpl = options.fetch;
  if (options.now) nowImpl = options.now;
  if (options.pacing !== undefined) pacingEnabled = options.pacing;
  if (options.loginFailureBackoffMs !== undefined) loginFailureBackoffMs = options.loginFailureBackoffMs;
  if (options.reloginCooldownMs !== undefined) reloginCooldownMs = options.reloginCooldownMs;
  if (options.rateLimitBaseMs !== undefined) rateLimitBaseMs = options.rateLimitBaseMs;
  if (options.rateLimitBudgetMs !== undefined) rateLimitBudgetMs = options.rateLimitBudgetMs;
  if (options.resetSession) {
    cachedSession = null;
    loginPromise = null;
    lastLoginFailure = null;
    lastReloginAttempt = 0;
    reloginPromise = null;
  }
}

/** Test seam: restores the real transport and clears every module-level budget. */
export function resetAngelTransportForTests(): void {
  fetchImpl = (...args: Parameters<typeof fetch>) => fetch(...args);
  nowImpl = () => Date.now();
  cachedSession = null;
  loginPromise = null;
  lastLoginFailure = null;
  lastReloginAttempt = 0;
  reloginPromise = null;
  pacingEnabled = true;
  loginFailureBackoffMs = LOGIN_FAILURE_BACKOFF_MS;
  reloginCooldownMs = RELOGIN_COOLDOWN_MS;
  rateLimitBaseMs = 1_000;
  rateLimitBudgetMs = 30_000;
  buckets.clear();
  lastSlotAt.clear();
  gate = Promise.resolve();
}

function toWire(session: AngelSession): SessionWire {
  return { jwt: session.jwt, refreshToken: session.refreshToken, feedToken: session.feedToken, obtainedAt: session.obtainedAt, expiresAt: session.expiresAt };
}

function fromWire(session: SessionWire): AngelSession {
  if (!session || typeof session.jwt !== 'string' || !session.jwt || !Number.isFinite(session.expiresAt)) {
    throw new MarketDataError('PROVIDER_AUTH_FAILED', 'Angel One session broker returned an invalid session');
  }
  if (session.expiresAt <= nowImpl() + 60_000) throw new MarketDataError('PROVIDER_AUTH_FAILED', 'Angel One session broker returned an expired session');
  return {
    jwt: session.jwt,
    refreshToken: String(session.refreshToken ?? ''),
    feedToken: String(session.feedToken ?? ''),
    clientCode: readCredentials().credentials.clientCode,
    obtainedAt: Number(session.obtainedAt) || nowImpl(),
    expiresAt: Number(session.expiresAt)
  };
}

function ensureBroker(): BroadcastChannel | null {
  if (!brokerEnabled) return null;
  if (!brokerChannel) {
    brokerChannel = new BroadcastChannel(SESSION_CHANNEL);
    brokerChannel.unref();
    brokerChannel.addEventListener('message', (event: MessageEvent) => {
      const message = event.data as BrokerMessage | null;
      if (!message) return;
      if (message.type === 'angel-session-request' && sessionAuthority) { void handleBrokerRequest(message); return; }
      if (message.type === 'angel-rate-request' && sessionAuthority) { void handleRateRequest(message); return; }
      if (message.type === 'angel-session-broadcast' && message.session) {
        try {
          const session = fromWire(message.session);
          if (!cachedSession || session.obtainedAt >= cachedSession.obtainedAt) cachedSession = session;
        } catch { /* ignore malformed or expired broadcasts */ }
      }
    });
  }
  return brokerChannel;
}

async function handleBrokerRequest(message: Extract<BrokerMessage, { type: 'angel-session-request' }>): Promise<void> {
  const channel = ensureBroker();
  if (!channel || !message.id) return;
  try {
    const session = message.staleJwt ? await refreshSession(message.staleJwt) : await getSession();
    channel.postMessage({ type: 'angel-session-response', id: message.id, session: toWire(session) } satisfies BrokerMessage);
  } catch (error) {
    channel.postMessage({
      type: 'angel-session-response',
      id: message.id,
      error: {
        code: error instanceof MarketDataError ? error.code : 'PROVIDER_UNAVAILABLE',
        message: error instanceof Error ? error.message : 'Angel One session unavailable'
      }
    } satisfies BrokerMessage);
  }
}

async function handleRateRequest(message: Extract<BrokerMessage, { type: 'angel-rate-request' }>): Promise<void> {
  const channel = ensureBroker();
  if (!channel || !message.id) return;
  try {
    await acquire(message.kind, undefined);
    channel.postMessage({ type: 'angel-rate-response', id: message.id } satisfies BrokerMessage);
  } catch (error) {
    channel.postMessage({
      type: 'angel-rate-response',
      id: message.id,
      error: { code: 'PROVIDER_UNAVAILABLE', message: error instanceof Error ? error.message : 'Angel rate slot unavailable' }
    } satisfies BrokerMessage);
  }
}

/** Worker-thread path: the main thread also owns the process-wide rate budget. */
function requestRateSlot(kind: 'quote' | 'candles', signal?: AbortSignal): Promise<void> {
  const channel = ensureBroker();
  if (!channel) return Promise.reject(new MarketDataError('PROVIDER_UNAVAILABLE', 'Angel rate broker is unavailable'));
  const id = `${process.pid}-rate-${Date.now().toString(36)}-${++brokerRequestSeq}`;
  return new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const cleanup = () => {
      clearTimeout(timer);
      channel.removeEventListener('message', onMessage);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => { cleanup(); reject(abortError(signal!)); };
    const onMessage = (event: MessageEvent) => {
      const message = event.data as BrokerMessage | null;
      if (!message || message.type !== 'angel-rate-response' || message.id !== id) return;
      cleanup();
      if (message.error) reject(new MarketDataError(message.error.code || 'PROVIDER_UNAVAILABLE', message.error.message || 'Angel rate slot unavailable'));
      else resolve();
    };
    timer = setTimeout(() => {
      cleanup();
      reject(new MarketDataError('PROVIDER_UNAVAILABLE', 'Angel rate broker timed out'));
    }, 70_000);
    channel.addEventListener('message', onMessage);
    if (signal) {
      if (signal.aborted) { onAbort(); return; }
      signal.addEventListener('abort', onAbort, { once: true });
    }
    channel.postMessage({ type: 'angel-rate-request', id, kind } satisfies BrokerMessage);
  });
}

/** Worker-thread path: the main thread owns the only Angel session for this process. */
function requestSessionFromAuthority(staleJwt: string | undefined, signal?: AbortSignal): Promise<AngelSession> {
  const channel = ensureBroker();
  if (!channel) return Promise.reject(new MarketDataError('PROVIDER_UNAVAILABLE', 'Angel session broker is unavailable'));
  const id = `${process.pid}-${Date.now().toString(36)}-${++brokerRequestSeq}`;
  return new Promise<AngelSession>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const cleanup = () => {
      clearTimeout(timer);
      channel.removeEventListener('message', onMessage);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => { cleanup(); reject(abortError(signal!)); };
    const onMessage = (event: MessageEvent) => {
      const message = event.data as BrokerMessage | null;
      if (!message || message.type !== 'angel-session-response' || message.id !== id) return;
      cleanup();
      if (message.error) {
        reject(new MarketDataError(message.error.code || 'PROVIDER_AUTH_FAILED', message.error.message || 'Angel One session unavailable'));
        return;
      }
      try {
        const session = fromWire(message.session as SessionWire);
        cachedSession = session;
        resolve(session);
      } catch (error) { reject(error); }
    };
    timer = setTimeout(() => {
      cleanup();
      reject(new MarketDataError('PROVIDER_UNAVAILABLE', 'Angel One session broker timed out'));
    }, BROKER_TIMEOUT_MS);
    channel.addEventListener('message', onMessage);
    if (signal) {
      if (signal.aborted) { onAbort(); return; }
      signal.addEventListener('abort', onAbort, { once: true });
    }
    channel.postMessage({ type: 'angel-session-request', id, ...(staleJwt ? { staleJwt } : {}) } satisfies BrokerMessage);
  });
}

// The HTTP server thread must be listening before any scan worker asks for a session.
if (sessionAuthority) ensureBroker();

function envValue(primary: string, alias: string): { value: string; source: 'ANGEL' | 'SMARTAPI' | 'NONE' } {
  const parse = (raw: string | undefined): string => (raw ?? '').trim();
  const a = parse(process.env[primary]);
  if (a) return { value: a, source: 'ANGEL' };
  const b = parse(process.env[alias]);
  if (b) return { value: b, source: 'SMARTAPI' };
  return { value: '', source: 'NONE' };
}

const FIELDS = [
  ['ANGEL_API_KEY', 'SMARTAPI_API_KEY'],
  ['ANGEL_CLIENT_CODE', 'SMARTAPI_CLIENT_CODE'],
  ['ANGEL_PASSWORD', 'SMARTAPI_PASSWORD'],
  ['ANGEL_TOTP_SECRET', 'SMARTAPI_TOTP_KEY']
] as const;

function readCredentials(): { credentials: AngelCredentials; status: AngelCredentialStatus } {
  const values = FIELDS.map(([primary, alias]) => envValue(primary, alias));
  const missing = FIELDS.filter((_, i) => !values[i].value).map(([primary]) => primary);
  const sources = new Set(values.map(v => v.source).filter(s => s !== 'NONE'));
  const credentials: AngelCredentials = {
    apiKey: values[0].value,
    clientCode: values[1].value,
    password: values[2].value,
    totpSecret: values[3].value
  };
  return {
    credentials,
    status: {
      configured: missing.length === 0,
      missing,
      envSource: sources.size === 0 ? 'NONE' : sources.size > 1 ? 'MIXED' : (sources.values().next().value as 'ANGEL' | 'SMARTAPI')
    }
  };
}

export function getAngelCredentialStatus(): AngelCredentialStatus {
  return readCredentials().status;
}

export function isAngelConfigured(): boolean {
  return getAngelCredentialStatus().configured;
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Strict RFC 4648 base32 decode (padding optional, whitespace/hyphens ignored). */
export function base32Decode(secret: string): Buffer {
  const clean = secret.replace(/=+$/, '').toUpperCase().replace(/[\s-]/g, '');
  if (!clean || /[^A-Z2-7]/.test(clean)) throw new MarketDataError('PROVIDER_AUTH_FAILED', 'Angel TOTP secret is not valid base32');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    value = (value << 5) | BASE32_ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** RFC 6238 TOTP: HMAC-SHA1, 30 s step, configurable digits (6 for Angel One). */
export function generateTotp(secret: string, atMs: number = nowImpl(), stepSeconds = 30, digits = 6): string {
  if (!Number.isInteger(stepSeconds) || stepSeconds <= 0 || digits < 6 || digits > 8) throw new MarketDataError('PROVIDER_AUTH_FAILED', 'Invalid TOTP parameters');
  const counter = Math.floor(Math.floor(atMs / 1000) / stepSeconds);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter), 0);
  const digest = createHmac('sha1', base32Decode(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24) | ((digest[offset + 1] & 0xff) << 16) | ((digest[offset + 2] & 0xff) << 8) | (digest[offset + 3] & 0xff);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/** Angel One tokens expire at IST midnight; cache just short of that boundary. */
function nextIstMidnight(now: number): number {
  const ist = new Date(now + 19_800_000);
  return Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + 1) - 19_800_000;
}

function sessionExpiry(now: number): number {
  return Math.max(now + 60_000, nextIstMidnight(now) - SESSION_SAFETY_MS);
}

function assertEndpoint(url: string): void {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new MarketDataError('PROVIDER_UNAVAILABLE', 'Angel request URL is invalid'); }
  if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsed.hostname) || !ALLOWED_ENDPOINTS.has(parsed.origin + parsed.pathname)) {
    throw new MarketDataError('PROVIDER_UNAVAILABLE', 'Angel request host or endpoint is not allowlisted');
  }
}

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) return reject(abortError(signal));
  const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, Math.max(0, ms));
  function onAbort() { clearTimeout(timer); reject(abortError(signal!)); }
  signal?.addEventListener('abort', onAbort, { once: true });
});

function abortError(signal: AbortSignal): Error {
  const reason = (signal as AbortSignal & { reason?: unknown }).reason;
  return reason instanceof Error ? reason : new MarketDataError('PROVIDER_UNAVAILABLE', 'Angel request was aborted');
}

function isAuthFailure(error: unknown): boolean {
  return error instanceof AngelRequestError && error.authFailure;
}

// One global gate serialises every outbound Angel request, so the sliding-window
// budgets below are enforced across concurrent callers and route handlers.
let gate: Promise<unknown> = Promise.resolve();
const buckets = new Map<string, number[]>();
const lastSlotAt = new Map<string, number>();

async function acquire(kind: keyof typeof LIMITS, signal?: AbortSignal): Promise<void> {
  const spacing = Math.max(...LIMITS[kind].map(rule => rule.minIntervalMs ?? 0));
  if (spacing > 0) {
    const last = lastSlotAt.get(kind) ?? 0;
    const wait = last + spacing - Date.now();
    if (wait > 0) await sleep(wait + 2, signal);
    lastSlotAt.set(kind, Date.now());
  }
  for (const rule of LIMITS[kind]) {
    const key = `${kind}:${rule.windowMs}:${rule.limit}`;
    for (;;) {
      // Real elapsed time: the injected clock exists for session/TOTP tests and must
      // never make the limiter wait on a frozen timestamp.
      const now = Date.now();
      const hits = (buckets.get(key) ?? []).filter(t => now - t < rule.windowMs);
      if (hits.length < rule.limit) { hits.push(now); buckets.set(key, hits); break; }
      await sleep(rule.windowMs - (now - hits[0]) + 5, signal);
    }
  }
}

function schedule<T>(kind: keyof typeof LIMITS, signal: AbortSignal | undefined, task: () => Promise<T>): Promise<T> {
  const run = gate.then(async () => {
    if (pacingEnabled) {
      if (sessionAuthority || kind === 'login') await acquire(kind, signal);
      else await requestRateSlot(kind as 'quote' | 'candles', signal);
    }
    if (signal?.aborted) throw abortError(signal);
    return task();
  });
  gate = run.then(() => undefined, () => undefined);
  return run;
}

function classifyLoginFailure(status: number, message: string): string {
  const text = message.toLowerCase();
  if (text.includes('totp') || text.includes('otp')) return 'Angel One login rejected: invalid or out-of-step TOTP';
  if (text.includes('ip')) return 'Angel One login rejected: source IP is not whitelisted for this API key';
  if (text.includes('api key') || text.includes('apikey') || text.includes('private key')) return 'Angel One login rejected: API key is invalid or not enabled';
  if (text.includes('client') || text.includes('user') || text.includes('password') || text.includes('pin')) return 'Angel One login rejected: client code or PIN is invalid';
  return `Angel One login rejected (HTTP ${status})`;
}

function authHeaders(creds: AngelCredentials, jwt?: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'X-UserType': 'USER',
    'X-SourceID': 'WEB',
    'X-ClientLocalIP': '192.168.1.1',
    'X-ClientPublicIP': '106.193.147.98',
    'X-MACAddress': 'fe80::1',
    'X-PrivateKey': creds.apiKey,
    ...(jwt ? { Authorization: `Bearer ${jwt}` } : {})
  };
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  if (Number(response.headers.get('content-length')) > maxBytes) throw new MarketDataError('PROVIDER_UNAVAILABLE', 'Angel response exceeds the byte limit');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes) throw new MarketDataError('PROVIDER_UNAVAILABLE', 'Angel response exceeds the byte limit');
      chunks.push(part.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString('utf8');
}

interface AngelEnvelope<T> { status?: boolean; message?: string; errorcode?: string; data?: T }

/** Respect Retry-After when Angel supplies it (seconds or HTTP date). */
function retryAfterMs(response: Response, now: number): number | undefined {
  const raw = response.headers.get('retry-after');
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(60_000, Math.round(seconds * 1_000));
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, Math.min(60_000, at - now)) : undefined;
}

async function angelPost<T>(kind: keyof typeof LIMITS, url: string, body: unknown, jwt: string | undefined, signal?: AbortSignal, fetcher?: typeof fetch): Promise<T> {
  assertEndpoint(url);
  const { credentials } = readCredentials();
  return schedule(kind, signal, async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new MarketDataError('PROVIDER_UNAVAILABLE', 'Angel request exceeded 10 seconds')), REQUEST_TIMEOUT_MS);
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    let response: Response;
    try {
      response = await (fetcher ?? fetchImpl)(url, {
        method: 'POST',
        headers: authHeaders(credentials, jwt),
        body: JSON.stringify(body),
        redirect: 'error',
        signal: combined
      });
    } catch (error) {
      if (error instanceof MarketDataError) throw error;
      if (signal?.aborted) throw abortError(signal);
      throw new MarketDataError('PROVIDER_UNAVAILABLE', 'Angel One is unreachable from this process');
    } finally {
      clearTimeout(timeout);
    }
    const text = await readBoundedText(response, MAX_RESPONSE_BYTES);
    let payload: AngelEnvelope<T> | null = null;
    try { payload = text ? JSON.parse(text) as AngelEnvelope<T> : null; } catch { payload = null; }
    const errorCode = String(payload?.errorcode ?? '');
    const message = String(payload?.message ?? '');
    const rateLimited = response.status === 429
      || /exceed|rate limit|too many requests/i.test(text)
      || /^AG8004$/.test(errorCode)
      || (kind === 'login' && response.status === 403 && !/totp|client|password|\bpin\b|api key|whitelist|ip address/i.test(message));
    if (rateLimited) throw new AngelRequestError(response.status, errorCode || 'RATE_LIMIT', ANGEL_RATE_LIMIT_MESSAGE, false, true, 'PROVIDER_RATE_LIMITED', retryAfterMs(response, nowImpl()));
    // Angel reports login throttling as 403 before it ever checks the PIN/TOTP.
    // Only 401 and the documented token errors may trigger a re-login.
    const credentialFailure = kind === 'login' && response.status === 403 && /totp|client|password|\bpin\b|api key|whitelist|ip address/i.test(message);
    if (credentialFailure) throw new AngelRequestError(403, errorCode || 'AUTH', classifyLoginFailure(response.status, message), true, false, 'PROVIDER_AUTH_FAILED');
    const authError = response.status === 401 || errorCode === 'AG8001' || errorCode === 'AG8002';
    if (!response.ok || !payload || payload.status !== true) {
      if (authError) throw new AngelRequestError(response.status, errorCode || 'AUTH', kind === 'login' ? classifyLoginFailure(response.status, message) : 'Angel One session is invalid or expired', true, false, 'PROVIDER_AUTH_FAILED');
      throw new AngelRequestError(response.status, errorCode || 'HTTP_' + response.status, `Angel One market-data request failed (${errorCode || 'HTTP ' + response.status})`, false, false, 'PROVIDER_UNAVAILABLE');
    }
    if (payload.data === undefined) throw new MarketDataError('PROVIDER_UNAVAILABLE', 'Angel One returned an empty payload');
    return payload.data;
  });
}

async function login(fetcher?: typeof fetch): Promise<AngelSession> {
  const { credentials, status } = readCredentials();
  if (!status.configured) throw new MarketDataError('PROVIDER_AUTH_FAILED', `Angel One credentials are not configured; missing ${status.missing.join(', ')}`);
  if (lastLoginFailure && nowImpl() - lastLoginFailure.at < loginFailureBackoffMs) throw new MarketDataError(lastLoginFailure.code, lastLoginFailure.message);
  if (loginPromise) return loginPromise;
  loginPromise = (async () => {
    const totp = generateTotp(credentials.totpSecret, nowImpl());
    try {
      const data = await angelPost<{ jwtToken?: string; refreshToken?: string; feedToken?: string }>(
        'login',
        ENDPOINTS.login,
        { clientcode: credentials.clientCode, password: credentials.password, totp },
        undefined,
        undefined,
        fetcher
      );
      if (!data?.jwtToken) throw new MarketDataError('PROVIDER_AUTH_FAILED', 'Angel One login did not return a session token');
      const now = nowImpl();
      cachedSession = {
        jwt: data.jwtToken,
        refreshToken: data.refreshToken ?? '',
        feedToken: data.feedToken ?? '',
        clientCode: credentials.clientCode,
        obtainedAt: now,
        expiresAt: sessionExpiry(now)
      };
      lastLoginFailure = null;
      if (brokerEnabled) ensureBroker()?.postMessage({ type: 'angel-session-broadcast', session: toWire(cachedSession) } satisfies BrokerMessage);
      return cachedSession;
    } catch (error) {
      // Cache the failure only for the short backoff window, never indefinitely.
      lastLoginFailure = {
        at: nowImpl(),
        message: error instanceof Error ? error.message : 'Angel One login failed',
        code: error instanceof MarketDataError ? error.code : 'PROVIDER_UNAVAILABLE'
      };
      throw error;
    } finally {
      loginPromise = null;
    }
  })();
  return loginPromise;
}

async function getSession(signal?: AbortSignal, fetcher?: typeof fetch): Promise<AngelSession> {
  const { credentials } = readCredentials();
  if (cachedSession && cachedSession.clientCode === credentials.clientCode && cachedSession.expiresAt > nowImpl() + 60_000) return cachedSession;
  if (signal?.aborted) throw abortError(signal);
  if (!sessionAuthority) return requestSessionFromAuthority(undefined, signal);
  return login(fetcher);
}

/**
 * Shared by every caller whose request failed with a 401/AG8001/AG8002.
 * Only the first failure for the current JWT re-logs in; later failures adopt the
 * replacement session. At most one re-login attempt per minute, process-wide.
 */
async function refreshSession(failedJwt: string, fetcher?: typeof fetch, signal?: AbortSignal): Promise<AngelSession> {
  if (cachedSession && cachedSession.jwt !== failedJwt && cachedSession.expiresAt > nowImpl() + 60_000) return cachedSession;
  if (!sessionAuthority) return requestSessionFromAuthority(failedJwt, signal);
  if (reloginPromise) return reloginPromise;
  const now = nowImpl();
  if (now - lastReloginAttempt < reloginCooldownMs) {
    const failure = lastLoginFailure;
    const code = failure?.code === 'PROVIDER_RATE_LIMITED' ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_AUTH_FAILED';
    throw new MarketDataError(code, failure?.message ?? 'Angel One session expired; re-login is cooling down after a recent attempt');
  }
  lastReloginAttempt = now;
  reloginPromise = (async () => {
    try {
      return await login(fetcher);
    } catch (error) {
      // A known-dead JWT must not stay cached as if it were connected.
      cachedSession = null;
      throw error;
    }
  })();
  try {
    return await reloginPromise;
  } finally {
    reloginPromise = null;
  }
}

export interface AngelSessionInfo {
  configured: boolean;
  /** True only when a session obtained by this process is still valid. Never triggers a login. */
  connected: boolean;
  obtainedAt: string | null;
  expiresAt: string | null;
  lastError: string | null;
}

/** Observational only. Deliberately never logs in; safe for status routes. */
export function getAngelSessionInfo(): AngelSessionInfo {
  const { status } = readCredentials();
  const live = !!cachedSession && cachedSession.expiresAt > nowImpl();
  return {
    configured: status.configured,
    connected: live,
    obtainedAt: live && cachedSession ? new Date(cachedSession.obtainedAt).toISOString() : null,
    expiresAt: live && cachedSession ? new Date(cachedSession.expiresAt).toISOString() : null,
    lastError: lastLoginFailure?.message ?? null
  };
}

/** Session established once per process and reused; one transparent re-login on auth failure. */
export async function getAngelSession(signal?: AbortSignal): Promise<{ expiresAt: number }> {
  const session = await getSession(signal);
  return { expiresAt: session.expiresAt };
}

/** Explicit opt-in for the one-off connectivity probe. Not used by routes. */
export async function angelLogin(signal?: AbortSignal): Promise<AngelSessionInfo> {
  await getSession(signal);
  return getAngelSessionInfo();
}

export type AngelInterval = 'ONE_DAY';

export interface AngelCandleRequest {
  exchange: 'NSE';
  symbolToken: string;
  interval: AngelInterval;
  fromDate: Date;
  toDate: Date;
}

export interface AngelCandle {
  date: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface AngelRawQuote {
  exchange: string;
  symbolToken: string;
  ltp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  percentChange: number;
  exchangeTime: string | null;
  volume: number | null;
}

function istStamp(date: Date, minutesOfDay: number): string {
  const ist = new Date(date.getTime() + 19_800_000);
  const yyyy = ist.getUTCFullYear();
  const mm = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(ist.getUTCDate()).padStart(2, '0');
  const hh = String(Math.floor(minutesOfDay / 60)).padStart(2, '0');
  const min = String(minutesOfDay % 60).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

/** Angel sends "16-Nov-2026 13:32:28" in IST, or an epoch-zero placeholder for indices. */
export function parseAngelExchangeTime(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const match = /^(\d{2})-([A-Za-z]{3})-(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(raw.trim());
  if (match) {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months.indexOf(match[2][0].toUpperCase() + match[2].slice(1).toLowerCase());
    if (month < 0) return null;
    const timestamp = Date.UTC(Number(match[3]), month, Number(match[1]), Number(match[4]), Number(match[5]), Number(match[6])) - 19_800_000;
    if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
    return new Date(timestamp).toISOString();
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) && parsed > 0 ? new Date(parsed).toISOString() : null;
}

export interface AngelQuoteRequest { exchange: 'NSE'; tokens: string[] }

/** FULL-mode market quotes, one batch per exchange (documented cap: 50 tokens per request). */
export async function getAngelQuotes(requests: AngelQuoteRequest[], options: { signal?: AbortSignal; fetch?: typeof fetch } = {}): Promise<AngelRawQuote[]> {
  const byExchange = new Map<string, string[]>();
  for (const request of requests) {
    const tokens = byExchange.get(request.exchange) ?? [];
    tokens.push(...request.tokens);
    byExchange.set(request.exchange, tokens);
  }
  const out: AngelRawQuote[] = [];
  for (const [exchange, tokens] of byExchange) {
    for (let i = 0; i < tokens.length; i += 50) {
      const batch = tokens.slice(i, i + 50);
      const data = await withAuthRetry(session => angelPost<{ fetched?: Record<string, unknown>[] }>(
        'quote', ENDPOINTS.quote, { mode: 'FULL', exchangeTokens: { [exchange]: batch } }, session.jwt, options.signal, options.fetch
      ), options.signal, options.fetch);
      for (const row of data.fetched ?? []) {
        const ltp = Number(row.ltp);
        const close = Number(row.close);
        if (!Number.isFinite(ltp) || ltp <= 0) continue;
        const percentChange = Number(row.percentChange);
        out.push({
          exchange: String(row.exchange ?? exchange),
          symbolToken: String(row.symbolToken ?? ''),
          ltp,
          open: Number.isFinite(Number(row.open)) ? Number(row.open) : ltp,
          high: Number.isFinite(Number(row.high)) ? Number(row.high) : ltp,
          low: Number.isFinite(Number(row.low)) ? Number(row.low) : ltp,
          close: Number.isFinite(close) && close > 0 ? close : ltp,
          percentChange: Number.isFinite(percentChange) ? percentChange : (close > 0 ? Number((((ltp - close) / close) * 100).toFixed(2)) : 0),
          exchangeTime: parseAngelExchangeTime(row.exchTradeTime ?? row.exchFeedTime ?? row.lastTradeTime),
          volume: Number.isFinite(Number(row.tradeVolume)) ? Number(row.tradeVolume) : null
        });
      }
    }
  }
  return out;
}

interface RateLimitBudget {
  /** Absolute time after which a retry must not start. Defaults to a short budget. */
  deadlineAt?: number;
  /** How many throttle responses to wait out before giving up. */
  maxRetries?: number;
  baseMs?: number;
}

async function withAuthRetry<T>(
  fn: (session: AngelSession) => Promise<T>,
  signal?: AbortSignal,
  fetcher?: typeof fetch,
  budget: RateLimitBudget = {},
): Promise<T> {
  const session = await getSession(signal, fetcher);
  try {
    return await fn(session);
  } catch (error) {
    if (error instanceof AngelRequestError && error.rateLimited) {
      // Angel's per-second/per-minute limiter answers with 403, not 401. Never
      // re-login for it. Wait out the throttle instead, bounded by the caller's
      // deadline, so a backtest does not fail just because a scan is running.
      const maxRetries = budget.maxRetries ?? 2;
      const baseMs = Math.max(1, budget.baseMs ?? rateLimitBaseMs);
      const deadlineAt = budget.deadlineAt ?? Date.now() + rateLimitBudgetMs;
      let current = error;
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        const remaining = deadlineAt - Date.now();
        if (remaining <= 0) throw current;
        const wait = current.retryAfterMs ?? Math.min(rateLimitBudgetMs, baseMs * 2 ** attempt + Math.floor(Math.random() * baseMs * 0.2));
        if (wait > remaining) throw current;
        await sleep(wait, signal);
        try { return await fn(session); }
        catch (retryError) {
          if (!(retryError instanceof AngelRequestError && retryError.rateLimited)) throw retryError;
          current = retryError;
        }
      }
      throw current;
    }
    if (!isAuthFailure(error)) throw error;
    const refreshed = await refreshSession(session.jwt, fetcher, signal);
    return fn(refreshed);
  }
}

/** ONE_DAY candles. Callers must pace scans; the global limiter also applies. */
export async function getAngelCandles(request: AngelCandleRequest, options: { signal?: AbortSignal; fetch?: typeof fetch; retryDeadlineAt?: number } = {}): Promise<AngelCandle[]> {
  const body = {
    exchange: request.exchange,
    symboltoken: request.symbolToken,
    interval: request.interval,
    fromdate: istStamp(request.fromDate, 9 * 60 + 15),
    todate: istStamp(request.toDate, 15 * 60 + 30)
  };
  const rows = await withAuthRetry(session => angelPost<unknown[][]>(
    'candles', ENDPOINTS.candles, body, session.jwt, options.signal, options.fetch
  ), options.signal, options.fetch, { deadlineAt: options.retryDeadlineAt, maxRetries: 6 });
  if (!Array.isArray(rows)) throw new MarketDataError('PROVIDER_UNAVAILABLE', 'Angel One returned no candle series');
  const candles: AngelCandle[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 6) throw new MarketDataError('INVALID_BARS', 'Angel One returned a malformed candle row');
    const timestamp = Date.parse(String(row[0]));
    const [open, high, low, close, volume] = row.slice(1, 6).map(Number);
    if (!Number.isFinite(timestamp) || ![open, high, low, close, volume].every(Number.isFinite)) throw new MarketDataError('INVALID_BARS', 'Angel One returned a non-numeric candle row');
    candles.push({ date: new Date(timestamp + 19_800_000).toISOString().slice(0, 10), timestamp, open, high, low, close, volume });
  }
  return candles;
}
