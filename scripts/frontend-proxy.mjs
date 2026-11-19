#!/usr/bin/env node
/**
 * Stragy custom frontend proxy — loopback-only :4300.
 *
 * Owns ONE browser origin and ONE Basic login. Every API call is same-origin:
 *   /opencode/*  -> http://127.0.0.1:4200/*   (the Stragy UI gate, NEVER :4201)
 *   /api/*       -> http://127.0.0.1:3100/*   (API-only Stragy data engine)
 *   /healthz     -> local liveness (no auth)
 *   everything else -> dist/frontend static + SPA fallback
 *
 * The proxy never buffers request or response bodies: SSE (/opencode/api/event),
 * large base64 image prompts and audio payloads all stream verbatim. It does
 * not add its own redaction — the gate remains the single authorization and
 * redaction boundary. WebSocket upgrades on /opencode/* are piped raw.
 */
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(SCRIPT_DIR, '..');
const APP_DATA = path.resolve(PROJECT, '..', 'opencode-app-data');
const PASSWORD_FILE = path.join(APP_DATA, 'password.txt');
const DIST = path.join(PROJECT, 'dist', 'frontend');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const PORT = Number(arg('port', process.env.FRONTEND_PORT || '4300'));
const HOST = arg('host', '127.0.0.1');
const USER = process.env.FRONTEND_USER || 'opencode';
const GATE_PORT = Number(process.env.OPENCODE_GATE_PORT || '4200');
const STRAGY_PORT = Number(process.env.STRAGY_PORT || '3100');
const LOG = process.env.FRONTEND_PROXY_LOG || '/tmp/opencode/frontend-proxy.log';
const MAX_UPLOAD = 12 * 1024 * 1024; // guard only; bodies still stream (guard is advisory)
// /tts is deliberately small and bounded: a single assistant reply, not audio
// capture. The text is passed to espeak-ng as a positional argv after `--`, so
// no shell is involved and no text can become an option.
const TTS_MAX_TEXT = 1200;
const TTS_MAX_BODY = 8 * 1024;
const TTS_TIMEOUT_MS = 8000;

fs.mkdirSync(path.dirname(LOG), { recursive: true });
function log(msg) {
  try { fs.appendFileSync(LOG, `${new Date().toISOString()} ${msg}\n`); } catch { /* never fail a request on logging */ }
}

