/**
 * App-level hardening regressions (2026-11-19 review):
 *  - percent-encoded backend-artifact paths must not slip past the deny regex
 *  - the loopback tool bridge token is required when STRAGY_TOOL_TOKEN is set
 */
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../server/app';
import { parseConfig, type RuntimeConfig } from '../../server/config';
import { ResearchRepository } from '../../server/storage/repository';

const repositories: ResearchRepository[] = [];
let engineDir = '';
beforeEach(() => {
  engineDir = mkdtempSync(join(tmpdir(), 'stragy-security-engine-'));
  vi.stubEnv('STRAGY_ENGINE_DIR', engineDir);
  vi.stubEnv('DATA_MODE', 'demo');
  vi.stubEnv('AI_PROVIDER', 'none');
  vi.stubEnv('DATABASE_URL', '');
  vi.stubEnv('DATABASE_URL_UNPOOLED', '');
});
afterEach(async () => {
  await Promise.all(repositories.splice(0).map(repository => repository.close()));
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(engineDir, { recursive: true, force: true });
});

async function setup(overrides: Partial<RuntimeConfig> = {}) {
  const config = { ...parseConfig({ NODE_ENV: 'test', DATA_MODE: 'demo', AI_PROVIDER: 'none', STORAGE_MODE: 'ephemeral', EXPOSURE_MODE: 'demo-public' }), ...overrides };
  const repository = await ResearchRepository.open({ maxRuns: 5 });
  repositories.push(repository);
  return createApp({ config, repository, enableVite: false });
}

describe('backend artifact denial survives percent-encoding', () => {
  it('denies encoded .map/.env/server paths on a production app', async () => {
    const app = await setup({ NODE_ENV: 'production' });
    expect((await request(app).get('/assets/index.js%2emap')).status).toBe(404);
    expect((await request(app).get('/%2e%65nv')).status).toBe(404);
    expect((await request(app).get('/server/server.cjs')).status).toBe(404);
    expect((await request(app).get('/server%2fserver.cjs')).status).toBe(404);
    // Sanity: ordinary health routing is unaffected.
    expect((await request(app).get('/health/live')).status).toBe(200);
  });
});

describe('tool bridge token enforcement', () => {
  it('requires the exact STRAGY_TOOL_TOKEN on loopback bridge routes', async () => {
    vi.stubEnv('STRAGY_TOOL_TOKEN', 'bridge-regression-token');
    const app = await setup();
    const missing = await request(app).get('/api/v2/engine/tools');
    expect(missing.status).toBe(403);
    const wrong = await request(app).get('/api/v2/engine/tools').set('x-stragy-tool-token', 'bridge-regression-tokem');
    expect(wrong.status).toBe(403);
    const right = await request(app).get('/api/v2/engine/tools').set('x-stragy-tool-token', 'bridge-regression-token');
    expect(right.status).toBe(200);
    expect(Array.isArray(right.body.tools)).toBe(true);
  });
});
