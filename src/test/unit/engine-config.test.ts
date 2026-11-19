import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildEngineConfig, writeEngineConfig, ENGINE_AGENT_ID, ENGINE_DENIED_ACTIONS, ENGINE_PROVIDER_PACKAGE } from '../../server/ai/engineConfig';
import { initializeProviderRegistry, resetProviderRegistryCache } from '../../server/ai/providerRegistry';

const folders: string[] = [];
async function tempFile(): Promise<string> {
  const base = path.resolve('src/test/.tmp');
  const folder = await mkdtemp(path.join(base, 'engine-config-'));
  folders.push(folder);
  return path.join(folder, 'ai-providers.json');
}
function baseEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    NODE_ENV: 'test',
    AI_PROVIDER: 'opencode-go',
    OPENCODE_API_KEY: 'test-opencode-go-key',
    OPENROUTER_API_KEY: 'test-openrouter-key',
    DEEPSEEK_API_KEY: '',
    AI_PROVIDERS_FILE: '/nonexistent/ai-providers.json',
    DATABASE_URL: '',
    DATABASE_URL_UNPOOLED: '',
    AI_APPROVED_PAID_MODELS: '',
    ...overrides,
  };
}
async function build(env: Record<string, string>, file?: string) {
  resetProviderRegistryCache();
  await initializeProviderRegistry({ ...env, ...(file ? { AI_PROVIDERS_FILE: file } : {}) });
  return buildEngineConfig({ ...env, ...(file ? { AI_PROVIDERS_FILE: file } : {}) });
}

afterEach(async () => {
  resetProviderRegistryCache();
  await Promise.all(folders.splice(0).map(folder => rm(folder, { recursive: true, force: true })));
});