// ------------------------------------------------------------------ password
let cached = { mtimeMs: -1, value: '' };
function opencodePassword() {
  try {
    const st = fs.statSync(PASSWORD_FILE);
    if (st.mtimeMs !== cached.mtimeMs) {
      cached = { mtimeMs: st.mtimeMs, value: fs.readFileSync(PASSWORD_FILE, 'utf8').trim() };
    }
  } catch {
    if (process.env.OPENCODE_PASSWORD) cached.value = process.env.OPENCODE_PASSWORD;
  }
  return cached.value || process.env.OPENCODE_PASSWORD || '';
}
const basic = (user, password) => `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

function authorized(req) {
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Basic ')) return false;
  let decoded = '';
  try { decoded = Buffer.from(header.slice(6), 'base64').toString('utf8'); } catch { return false; }
  const sep = decoded.indexOf(':');
  if (sep < 0) return false;
  return safeEqual(decoded.slice(0, sep), USER) && safeEqual(decoded.slice(sep + 1), opencodePassword());
}

function unauthorized(res) {
  const body = JSON.stringify({ error: 'authentication_required' });
  res.writeHead(401, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
    'www-authenticate': `Basic realm="Stragy", charset="UTF-8"`,
    'cache-control': 'no-store',
  });
  res.end(body);
}

// ------------------------------------------------------------- header hygiene
const HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade',
]);
function cleanHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    if (HOP.has(k.toLowerCase())) continue;
    out[k] = v;
  }
  return out;
}

const SECURITY = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
};
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "font-src 'self' data:",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join('; ');

function upstreamHeaders(headers, targetPort) {
  const out = cleanHeaders(headers);
  out.host = `127.0.0.1:${targetPort}`;
  delete out.authorization; // never forward a browser credential; injected below
  delete out['accept-encoding']; // upstream/gate manages its own encoding
  return out;
}

// -------------------------------------------------------------------- proxy
/** Stream a request to a loopback upstream. Bodies are never buffered. */
function pipeToUpstream(req, res, targetPort, targetPath, headers) {
  let upstream = null;
  const proxy = http.request({
    hostname: '127.0.0.1',
    port: targetPort,
    method: req.method,
    path: targetPath,
    headers,
    agent: false,
  }, (up) => {
    upstream = up;
    const outHeaders = cleanHeaders(up.headers || {});
    Object.assign(outHeaders, SECURITY);
    res.writeHead(up.statusCode || 502, outHeaders);
    up.pipe(res); // SSE and large bodies stream; no buffering, no re-chunking
  });
  proxy.on('error', (err) => {
    if (!res.headersSent) {
      const body = JSON.stringify({ error: 'frontend_proxy_upstream_error', message: String(err?.message || err) });
      res.writeHead(502, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' });
      res.end(body);
    } else {
      res.destroy();
    }
  });
  req.on('error', () => proxy.destroy());
  res.on('close', () => { proxy.destroy(); if (upstream) upstream.destroy(); });
  // req.pipe() ends the upstream request on request end. Never call proxy.end()
  // early — that truncated large bodies in an earlier pass.
  req.pipe(proxy);
}

function proxyOpenCode(req, res, rest) {
  const pathAndQuery = rest || '/';
  const headers = upstreamHeaders(req.headers, GATE_PORT);
  headers.authorization = basic('opencode', opencodePassword());
  pipeToUpstream(req, res, GATE_PORT, pathAndQuery, headers);
}

function proxyStragy(req, res) {
  // /api/* is passed verbatim to the API-only engine on :3100 (e.g.
  // /api/v2/market/cache), which owns market data, jobs and strategies. The
  // retired :3000 UI server is not used; :3100 is loopback-only.
  const size = Number(req.headers['content-length'] || 0);
  if (size > MAX_UPLOAD) {
    const body = JSON.stringify({ error: 'payload_too_large', limit: MAX_UPLOAD });
    res.writeHead(413, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
    res.end(body);
    req.destroy();
    return;
  }
  const headers = upstreamHeaders(req.headers, STRAGY_PORT);
  // The engine rejects cross-origin writes when Origin.host !== Host. The
  // browser's origin is :4300 but this hop is loopback :3100, so present the
  // same-origin value the engine expects. The proxy is the only client.
  if (headers.origin) headers.origin = `http://127.0.0.1:${STRAGY_PORT}`;
  delete headers.referer;
  pipeToUpstream(req, res, STRAGY_PORT, req.url, headers);
}

// ----------------------------------------------------------------------- tts
/**
 * Small authenticated TTS fallback: espeak-ng -v ta|en -> WAV. The UI uses it
 * only when the browser has no Tamil/English speechSynthesis voice. No shell,
 * fixed argv, bounded text/body and a hard timeout; the WAV is streamed back
 * from a temp file that is always unlinked.
 */
let ttsEngineCache = null;
function ttsEngine() {
  if (ttsEngineCache !== null) return ttsEngineCache;
  try {
    const r = spawnSync('espeak-ng', ['--version'], { encoding: 'utf8', timeout: 3000 });
    ttsEngineCache = r.status === 0 && /eSpeak NG/i.test(String(r.stdout || ''));
  } catch {
    ttsEngineCache = false;
  }
  return ttsEngineCache;
}

function ttsJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    ...SECURITY,
  });
  res.end(body);
}

