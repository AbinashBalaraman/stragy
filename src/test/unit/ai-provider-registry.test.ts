import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleAIChat } from '../../server/ai/copilot';
import { createProposal } from '../../server/ai/proposals';
import { createRequestBudget } from '../../server/ai/provider';
import { decryptSecret, encryptSecret, resetSecretsCache } from '../../server/ai/providerSecrets';
import {
  deleteProvider, getProvidersResponse, initializeProviderRegistry, resetProviderRegistryCache, resetProviderRegistryForTests,
  resolveActiveConfig, setChain, setDnsLookupForTests, upsertProvider, validateBaseUrl,
} from '../../server/ai/providerRegistry';
import { fakeResponse, openAIBody, recordingFetch, validStrategy } from '../../server/ai/testFixtures';

const KEY = Buffer.alloc(32, 7).toString('base64');
let dir = '';
const env = (): Record<string, string | undefined> => ({
  AI_PROVIDER: 'opencode-go', AI_MODEL: 'hy4-flash-free', AI_COST_POLICY: 'free-only',
  AI_FALLBACK_MODELS: 'openrouter:openrouter/free,opencode-go:deepseek-v4.1-flash',
  AI_APPROVED_PAID_MODELS: 'opencode-go:deepseek-v4.1-flash',
  AI_PROVIDERS_FILE: join(dir, 'ai-providers.json'),
  OPENCODE_API_KEY: 'opencode-test-key', OPENROUTER_API_KEY: 'openrouter-test-key',
  PROVIDER_SECRETS_KEY: KEY, HOST: '127.0.0.1', EXPOSURE_MODE: 'private', NODE_ENV: 'test',
});

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'stragy-providers-'));
  resetProviderRegistryCache();
  resetProviderRegistryForTests();
  resetSecretsCache();
  setDnsLookupForTests((async () => [{ address: '93.184.216.34', family: 4 }]) as never);
  await initializeProviderRegistry(env());
});
afterEach(() => {
  resetProviderRegistryCache();
  resetProviderRegistryForTests();
  setDnsLookupForTests(null);
  rmSync(dir, { recursive: true, force: true });
});

