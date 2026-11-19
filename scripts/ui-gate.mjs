#!/usr/bin/env node
/**
 * Stragy UI gate — a tiny loopback reverse proxy placed in front of
 * `opencode serve`.
 *
 * The public tunnel still terminates on $PUBLIC_PORT (default 4200), but that
 * socket is now owned by this gate. `opencode serve` listens only on
 * 127.0.0.1:$INTERNAL_PORT (default 4201). Every request/upgrade is forwarded
 * verbatim (method, path, query, headers incl. Host, and streamed bodies), so
 * the login flow, SSE `/api/event`, uploads and all chat/tool calls are
 * unchanged. The only differences are:
 *   1. dangerous API families are rejected with 403 before reaching OpenCode;
 *   2. `directory` selection is pinned to the Stragy workspace, so the UI
 *      cannot be pointed at another project's config/plugins.
 *
 * Set STRAGY_UI_GATE=off to disable filtering. This is for LOCAL DEBUGGING
 * ONLY — it re-opens the shell/PTY/file/plugin APIs to anyone with the UI
 * password and must never be used on a published port.
 */
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { appendFileSync, mkdirSync, realpathSync } from 'node:fs';

export const DEFAULT_LOG = '/tmp/opencode/ui-gate.log';
export const ALLOWED_DIRECTORY = '/data/home/oc-import/Stragy/opencode-app-data/workspace';

// Read-only metadata routes are needed by the UI, but they can echo provider
// settings (plaintext API keys). Their JSON responses are buffered, redacted
// and re-emitted. Streaming routes (/api/event, chat, uploads) are untouched.
const REDACT_PREFIXES = ['/api/config', '/api/provider', '/api/model', '/api/info', '/api/agent', '/api/integration', '/api/credential', '/api/experimental/voice', '/api/experimental/mcp'];
const SECRET_KEY_RE = /(api[-_]?key|token|secret|password|authorization|bearer)/i;
const MAX_REDACT_BYTES = 32 * 1024 * 1024;

export function shouldRedact(rawUrl) {
  const p = decodePath(rawUrl).split('?')[0].toLowerCase();
  return REDACT_PREFIXES.some(base => p === base || p.startsWith(base + '/'));
}

/** Recursively replace secret-looking keys and known key literals. */
export function redactSecrets(value) {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, v] of Object.entries(value)) {
      out[key] = SECRET_KEY_RE.test(key) ? 'redacted_by_stragy_gate' : redactSecrets(v);
    }
    return out;
  }
  if (typeof value === 'string') return value.replace(/oc_sk_[A-Za-z0-9_-]+/g, 'redacted_by_stragy_gate');
  return value;
}

// ---------------------------------------------------------------- path rules
const seg = (base) => (p) => p === base || p.startsWith(base + '/');
const start = (s) => (p) => p.startsWith(s);
const re = (pattern) => (p) => pattern.test(p);

/**
 * Ordered deny rules. Each entry matches the URL-decoded, lower-cased
 * pathname. Everything not matched here is passed through untouched.
 */
const RULES = [
  { name: 'pty',                       test: seg('/api/pty') },
  { name: 'shell',                     test: seg('/api/shell') },
  { name: 'session-shell',             test: re(/^\/api\/session\/[^/]+\/shell(?:\/|$)/) },
  { name: 'persistent-pty',            test: seg('/api/experimental/persistent-pty') },
  { name: 'session-terminal',          test: re(/^\/api\/experimental\/session\/[^/]+\/terminal(?:\/|$)/) },
  { name: 'fs',                        test: seg('/api/fs') },
  { name: 'experimental-fs',           test: seg('/api/experimental/fs') },
  { name: 'credential',                test: start('/api/credential') },
  { name: 'debug',                     test: seg('/api/debug') },
  { name: 'plugin',                    test: start('/api/plugin') },
  { name: 'experimental-mcp',          test: start('/api/experimental/mcp') },
  { name: 'experimental-client-mcp',   test: start('/api/experimental/client-mcp') },
  { name: 'rpc',                       test: seg('/api/rpc') },
  { name: 'worktree',                  test: start('/api/worktree') },
  { name: 'vcs-init',                  test: re(/^\/api\/vcs\/init(?:\/|$)/) },
  { name: 'experimental-generate',     test: start('/api/experimental/generate') },
  { name: 'experimental-integration',  test: start('/api/experimental/integration') },
  { name: 'integration',               test: start('/api/integration') },
  { name: 'session-environment',       test: re(/^\/api\/session\/[^/]+\/environment(?:\/|$)/) },
  { name: 'session-move',              test: re(/^\/api\/session\/[^/]+\/move(?:\/|$)/) },
  { name: 'session-import',            test: re(/^\/api\/experimental\/session\/import(?:\/|$)/) },
  { name: 'experimental-migration',    test: start('/api/experimental/migration') },
];