function readBoundedBody(req, max, cb) {
  const declared = Number(req.headers['content-length'] || 0);
  if (declared > max) { cb(null, 'body_too_large'); return; }
  let size = 0;
  const chunks = [];
  let done = false;
  req.on('data', (chunk) => {
    if (done) return;
    size += chunk.length;
    if (size > max) { done = true; cb(null, 'body_too_large'); req.destroy(); return; }
    chunks.push(chunk);
  });
  req.on('end', () => { if (!done) { done = true; cb(Buffer.concat(chunks), null); } });
  req.on('error', () => { if (!done) { done = true; cb(null, 'read_error'); } });
}

function handleTts(req, res) {
  if (req.method === 'GET') {
    return ttsJson(res, 200, {
      available: ttsEngine(),
      engine: 'espeak-ng',
      languages: ['ta', 'en'],
      maxText: TTS_MAX_TEXT,
      note: 'Robotic formant speech; used only when the device has no system voice.',
    });
  }
  if (req.method !== 'POST') {
    res.writeHead(405, { allow: 'GET, POST', ...SECURITY }); res.end('Method not allowed'); return;
  }
  if (!ttsEngine()) return ttsJson(res, 503, { error: 'tts_unavailable', reason: 'espeak-ng is not installed on the proxy host.' });
  readBoundedBody(req, TTS_MAX_BODY, (buf, error) => {
    if (error) return ttsJson(res, error === 'body_too_large' ? 413 : 400, { error });
    let input;
    try { input = JSON.parse(buf.toString('utf8')); } catch { return ttsJson(res, 400, { error: 'invalid_json' }); }
    const rawText = input?.text;
    if (typeof rawText !== 'string' || !rawText.trim()) return ttsJson(res, 400, { error: 'text_required' });
    const text = rawText.replace(/\0/g, '').slice(0, TTS_MAX_TEXT).trim();
    if (!text) return ttsJson(res, 400, { error: 'text_required' });
    const lang = input.lang === 'ta' ? 'ta' : 'en';
    const tmp = path.join(os.tmpdir(), `stragy-tts-${crypto.randomUUID()}.wav`);
    let settled = false;
    const cleanup = () => { try { fs.unlinkSync(tmp); } catch { /* already gone */ } };
    const finish = (status, body, headers) => {
      if (settled) return;
      settled = true;
      res.writeHead(status, { 'cache-control': 'no-store', ...SECURITY, ...(headers || {}) });
      res.end(body);
    };
    const child = spawn('espeak-ng', ['-v', lang, '-s', '145', '-w', tmp, '--', text], { windowsHide: true });
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ignore */ } }, TTS_TIMEOUT_MS);
    let stderr = '';
    child.stderr?.on('data', (d) => { stderr = (stderr + d).slice(-400); });
    child.on('error', (err) => {
      clearTimeout(timer); cleanup();
      finish(502, JSON.stringify({ error: 'tts_spawn_failed', message: String(err?.message || err) }), { 'content-type': 'application/json' });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        cleanup();
        log(`tts espeak-ng failed code=${code} ${stderr}`);
        return finish(502, JSON.stringify({ error: 'tts_failed' }), { 'content-type': 'application/json' });
      }
      let bytes = 0;
      try {
        const wav = fs.readFileSync(tmp);
        if (wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF') throw new Error('bad wav');
        bytes = wav.length;
        finish(200, wav, { 'content-type': 'audio/wav', 'content-length': wav.length, 'accept-ranges': 'none' });
      } catch {
        finish(502, JSON.stringify({ error: 'tts_bad_output' }), { 'content-type': 'application/json' });
      } finally {
        cleanup();
        log(`tts ${lang} ${text.length} chars -> ${bytes} bytes`);
      }
    });
  });
}

// -------------------------------------------------------------------- static
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
};