describe('provider registry', () => {
  it('reads the env chain in order: hy4 -> openrouter/free -> deepseek paid', () => {
    const status = getProvidersResponse(env());
    expect(status.chain.map(entry => `${entry.providerId}:${entry.model}`)).toEqual([
      'opencode-go:hy4-flash-free', 'openrouter:openrouter/free', 'opencode-go:deepseek-v4.1-flash',
    ]);
    expect(status.chain[2].paidApproved).toBe(true);
    expect(status.persistence).toBe('ephemeral');
    expect(status.writable).toBe(true);
    expect(status.secretsStorage).toBe('encrypted');
  });

  it('stores a custom provider without ever returning its key', async () => {
    const created = await upsertProvider({
      label: 'Dummy', baseUrl: 'https://example.com/v1', apiKey: 'test-key-1234', enabled: true,
      extraHeaders: { 'X-Test': 'yes' },
    }, env());
    expect(created.keySource).toBe('stored');
    expect(created.keyHint).toBe('…1234');
    const listed = getProvidersResponse(env());
    const saved = listed.providers.find(provider => provider.id === created.id)!;
    expect(saved.extraHeaderNames).toEqual(['X-Test']);
    expect(JSON.stringify(listed)).not.toContain('test-key-1234');
    expect(JSON.stringify(listed)).not.toContain('keyEnc');
    await deleteProvider(created.id, env());
    expect(getProvidersResponse(env()).providers.some(provider => provider.id === created.id)).toBe(false);
  });

  it('encrypts and decrypts a stored key round-trip', () => {
    const encrypted = encryptSecret('super-secret-key', env());
    expect(encrypted).toMatch(/^v1:/);
    expect(encrypted).not.toContain('super-secret-key');
    expect(decryptSecret(encrypted!, env())).toBe('super-secret-key');
    resetSecretsCache();
    expect(decryptSecret(encrypted!, { ...env(), PROVIDER_SECRETS_KEY: Buffer.alloc(32, 9).toString('base64') })).toBeNull();
  });

  it('blocks writes on a public non-loopback deployment', async () => {
    const readOnly = { ...env(), HOST: '0.0.0.0', EXPOSURE_MODE: 'public-research' };
    expect(getProvidersResponse(readOnly).writable).toBe(false);
    await expect(upsertProvider({ label: 'X', baseUrl: 'https://example.com', enabled: true }, readOnly)).rejects.toMatchObject({ status: 403 });
  });

  it('rejects SSRF base URLs', async () => {
    await expect(validateBaseUrl('http://10.0.0.1')).rejects.toMatchObject({ code: 'PRIVATE_BASE_URL' });
    await expect(validateBaseUrl('https://169.254.169.254')).rejects.toMatchObject({ code: 'PRIVATE_BASE_URL' });
    await expect(validateBaseUrl('http://example.com')).rejects.toMatchObject({ code: 'INVALID_BASE_URL' });
    await expect(validateBaseUrl('https://example.com/v1')).resolves.toBe('https://example.com/v1');
  });

  it('rejects a paid model without explicit approval and accepts it with approval', async () => {
    const paid = { providerId: 'opencode-go', model: 'deepseek-v4.1-flash', vision: false, paidApproved: false };
    await expect(setChain({ entries: [paid] }, env())).rejects.toMatchObject({ code: 'PAID_NOT_APPROVED' });
    const approved = await setChain({ entries: [{ ...paid, paidApproved: true }] }, env());
    expect(approved.chain[0].paidApproved).toBe(true);
    expect(resolveActiveConfig(env()).model).toBe('deepseek-v4.1-flash');
  });

  it('says a disabled primary is turned off in Settings, not missing its key', async () => {
    await setChain({ entries: [{ providerId: 'opencode-go', model: 'hy4-flash-free', vision: true, paidApproved: false }] }, env());
    await upsertProvider({ id: 'opencode-go', label: 'OpenCode Go', baseUrl: 'https://opencode.ai/inference/go/openai/v1', enabled: false }, env());
    const cfg = resolveActiveConfig(env());
    expect(cfg.state).toBe('disabled');
    expect(cfg.providerLabel).toBe('OpenCode Go');
    expect(cfg.keyPresent).toBe(true);
    const out = await handleAIChat({ message: 'Hello there' }, { env: env(), fetch: vi.fn(), budget: createRequestBudget() });
    expect(out.aiConnected).toBe(false);
    expect(out.reply).toContain('OpenCode Go is turned off in Settings → AI providers.');
    expect(out.reply).toContain('No answer was invented.');
    expect(out.reply).not.toContain('no API key');
  });

  it('still says a genuinely keyless provider has no API key', async () => {
    await setChain({ entries: [{ providerId: 'openrouter', model: 'openrouter/free', vision: true, paidApproved: false }] }, env());
    const keyless = { ...env(), OPENROUTER_API_KEY: undefined };
    const cfg = resolveActiveConfig(keyless);
    expect(cfg.state).toBe('missing_key');
    expect(cfg.providerLabel).toBe('OpenRouter');
    expect(cfg.keyPresent).toBe(false);
    const out = await handleAIChat({ message: 'Hello there' }, { env: keyless, fetch: vi.fn(), budget: createRequestBudget() });
    expect(out.reply).toContain('no API key set for provider "OpenRouter"');
  });

  it('skips a disabled fallback with a warning instead of crashing', async () => {
    await setChain({ entries: [
      { providerId: 'opencode-go', model: 'hy4-flash-free', vision: true, paidApproved: false },
      { providerId: 'openrouter', model: 'openrouter/free', vision: true, paidApproved: false },
    ] }, env());
    await upsertProvider({ id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', enabled: false }, env());
    const cfg = resolveActiveConfig(env());
    expect(cfg.fallbackTargets?.[0]).toMatchObject({ failure: 'disabled', providerLabel: 'OpenRouter', status: 'not_configured' });
    const f = recordingFetch(() => fakeResponse({ body: openAIBody(JSON.stringify({ rationale: 'draft', warnings: [], strategy: validStrategy() })) }));
    const r = await createProposal({ prompt: 'Add an RSI entry rule', currentStrategy: validStrategy() }, { config: cfg, env: env(), fetch: f, budget: createRequestBudget() });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.proposal.warnings.join(' ')).toMatch(/OpenRouter is turned off in Settings → AI providers and was skipped/);
    expect(f.calls.every(call => !call.url.includes('openrouter'))).toBe(true);
  });

  it('applies a saved chain without a restart and labels the OpenRouter routed model', async () => {
    await setChain({ entries: [
      { providerId: 'opencode-go', model: 'beam-free', vision: false, paidApproved: false },
      { providerId: 'openrouter', model: 'openrouter/free', vision: true, paidApproved: false },
    ] }, env());
    const fetchMock = recordingFetch((url: string) => {
      if (url.includes('/models')) return fakeResponse({ body: { data: [{ id: 'openrouter/free', pricing: { prompt: '0', completion: '0' } }] } });
      if (url.includes('opencode.ai')) return { ok: false, status: 403, headers: { get: () => null }, text: async () => '{}' };
      return fakeResponse({ body: { model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', choices: [{ message: { content: 'Routed answer' }, finish_reason: 'stop' }] } });
    });
    const out = await handleAIChat({ message: 'Hello, what can you help me with?' }, { env: env(), fetch: fetchMock, budget: createRequestBudget() });
    expect(out.reply).toBe('Routed answer');
    expect(out.providerUsed).toBe('openrouter:nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free');
  });
});


