/**
 * UI gate security regressions.
 *
 * Covers the proven bypasses found in the 2026-11-19 review:
 *  - x-opencode-directory header escaped the directory pin (requests+upgrades)
 *  - GET /api/fs/list?path= enumerated arbitrary host directories
 *  - PATCH /api/experimental/config and POST /api/location/reload passed through
 *  - text/plain JSON session-create bodies escaped agent/directory inspection
 *  - metadata routes /api/mcp, /api/websearch, /api/location, /api/project
 *    were not redacted
 *
 * Live tests use node:http against ephemeral loopback ports (the offline
 * test setup stubs global fetch; loopback sockets are the gate's own medium).
 */
import { describe, it, expect } from 'vitest';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  isBlocked,
  shouldRedact,
  redactSecrets,
  headerDirectoryBlocked,
  fsListAllowed,
  pathInsideWorkspace,
  createGateServer,
  ALLOWED_DIRECTORY,
} from '../../../scripts/ui-gate.mjs';

describe('ui-gate directory pinning via headers', () => {
  it('allows absent, empty and workspace-scoped directory headers', () => {
    expect(headerDirectoryBlocked({})).toBe(false);
    expect(headerDirectoryBlocked({ 'x-opencode-directory': '' })).toBe(false);
    expect(headerDirectoryBlocked({ 'x-opencode-directory': ALLOWED_DIRECTORY })).toBe(false);
    expect(headerDirectoryBlocked({ 'x-opencode-directory': ALLOWED_DIRECTORY + '/' })).toBe(false);
    expect(headerDirectoryBlocked({ 'x-opencode-directory': ALLOWED_DIRECTORY + '/sub' })).toBe(false);
  });

  it('blocks foreign directory headers regardless of case or array form', () => {
    expect(headerDirectoryBlocked({ 'x-opencode-directory': '/etc' })).toBe(true);
    expect(headerDirectoryBlocked({ 'X-OpenCode-Directory': '/data/home' })).toBe(true);
    expect(headerDirectoryBlocked({ 'x-opencode-directory': [ALLOWED_DIRECTORY, '/etc'] })).toBe(true);
    expect(headerDirectoryBlocked({ 'x-opencode-directory': ALLOWED_DIRECTORY + '/../../etc' })).toBe(true);
  });
});

describe('ui-gate fs/list containment', () => {
  it('allows workspace-scoped and default listings', () => {
    expect(fsListAllowed('/api/fs/list')).toBe(true);
    expect(fsListAllowed('/api/fs/list?path=' + encodeURIComponent(ALLOWED_DIRECTORY))).toBe(true);
    expect(pathInsideWorkspace('')).toBe(true);
  });

  it('blocks foreign, escaping and nonexistent paths', () => {
    expect(fsListAllowed('/api/fs/list?path=/etc')).toBe(false);
    expect(fsListAllowed('/api/fs/list?path=' + encodeURIComponent(ALLOWED_DIRECTORY + '/../../..'))).toBe(false);
    expect(fsListAllowed('/api/fs/list?path=/no/such/stragy/dir')).toBe(false);
    expect(fsListAllowed('/api/fs/list?location=/etc')).toBe(false);
    expect(isBlocked('/api/fs/list?path=/etc', 'GET')).toBe('fs');
    expect(isBlocked('/api/fs/list', 'GET')).toBeNull();
  });
});

describe('ui-gate config-write and location denies', () => {
  it('blocks experimental config writes and location reload/mutations', () => {
    expect(isBlocked('/api/experimental/config', 'PATCH')).toBe('experimental-config');
    expect(isBlocked('/api/experimental/config', 'GET')).toBe('experimental-config');
    expect(isBlocked('/api/location/reload', 'POST')).toBe('location-reload');
    expect(isBlocked('/api/location', 'POST')).toBe('location-mutate');
    expect(isBlocked('/api/location', 'DELETE')).toBe('location-mutate');
    expect(isBlocked('/api/location', 'GET')).toBeNull();
  });

  it('redacts the additional metadata route families', () => {
    expect(shouldRedact('/api/mcp')).toBe(true);
    expect(shouldRedact('/api/websearch/provider')).toBe(true);
    expect(shouldRedact('/api/location')).toBe(true);
    expect(shouldRedact('/api/project')).toBe(true);
  });

  it('still redacts secret-looking keys and session key literals', () => {
    const out = redactSecrets({ apiKey: 'sk-abc', nested: { token: 't', safe: 1 }, lit: 'oc_sk_abc123' });
    expect(out.apiKey).toBe('redacted_by_stragy_gate');
    expect(out.nested.token).toBe('redacted_by_stragy_gate');
    expect(out.nested.safe).toBe(1);
    expect(out.lit).toBe('redacted_by_stragy_gate');
  });
});

