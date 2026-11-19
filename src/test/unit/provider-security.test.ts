/**
 * Provider security regressions (2026-11-19 review):
 *  - built-in provider baseUrl overrides could exfiltrate env API keys
 *  - testProvider bypassed the free-only cost policy and hourly budget
 *  - DNS was validated only at write time (rebinding TOCTOU); registry
 *    fetches now re-validate every answer at connection time
 *  - redact() missed DATABASE_URL connection strings
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { redact } from '../../server/config';
import { createPinnedFetch, isPrivateIp } from '../../server/ai/netGuard';
import {
  initializeProviderRegistry, resetProviderRegistryCache, resetProviderRegistryForTests,
  setChain, setDnsLookupForTests, setProviderFetchForTests, testProvider, upsertProvider,
} from '../../server/ai/providerRegistry';
import { resetSecretsCache } from '../../server/ai/providerSecrets';

const KEY = Buffer.alloc(32, 7).toString('base64');
let dir = '';
const env = (): Record<string, string | undefined> => ({
  AI_PROVIDER: 'opencode-go', AI_MODEL: 'hy4-flash-free', AI_COST_POLICY: 'free-only',
  AI_PROVIDERS_FILE: join(dir, 'ai-providers.json'),
  OPENCODE_API_KEY: 'opencode-test-key', OPENROUTER_API_KEY: 'openrouter-test-key', OPENAI_API_KEY: 'openai-test-key',
  PROVIDER_SECRETS_KEY: KEY, HOST: '127.0.0.1', EXPOSURE_MODE: 'private', NODE_ENV: 'test',
});

let calls: { url: string; init: any }[] = [];
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'stragy-provider-security-'));
  resetProviderRegistryCache();
  resetProviderRegistryForTests();
  resetSecretsCache();
  setDnsLookupForTests((async () => [{ address: '93.184.216.34', family: 4 }]) as never);
  calls = [];
  setProviderFetchForTests(async (url: string, init?: any) => {
    calls.push({ url, init });
    return {
      ok: true, status: 200,
      headers: { get: () => null },
      json: async () => ({ model: 'hy4-flash-free', choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] }),
    };
  });
  await initializeProviderRegistry(env());
});
afterEach(() => {
  resetProviderRegistryCache();
  resetProviderRegistryForTests();
  setDnsLookupForTests(null);
  setProviderFetchForTests(null);
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe('built-in provider endpoint pinning', () => {
  it('rejects a baseUrl override on a built-in provider (env-key exfiltration path)', async () => {
    await expect(upsertProvider({
      id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://attacker.example/v1', enabled: true,
    }, env())).rejects.toMatchObject({ status: 400, code: 'BUILTIN_BASE_URL' });
  });

  it('still allows updating a built-in with its official endpoint', async () => {
    const updated = await upsertProvider({
      id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', enabled: false,
    }, env());
    expect(updated.baseUrl).toBe('https://openrouter.ai/api/v1');
    expect(updated.enabled).toBe(false);
  });
});

describe('testProvider cost policy and budget', () => {
  it('refuses a paid/unknown-price model under free-only without any request', async () => {
    const result = await testProvider('openai', { model: 'gpt-4o' }, env());
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not approved/i);
    expect(calls.length).toBe(0);
  });

  it('allows a verified free model and sends exactly one request', async () => {
    const result = await testProvider('opencode-go', { model: 'hy4-flash-free' }, env());
    expect(result.ok).toBe(true);
    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe('https://opencode.ai/inference/go/openai/v1/chat/completions');
  });

  it('allows a paid model only when the chain explicitly approves it', async () => {
    await setChain({ entries: [{ providerId: 'openai', model: 'gpt-4o', vision: true, paidApproved: true }] }, env());
    const result = await testProvider('openai', { model: 'gpt-4o' }, env());
    expect(result.ok).toBe(true);
    expect(calls.length).toBe(1);
  });
});

describe('redact() covers database connection strings', () => {
  it('scrubs DATABASE_URL values and generic postgres URLs', () => {
    vi.stubEnv('DATABASE_URL', 'postgres://stragy_owner:super-secret-pw@db.example.com:5432/stragy');
    const text = redact('connection failed: postgres://stragy_owner:super-secret-pw@db.example.com:5432/stragy');
    expect(text).not.toContain('super-secret-pw');
    expect(text).toContain('[REDACTED]');
    expect(redact('postgres://someone:else@other.host/db')).not.toContain('someone:else');
  });
});

describe('connection-time DNS pinning (rebinding defense)', () => {
  it('classifies private, link-local and metadata addresses', () => {
    expect(isPrivateIp('169.254.169.254')).toBe(true);
    expect(isPrivateIp('10.0.0.5')).toBe(true);
    expect(isPrivateIp('192.168.1.1')).toBe(true);
    expect(isPrivateIp('127.0.0.1')).toBe(true);
    expect(isPrivateIp('93.184.216.34')).toBe(false);
  });

  it('rejects a public hostname that rebinds to metadata or loopback at connect time', async () => {
    const rebind = createPinnedFetch(() => (async () => [{ address: '169.254.169.254', family: 4 }]) as never);
    await expect(rebind('http://rebind.example/latest/meta-data/')).rejects.toThrow(/private or metadata/i);
    const toLoopback = createPinnedFetch(() => (async () => [{ address: '127.0.0.1', family: 4 }]) as never);
    await expect(toLoopback('http://public.example/')).rejects.toThrow(/private or metadata/i);
  });

  it('serves an explicit loopback provider and exposes the fetch surface the AI layer uses', async () => {
    const upstream = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'x-test': 'yes' });
      res.end(JSON.stringify({ ok: true, path: req.url }));
    });
    upstream.listen(0, '127.0.0.1');
    await once(upstream, 'listening');
    const port = (upstream.address() as { port: number }).port;
    try {
      const pinned = createPinnedFetch();
      const res = await pinned(`http://127.0.0.1:${port}/v1/models`, { method: 'GET', headers: { Accept: 'application/json' } });
      expect(res.ok).toBe(true);
      expect(res.status).toBe(200);
      expect(res.headers.get('x-test')).toBe('yes');
      expect(await res.json()).toEqual({ ok: true, path: '/v1/models' });
      const textRes = await pinned(`http://127.0.0.1:${port}/text`);
      expect(typeof await textRes.text()).toBe('string');
    } finally {
      upstream.close();
      (upstream as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
    }
  });
});