/** Decode the pathname once (case preserved) for logs / error bodies. */
export function decodePath(rawUrl) {
  let pathname = rawUrl || '/';
  try { pathname = new URL(pathname, 'http://gate.local').pathname; } catch { /* keep raw */ }
  try { pathname = decodeURIComponent(pathname); } catch { /* keep partially decoded */ }
  return pathname;
}

/**
 * Narrow exceptions for read-only calls the OpenCode UI makes on load/poll.
 * Everything else in these families stays blocked (install/connect/create/
 * remove/execute). Checked before the deny rules; exact method + path only.
 */
const ALLOW_READONLY = [
  { method: 'GET',  path: '/api/integration' },                     // read-only status
  { method: 'POST', path: '/api/rpc/opencode.goal/get' },           // read-only goal poll (POST is the RPC envelope)
  { method: 'POST', path: '/api/worktree/refresh' },                // read-only refresh
  { method: 'GET',  path: '/api/experimental/mcp' },                // MCP list only
  { method: 'GET',  path: '/api/experimental/voice/models' },       // voice/TTS model list
  { method: 'POST', path: '/api/experimental/voice/session' },      // speech-to-speech session (no shell/file access)
];

/**
 * Read-only UI routes outside the narrow ALLOW_READONLY list. File reads are
 * additionally restricted to real files inside the Stragy workspace.
 */
function fsReadAllowed(decodedPath) {
  const prefix = '/api/fs/read/';
  if (!decodedPath.toLowerCase().startsWith(prefix)) return false;
  let rel = decodedPath.slice(prefix.length);
  try { rel = decodeURIComponent(rel); } catch { return false; }
  rel = rel.replace(/\\/g, '/');
  if (rel.includes('\0')) return false;
  const abs = rel.startsWith('/') ? rel : path.join(ALLOWED_DIRECTORY, rel);
  let real, root;
  try { real = realpathSync(abs); } catch { return false; }
  try { root = realpathSync(ALLOWED_DIRECTORY); } catch { root = ALLOWED_DIRECTORY; }
  return real === root || real.startsWith(root + '/');
}

function readOnlySafePath(decodedPath, lowerPath, method) {
  if (method !== 'GET') return false;
  const p = lowerPath;
  if (p === '/api/worktree' || p === '/api/plugin' || p === '/api/plugin/gui' ||
      p === '/api/fs/list' || p === '/api/shell' || p === '/api/pty') return true;
  if (p === '/api/credential' || /^\/api\/credential\/[^/]+$/.test(p)) return true;
  if (/^\/api\/pty\/[^/]+$/.test(p)) return true; // status only; /connect is not matched
  if (p.startsWith('/api/fs/read/')) return fsReadAllowed(decodedPath);
  return false;
}

/**
 * Return the deny-rule name when a request must be blocked, else null.
 * `method` is used only for method-specific narrowing.
 */
export function isBlocked(rawUrl, method = 'GET') {
  const decodedPath = decodePath(rawUrl);
  const p = decodedPath.toLowerCase();
  const upper = String(method).toUpperCase();
  for (const allow of ALLOW_READONLY) {
    if (upper === allow.method && p === allow.path) return null;
  }
  if (readOnlySafePath(decodedPath, p, upper)) return null;
  // /api/mcp GET is the read-only tool list the chat needs. PUT/POST install
  // or reconfigure MCP servers, which is arbitrary code execution.
  if (p === '/api/mcp' && ['POST', 'PUT'].includes(upper)) return 'mcp-mutate';
  // Switching a session to a built-in agent (Build/Plan/General/Explore) is a
  // chat-level RCE: those agents have full host shell/file tools.
  if (['POST', 'PUT', 'PATCH'].includes(upper) && /^\/api\/session\/[^/]+\/agent(?:\/|$)/.test(p)) return 'agent-switch';
  for (const rule of RULES) if (rule.test(p)) return rule.name;
  return null;
}