interface GateReply { status: number; body: Record<string, unknown>; }

/** Loopback HTTP request helper (global fetch is stubbed by the offline setup). */
function gateRequest(base: string, reqPath: string, opts: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<GateReply> {
  return new Promise((resolve, reject) => {
    const u = new URL(reqPath, base);
    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method: opts.method ?? 'GET',
      headers: opts.headers ?? {},
      agent: false,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let body: Record<string, unknown> = {};
        try { body = JSON.parse(text); } catch { /* non-JSON denial bodies stay opaque */ }
        resolve({ status: res.statusCode ?? 0, body });
      });
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

/** Run a real gate in front of a counting stub upstream on ephemeral ports. */
async function withGate(fn: (base: string, upstreamHits: () => number) => Promise<void>) {
  let hits = 0;
  const upstream = http.createServer((req, res) => {
    hits += 1;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, url: req.url, dir: req.headers['x-opencode-directory'] ?? null }));
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const logDir = mkdtempSync(path.join(tmpdir(), 'stragy-gate-test-'));
  const gate = createGateServer({
    publicPort: 0,
    internalPort: (upstream.address() as { port: number }).port,
    logFile: path.join(logDir, 'gate.log'),
  });
  gate.listen(0, '127.0.0.1');
  await once(gate, 'listening');
  const base = `http://127.0.0.1:${(gate.address() as { port: number }).port}`;
  try {
    await fn(base, () => hits);
  } finally {
    gate.close();
    upstream.close();
    (gate as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
    (upstream as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
    rmSync(logDir, { recursive: true, force: true });
  }
}

describe('ui-gate live request filtering', () => {
  it('denies foreign x-opencode-directory headers before they reach OpenCode', async () => {
    await withGate(async (base, hits) => {
      const res = await gateRequest(base, '/api/config', { headers: { 'x-opencode-directory': '/etc' } });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('blocked_by_stragy_gate');
      expect(res.body.reason).toBe('directory');
      expect(hits()).toBe(0);
    });
  });

  it('forwards workspace-scoped and absent directory headers', async () => {
    await withGate(async (base, hits) => {
      const scoped = await gateRequest(base, '/api/config', { headers: { 'x-opencode-directory': ALLOWED_DIRECTORY } });
      expect(scoped.status).toBe(200);
      const plain = await gateRequest(base, '/api/config');
      expect(plain.status).toBe(200);
      expect(hits()).toBe(2);
    });
  });

  it('denies fs/list outside the workspace but allows the default listing', async () => {
    await withGate(async (base, hits) => {
      const bad = await gateRequest(base, '/api/fs/list?path=/etc');
      expect(bad.status).toBe(403);
      const ok = await gateRequest(base, '/api/fs/list');
      expect(ok.status).toBe(200);
      expect(hits()).toBe(1);
    });
  });

  it('inspects text/plain JSON session-create bodies for agent and directory', async () => {
    await withGate(async (base, hits) => {
      const badAgent = await gateRequest(base, '/api/session', {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: JSON.stringify({ agent: 'build' }),
      });
      expect(badAgent.status).toBe(403);
      expect(badAgent.body.reason).toBe('agent');

      const badDir = await gateRequest(base, '/api/session', {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: JSON.stringify({ directory: '/etc' }),
      });
      expect(badDir.status).toBe(403);
      expect(badDir.body.reason).toBe('directory');

      const good = await gateRequest(base, '/api/session', {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: JSON.stringify({ agent: 'stragy' }),
      });
      expect(good.status).toBe(200);
      expect(hits()).toBe(1);
    });
  });

  it('denies config-write and location-reload surfaces end to end', async () => {
    await withGate(async (base, hits) => {
      const patch = await gateRequest(base, '/api/experimental/config', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ shell: '/bin/sh' }),
      });
      expect(patch.status).toBe(403);
      const reload = await gateRequest(base, '/api/location/reload', { method: 'POST' });
      expect(reload.status).toBe(403);
      expect(hits()).toBe(0);
    });
  });
});