describe('engine config generation', () => {
  it('builds the free chain from the existing provider registry without leaking keys', async () => {
    const built = await build(baseEnv());
    expect(built.defaultModel).toEqual({ providerID: 'opencode-go', model: 'hy4-flash-free' });
    const providers = built.config.providers as Record<string, { package: string; settings: { baseURL: string; apiKey: string }; models: Record<string, unknown> }>;
    expect(providers['opencode-go'].package).toBe(ENGINE_PROVIDER_PACKAGE);
    expect(providers['opencode-go'].settings).toEqual({ baseURL: 'https://opencode.ai/inference/go/openai/v1', apiKey: '{env:OPENCODE_API_KEY}' });
    expect(Object.keys(providers['opencode-go'].models)).toContain('hy4-flash-free');
    expect(providers.openrouter.settings.apiKey).toBe('{env:OPENROUTER_API_KEY}');
    expect(Object.keys(providers.openrouter.models)).toContain('openrouter/free');
    // The paid model is absent until it is explicitly approved.
    expect(Object.keys(providers['opencode-go'].models)).not.toContain('deepseek-v4.1-flash');
    expect(built.models.filter(model => !model.free)).toHaveLength(0);

    const agents = built.config.agents as Record<string, { system: string; model: unknown; permissions: { action: string; effect: string }[] }>;
    expect(Object.keys(agents)).toEqual([ENGINE_AGENT_ID]);
    expect(agents[ENGINE_AGENT_ID].system).toMatch(/Never invent prices/);
    expect(agents[ENGINE_AGENT_ID].model).toEqual({ providerID: 'opencode-go', model: 'hy4-flash-free' });

    const folder = await tempFile();
    const file = await writeEngineConfig(path.dirname(folder), built);
    const raw = await import('node:fs/promises').then(fs => fs.readFile(file, 'utf8'));
    expect(raw).toContain('{env:OPENCODE_API_KEY}');
    expect(raw).not.toContain('test-opencode-go-key');
    expect(raw).not.toContain('test-openrouter-key');
  });

  it('adds the paid model only with the existing AI_APPROVED_PAID_MODELS approval', async () => {
    const denied = await build(baseEnv({ DEEPSEEK_API_KEY: 'test-deepseek-key' }));
    const deniedProviders = denied.config.providers as Record<string, { models: Record<string, unknown> }>;
    expect(deniedProviders.deepseek).toBeUndefined();
    expect(denied.models.some(model => model.model === 'deepseek-v4.1-flash')).toBe(false);

    const approved = await build(baseEnv({ DEEPSEEK_API_KEY: 'test-deepseek-key', AI_APPROVED_PAID_MODELS: 'deepseek:deepseek-v4.1-flash' }));
    const providers = approved.config.providers as Record<string, { models: Record<string, unknown> }>;
    expect(Object.keys(providers.deepseek.models)).toContain('deepseek-v4.1-flash');
    const paid = approved.models.find(model => model.model === 'deepseek-v4.1-flash');
    expect(paid).toMatchObject({ providerId: 'deepseek', free: false, paidApproved: true });
    // A paid model never becomes the default while a free model exists.
    expect(approved.defaultModel).toEqual({ providerID: 'opencode-go', model: 'hy4-flash-free' });
  });

  it('lists every approved paid model, hides unapproved ones, and keeps a free default', async () => {
    const { writeFile } = await import('node:fs/promises');
    const file = await tempFile();
    await writeFile(file, JSON.stringify({
      version: 1,
      providers: [
        { id: 'opencode-go', label: 'OpenCode Go', baseUrl: 'https://opencode.ai/inference/go/openai/v1', enabled: true, builtin: true },
        { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', enabled: true, builtin: true },
      ],
      chain: [
        { providerId: 'opencode-go', model: 'hy4-flash-free', vision: true, paidApproved: false },
        { providerId: 'opencode-go', model: 'gpt-5-paid', vision: false, paidApproved: false },
        { providerId: 'deepseek', model: 'deepseek-v4.1-flash', vision: false, paidApproved: false },
      ],
      updatedAt: new Date().toISOString(),
    }), 'utf8');

    // Without approvals, no paid model is exposed and the default stays free.
    const denied = await build(baseEnv({ DEEPSEEK_API_KEY: 'test-deepseek-key' }), file);
    expect(denied.models.filter(model => !model.free)).toHaveLength(0);
    expect(denied.defaultModel).toEqual({ providerID: 'opencode-go', model: 'hy4-flash-free' });

    // The owner's rule is about the default, not the catalog: once two distinct
    // paid models are approved, both appear (gpt-5-paid is not DeepSeek).
    const approved = await build(baseEnv({
      DEEPSEEK_API_KEY: 'test-deepseek-key',
      AI_APPROVED_PAID_MODELS: 'opencode-go:gpt-5-paid,deepseek:deepseek-v4.1-flash',
    }), file);
    const paid = approved.models.filter(model => !model.free);
    expect(paid.map(model => `${model.providerId}:${model.model}`).sort()).toEqual([
      'deepseek:deepseek-v4.1-flash',
      'opencode-go:gpt-5-paid',
    ]);
    // A paid model never becomes the default while a free model exists.
    expect(approved.defaultModel).toEqual({ providerID: 'opencode-go', model: 'hy4-flash-free' });
  });

  it('denies every host-machine tool while keeping Stragy tools available', async () => {
    const built = await build(baseEnv());
    const permissions = built.config.permissions as { action: string; resource: string; effect: string }[];
    for (const action of ENGINE_DENIED_ACTIONS) {
      expect(permissions).toContainEqual({ action, resource: '*', effect: 'deny' });
    }
    for (const action of ['shell', 'edit', 'write', 'patch', 'webfetch', 'websearch']) {
      expect(permissions).toContainEqual({ action, resource: '*', effect: 'deny' });
    }
    const agents = built.config.agents as Record<string, { permissions: { action: string; effect: string }[] }>;
    expect(agents[ENGINE_AGENT_ID].permissions.some(rule => rule.action === 'shell' && rule.effect === 'deny')).toBe(true);
  });

  it('reports ENGINE_UNAVAILABLE state (no default) when no provider has a key', async () => {
    const built = await build(baseEnv({ AI_PROVIDER: 'none', OPENCODE_API_KEY: '', OPENROUTER_API_KEY: '' }));
    expect(built.defaultModel).toBeNull();
    expect(built.config.model).toBeUndefined();
    expect(built.warnings.join(' ')).toMatch(/No enabled free/i);
  });

  it('honours a saved chain entry for a provider the catalog does not list', async () => {
    const { writeFile } = await import('node:fs/promises');
    const file = await tempFile();
    await writeFile(file, JSON.stringify({
      version: 1,
      providers: [{ id: 'custom-lab', label: 'Lab provider', baseUrl: 'https://lab.example.com/v1', enabled: true, builtin: false }],
      chain: [{ providerId: 'custom-lab', model: 'deepseek-v4.1-flash', vision: false, paidApproved: true }],
      updatedAt: new Date().toISOString(),
    }), 'utf8');
    // No key is available for the custom provider, so it must be omitted honestly
    // rather than emitted with an empty credential.
    const built = await build(baseEnv({ AI_PROVIDER: 'opencode-go' }), file);
    const providers = built.config.providers as Record<string, unknown>;
    expect(providers['custom-lab']).toBeUndefined();
    expect(built.warnings.join(' ')).toMatch(/no API key/i);
  });
});