// --------------------------------------------------------- directory pinning
function normalizeDir(value) {
  let s = String(value ?? '').trim();
  try { s = decodeURIComponent(s); } catch { /* keep as-is */ }
  s = s.replace(/\\/g, '/');
  const absolute = s.startsWith('/');
  const parts = [];
  for (const part of s.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { parts.pop(); continue; }
    parts.push(part);
  }
  let out = (absolute ? '/' : '') + parts.join('/');
  if (out.length > 1 && out.endsWith('/')) out = out.slice(0, -1);
  return out;
}
const ALLOWED_NORM = normalizeDir(ALLOWED_DIRECTORY);

function directoryAllowed(value) {
  const norm = normalizeDir(value);
  if (norm === '') return true; // empty value == "no directory"
  return norm === ALLOWED_NORM || norm.startsWith(ALLOWED_NORM + '/');
}

/** Check every query key whose name mentions "directory". */
function queryDirectoryBlocked(rawUrl) {
  try {
    const u = new URL(rawUrl, 'http://gate.local');
    for (const [key, value] of u.searchParams) {
      if (/directory/i.test(key) && !directoryAllowed(value)) return true;
    }
  } catch { /* malformed URL: let OpenCode handle it */ }
  return false;
}

/** Recursively collect values of any key mentioning "directory". */
function collectDirValues(obj, out = []) {
  if (Array.isArray(obj)) {
    for (const item of obj) collectDirValues(item, out);
  } else if (obj && typeof obj === 'object') {
    for (const [key, value] of Object.entries(obj)) {
      if (/directory/i.test(key) && typeof value === 'string') out.push(value);
      else collectDirValues(value, out);
    }
  }
  return out;
}

/**
 * Session creation may only use the Stragy agent. Absent agent is fine; any
 * other value (including parent/fork sessions that carry an agent) is denied.
 */
function bodyAgentBlocked(rawUrl, method, contentType, buffer) {
  if (String(method).toUpperCase() !== 'POST') return false;
  if (decodePath(rawUrl).split('?')[0].toLowerCase() !== '/api/session') return false;
  if (!buffer.length || !String(contentType || '').toLowerCase().includes('application/json')) return false;
  try {
    const obj = JSON.parse(buffer.toString('utf8'));
    if (!obj || typeof obj !== 'object' || !('agent' in obj)) return false;
    return obj.agent !== 'stragy';
  } catch { return false; }
}

/**
 * Only routes that can choose a session/project directory or agent need their
 * body inspected. Prompt/command/upload bodies can be large (base64 images)
 * and must stream through untouched.
 */
function bodyInspectionRoute(rawUrl, method) {
  const p = decodePath(rawUrl).split('?')[0].toLowerCase();
  if (method === 'POST' && p === '/api/session') return true;
  if (method === 'POST' && p === '/api/project') return true;
  if (method === 'PATCH' && /^\/api\/project\/[^/]+$/.test(p)) return true;
  return false;
}

/** Check the (peeked) JSON / form body for an out-of-scope directory. */
function bodyDirectoryBlocked(contentType, buffer) {
  if (!buffer.length) return false;
  const ct = String(contentType || '').toLowerCase();
  const text = buffer.toString('utf8');
  try {
    if (ct.includes('application/json')) {
      return collectDirValues(JSON.parse(text)).some(v => !directoryAllowed(v));
    }
    if (ct.includes('x-www-form-urlencoded')) {
      for (const [key, value] of new URLSearchParams(text)) {
        if (/directory/i.test(key) && !directoryAllowed(value)) return true;
      }
    }
  } catch { /* unparseable body: pass through, query check still applies */ }
  return false;
}