function serveStatic(req, res, pathname) {
  let decoded = pathname;
  try { decoded = decodeURIComponent(pathname); } catch { /* keep raw */ }
  if (decoded.includes('\0') || decoded.split('/').some((s) => s === '..' || s === '.')) {
    res.writeHead(400); res.end('Bad request'); return;
  }
  const target = path.resolve(DIST, '.' + decoded);
  if (target !== DIST && !target.startsWith(DIST + path.sep)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  const serve = (file) => {
    let stat;
    try { stat = fs.statSync(file); } catch { return false; }
    if (!stat.isFile()) return false;
    const ext = path.extname(file).toLowerCase();
    const headers = {
      'content-type': MIME[ext] || 'application/octet-stream',
      'content-length': stat.size,
      ...SECURITY,
    };
    if (ext === '.html') {
      headers['content-security-policy'] = CSP;
      headers['cache-control'] = 'no-cache';
    }
    if (req.method === 'HEAD') {
      res.writeHead(200, headers); res.end(); return true;
    }
    const stream = fs.createReadStream(file);
    stream.on('error', () => { if (!res.headersSent) { res.writeHead(500); res.end(); } });
    res.writeHead(200, headers);
    stream.pipe(res);
    return true;
  };
  // dotfiles: deny. Only the app's own files live in DIST.
  if (path.basename(target).startsWith('.')) { res.writeHead(404); res.end('Not found'); return; }
  if (target !== DIST && serve(target)) return;
  // SPA fallback for client-side routes.
  for (const fallback of ['index.html', 'frontend.html']) {
    if (serve(path.join(DIST, fallback))) return;
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Stragy frontend build missing — run npm run build:frontend');
}

// -------------------------------------------------------------------- server
const server = http.createServer((req, res) => {
  let pathname = '/';
  try { pathname = new URL(req.url, 'http://proxy.local').pathname; } catch { /* keep / */ }

  if (pathname === '/healthz') {
    const body = JSON.stringify({ ok: true, service: 'stragy-frontend-proxy' });
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' });
    res.end(body);
    return;
  }

  if (!authorized(req)) { log(`401 ${req.method} ${pathname}`); return unauthorized(res); }

  if (pathname === '/tts' || pathname === '/tts/voices') {
    return handleTts(req, res);
  }

  if (pathname === '/opencode' || pathname.startsWith('/opencode/')) {
    return proxyOpenCode(req, res, req.url.slice('/opencode'.length) || '/');
  }
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    return proxyStragy(req, res);
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405); res.end('Method not allowed'); return;
  }
  return serveStatic(req, res, pathname);
});

// WebSocket / upgrade passthrough for /opencode/* (future-proofs realtime
// signalling). Raw bytes are piped; the gate still applies its deny rules.
server.on('upgrade', (req, socket, head) => {
  let pathname = '/';
  try { pathname = new URL(req.url, 'http://proxy.local').pathname; } catch { /* keep / */ }
  if (!authorized(req) || !(pathname === '/opencode' || pathname.startsWith('/opencode/'))) {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    return;
  }
  const up = net.connect(GATE_PORT, '127.0.0.1');
  up.on('connect', () => {
    let raw = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
    for (const [key, value] of Object.entries(req.headers)) {
      if (key.toLowerCase() === 'authorization') {
        raw += `authorization: ${basic('opencode', opencodePassword())}\r\n`;
      } else if (Array.isArray(value)) {
        for (const v of value) raw += `${key}: ${v}\r\n`;
      } else {
        raw += `${key}: ${value}\r\n`;
      }
    }
    raw += '\r\n';
    up.write(raw);
    if (head && head.length) up.write(head);
    up.pipe(socket);
    socket.pipe(up);
  });
  up.on('error', () => socket.destroy());
  socket.on('error', () => up.destroy());
  socket.on('close', () => up.destroy());
});

// Long-lived SSE and slow uploads must never be timed out by the proxy.
server.timeout = 0;
server.requestTimeout = 0;
server.headersTimeout = 0;
server.keepAliveTimeout = 0;
server.listen(PORT, HOST, () => {
  log(`listening on http://${HOST}:${PORT} (gate=:${GATE_PORT}, stragy=:${STRAGY_PORT}, dist=${DIST})`);
  console.log(`Stragy frontend proxy on http://${HOST}:${PORT}`);
});