// ------------------------------------------------------------------- server
export function createGateServer({
  publicPort = 4200,
  internalPort = 4201,
  host = '127.0.0.1',
  filtering = true,
  logFile = DEFAULT_LOG,
} = {}) {
  mkdirSync(path.dirname(logFile), { recursive: true });

  function logBlock(decoded, reason) {
    const line = `${new Date().toISOString()} BLOCK reason=${reason} path=${JSON.stringify(decoded)}\n`;
    try { appendFileSync(logFile, line); } catch { /* never fail a request on logging */ }
  }
  function deny(res, decoded, reason, extra = {}) {
    logBlock(decoded, reason);
    const body = JSON.stringify({ error: 'blocked_by_stragy_gate', ...extra, path: decoded });
    if (!res.headersSent) {
      res.writeHead(403, {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        'cache-control': 'no-store',
      });
    }
    res.end(body);
  }
  function denyWithReason(res, decoded, reason) {
    logBlock(decoded, reason);
    const body = JSON.stringify({ error: 'blocked_by_stragy_gate', reason });
    res.writeHead(403, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' });
    res.end(body);
  }
  const denyDirectory = (res, decoded) => denyWithReason(res, decoded, 'directory');

  function proxyRequest(req, res, decoded, buffered = Buffer.alloc(0), bodyComplete = true, redact = false) {
    let upstreamResponse = null;
    // Ask for plain JSON on redacted routes so the body can be parsed safely.
    const requestHeaders = redact ? { ...req.headers, 'accept-encoding': 'identity' } : req.headers;
    const proxy = http.request({
      hostname: '127.0.0.1',
      port: internalPort,
      method: req.method,
      path: req.url,                 // path + query, verbatim
      headers: requestHeaders,       // includes the original Host header
      agent: false,
    }, (upRes) => {
      upstreamResponse = upRes;
      if (!redact) {
        res.writeHead(upRes.statusCode || 502, upRes.headers);
        upRes.pipe(res);             // streaming, no buffering (SSE safe)
        return;
      }
      // Metadata route: buffer the JSON, redact secret fields, re-emit.
      const chunks = [];
      let size = 0;
      upRes.on('data', (chunk) => { size += chunk.length; if (size <= MAX_REDACT_BYTES) chunks.push(chunk); });
      upRes.on('error', () => res.destroy());
      upRes.on('end', () => {
        if (size > MAX_REDACT_BYTES) {
          const body = JSON.stringify({ error: 'gate_response_too_large' });
          res.writeHead(502, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
          res.end(body);
          return;
        }
        const raw = Buffer.concat(chunks);
        let out;
        try {
          const parsed = JSON.parse(raw.toString('utf8'));
          // The UI uses persistentPty capability to offer a terminal and to
          // probe shell/worktree/rpc endpoints. The API is 403 at this gate,
          // so advertise it as unavailable and avoid the misleading toggle.
          const p = decodePath(req.url).split('?')[0].toLowerCase();
          if (p === '/api/info' && parsed?.capabilities && typeof parsed.capabilities === 'object') {
            parsed.capabilities.persistentPty = false;
          }
          out = Buffer.from(JSON.stringify(redactSecrets(parsed)));
        } catch {
          out = Buffer.from(raw.toString('utf8').replace(/oc_sk_[A-Za-z0-9_-]+/g, 'redacted_by_stragy_gate'));
        }
        const headers = { ...upRes.headers };
        delete headers['content-length'];
        delete headers['transfer-encoding'];
        delete headers['content-encoding'];
        delete headers['etag'];
        headers['content-type'] = 'application/json';
        headers['content-length'] = Buffer.byteLength(out);
        res.writeHead(upRes.statusCode || 200, headers);
        res.end(out);
      });
    });
    proxy.on('error', (err) => {
      if (!res.headersSent) {
        const body = JSON.stringify({ error: 'gate_upstream_error', message: String(err && err.message || err) });
        res.writeHead(502, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
        res.end(body);
      } else {
        res.destroy();
      }
    });
    req.on('error', () => proxy.destroy());
    res.on('close', () => { proxy.destroy(); if (upstreamResponse) upstreamResponse.destroy(); });

    if (buffered.length) proxy.write(buffered);
    if (bodyComplete) proxy.end();
    else req.pipe(proxy);
  }

  // Buffer only the small bodies that can choose a directory/agent (session
  // creation, project add/update). Prompt bodies, including base64 image
  // attachments, are streamed untouched; the directory is pinned by the query
  // check and the session is already fixed. An oversized body on an inspected
  // route is denied rather than allowed as a bypass.
  const PEEK_LIMIT = 64 * 1024;
  function forwardWithPeek(req, res, decoded) {
    const chunks = [];
    let size = 0;
    let finished = false;
    const cleanup = () => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
    };
    const onError = () => { cleanup(); res.destroy(); };
    const deliver = () => {
      if (finished) return;
      finished = true;
      cleanup();
      const buffered = Buffer.concat(chunks);
      if (filtering && bodyAgentBlocked(req.url, req.method, req.headers['content-type'], buffered)) {
        return denyWithReason(res, decoded, 'agent');
      }
      if (filtering && bodyDirectoryBlocked(req.headers['content-type'], buffered)) {
        return denyDirectory(res, decoded);
      }
      proxyRequest(req, res, decoded, buffered, true, filtering && shouldRedact(req.url));
    };
    const onData = (chunk) => {
      size += chunk.length;
      if (size > PEEK_LIMIT) {
        if (!finished) {
          finished = true;
          cleanup();
          denyWithReason(res, decoded, 'body-too-large');
          req.destroy();
        }
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => deliver(true);
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  }

  const server = http.createServer((req, res) => {
    const decoded = decodePath(req.url);
    const reason = filtering ? isBlocked(req.url, req.method) : null;
    if (reason) return deny(res, decoded, reason);
    if (filtering && queryDirectoryBlocked(req.url)) return denyDirectory(res, decoded);

    const method = String(req.method).toUpperCase();
    const ct = String(req.headers['content-type'] || '').toLowerCase();
    const peekable = filtering && bodyInspectionRoute(req.url, method) &&
      (ct.includes('application/json') || ct.includes('x-www-form-urlencoded'));
    if (peekable) return forwardWithPeek(req, res, decoded);
    // Not an inspection route: the request body (e.g. a prompt with a base64
    // image) must be streamed verbatim to OpenCode. bodyComplete=false makes
    // proxyRequest pipe req into the upstream request instead of ending it.
    return proxyRequest(req, res, decoded, Buffer.alloc(0), false, filtering && shouldRedact(req.url));
  });

  // WebSocket / upgrade traffic: pipe raw bytes in both directions. Blocked
  // paths (and out-of-scope directories) get a raw HTTP 403 then a close.
  server.on('upgrade', (req, socket, head) => {
    const decoded = decodePath(req.url);
    const reason = filtering ? isBlocked(req.url, req.method || 'GET') : null;
    const badDirectory = filtering && queryDirectoryBlocked(req.url);
    if (reason || badDirectory) {
      if (reason) logBlock(decoded, reason);
      else logBlock(decoded, 'directory');
      const body = JSON.stringify(reason
        ? { error: 'blocked_by_stragy_gate', path: decoded }
        : { error: 'blocked_by_stragy_gate', reason: 'directory' });
      socket.end(
        'HTTP/1.1 403 Forbidden\r\n' +
        'Content-Type: application/json\r\n' +
        'Content-Length: ' + Buffer.byteLength(body) + '\r\n' +
        'Connection: close\r\n\r\n' + body
      );
      return;
    }
    const up = net.connect(internalPort, '127.0.0.1');
    up.on('connect', () => {
      let raw = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
      for (const [key, value] of Object.entries(req.headers)) {
        if (Array.isArray(value)) for (const v of value) raw += `${key}: ${v}\r\n`;
        else raw += `${key}: ${value}\r\n`;
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

  // Long-lived SSE streams must never be timed out by the proxy.
  server.timeout = 0;
  server.requestTimeout = 0;
  server.headersTimeout = 0;
  server.keepAliveTimeout = 0;
  return server;
}

/** Start the gate and resolve once it is listening. */
export function startGate(options) {
  const server = createGateServer(options);
  const port = options.publicPort ?? 4200;
  const host = options.host ?? '127.0.0.1';
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}

export default { createGateServer, startGate, isBlocked, decodePath, DEFAULT_LOG, ALLOWED_DIRECTORY };
