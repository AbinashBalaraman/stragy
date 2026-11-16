import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../server/app';
import { parseConfig, type RuntimeConfig } from '../../server/config';
import { ResearchRepository } from '../../server/storage/repository';

const SITE_PASSWORD = 'correct-horse-battery-staple-qa';
const API_TOKEN = 'synthetic-api-token-for-auth-tests';
const repositories: ResearchRepository[] = [];
const clientDir = path.join(process.cwd(), 'dist', 'client');
const assetName = 'qa-auth-asset-' + process.pid + '.txt';
const assetPath = path.join(clientDir, assetName);
const indexPath = path.join(clientDir, 'index.html');
let createdIndex = false;

const basic = (user = 'owner', password = SITE_PASSWORD) => 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');

beforeAll(() => {
  fs.mkdirSync(clientDir, { recursive: true });
  if (!fs.existsSync(indexPath)) { fs.writeFileSync(indexPath, '<!doctype html><title>Stragy QA</title>', 'utf8'); createdIndex = true; }
  fs.writeFileSync(assetPath, 'authenticated static asset\n', 'utf8');
});
afterAll(() => {
  if (fs.existsSync(assetPath)) fs.unlinkSync(assetPath);
  if (createdIndex && fs.existsSync(indexPath)) fs.unlinkSync(indexPath);
});
beforeEach(() => {
  vi.stubEnv('DATA_MODE', 'demo');
  vi.stubEnv('AI_PROVIDER', 'none');
});
afterEach(async () => {
  await Promise.all(repositories.splice(0).map(repository => repository.close()));
  vi.unstubAllEnvs();
});
async function setup(overrides: Partial<RuntimeConfig> = {}) {
  const config = { ...parseConfig({ NODE_ENV: 'test', DATA_MODE: 'demo', AI_PROVIDER: 'none', STORAGE_MODE: 'ephemeral', MAX_BODY_BYTES: '1024', MAX_JOB_MS: '1000' }), ...overrides };
  const repository = await ResearchRepository.open({ maxRuns: 3 });
  repositories.push(repository);
  const app = await createApp({ config, repository, enableVite: false });
  return app;
}

describe('whole-site Basic authentication', () => {
  it('returns 401 with the Basic challenge and exposes nothing without credentials', async () => {
    const app = await setup({ NODE_ENV: 'production', EXPOSURE_MODE: 'private', SITE_PASSWORD });
    for (const route of ['/', '/api/v2/capabilities', '/' + assetName, '/api/health']) {
      const response = await request(app).get(route);
      expect(response.status).toBe(401);
      expect(response.headers['www-authenticate']).toBe('Basic realm="Stragy", charset="UTF-8"');
    }
  });

  it('rejects a wrong password and a wrong user with the same challenge', async () => {
    const app = await setup({ NODE_ENV: 'production', EXPOSURE_MODE: 'private', SITE_PASSWORD });
    for (const credentials of [basic('owner', 'wrong-password-123456'), basic('intruder', SITE_PASSWORD)]) {
      const response = await request(app).get('/api/v2/capabilities').set('Authorization', credentials);
      expect(response.status).toBe(401);
      expect(response.headers['www-authenticate']).toContain('Basic realm="Stragy"');
    }
  });

  it('allows the correct Basic credentials for /, API capabilities and static assets', async () => {
    const app = await setup({ NODE_ENV: 'production', EXPOSURE_MODE: 'private', SITE_PASSWORD });
    const home = await request(app).get('/').set('Authorization', basic());
    expect(home.status).toBe(200);
    expect(home.headers['content-type']).toMatch(/text\/html/);
    const capabilities = await request(app).get('/api/v2/capabilities').set('Authorization', basic());
    expect(capabilities.status).toBe(200);
    expect(capabilities.body).toMatchObject({ schemaVersion: 2, mode: 'demo' });
    const asset = await request(app).get('/' + assetName).set('Authorization', basic());
    expect(asset.status).toBe(200);
    expect(asset.text).toBe('authenticated static asset\n');
  });

  it('keeps liveness and readiness open without credentials', async () => {
    const app = await setup({ NODE_ENV: 'production', EXPOSURE_MODE: 'private', SITE_PASSWORD });
    const live = await request(app).get('/health/live');
    expect(live.status).toBe(200);
    expect(live.body).toEqual({ status: 'ok' });
    const ready = await request(app).get('/health/ready');
    expect(ready.status).toBe(200);
    expect(ready.body).toMatchObject({ status: 'ready', mode: 'demo' });
  });

  it('keeps the Bearer API token path working alongside Basic auth', async () => {
    const app = await setup({ NODE_ENV: 'production', EXPOSURE_MODE: 'private', SITE_PASSWORD, API_ACCESS_TOKEN: API_TOKEN });
    const bearer = await request(app).get('/api/v2/capabilities').set('Authorization', 'Bearer ' + API_TOKEN);
    expect(bearer.status).toBe(200);
    const wrongBearer = await request(app).get('/api/v2/capabilities').set('Authorization', 'Bearer wrong-token');
    expect(wrongBearer.status).toBe(401);
    expect(wrongBearer.headers['www-authenticate']).toContain('Basic realm="Stragy"');
    const both = await request(app).get('/api/v2/capabilities').set('Authorization', basic());
    expect(both.status).toBe(200);
  });
});

describe('private deployment configuration', () => {
  it('rejects a short SITE_PASSWORD with a clear message', () => {
    expect(() => parseConfig({ NODE_ENV: 'production', EXPOSURE_MODE: 'private', SITE_PASSWORD: 'too-short', AI_PROVIDER: 'none' })).toThrow(/SITE_PASSWORD must be at least 12 characters/);
  });

  it('accepts private production with real Angel data, Angel quotes and a free opencode-go model', () => {
    const config = parseConfig({
      NODE_ENV: 'production', EXPOSURE_MODE: 'private', DATA_MODE: 'real',
      MARKET_PROVIDER: 'angel', QUOTES_PROVIDER: 'angel',
      AI_PROVIDER: 'opencode-go', AI_MODEL: 'beam-free', AI_COST_POLICY: 'free-only',
      SITE_PASSWORD: 'a-long-private-site-password',
    });
    expect(config).toMatchObject({ EXPOSURE_MODE: 'private', DATA_MODE: 'real', MARKET_PROVIDER: 'angel', QUOTES_PROVIDER: 'angel', AI_PROVIDER: 'opencode-go' });
    expect(config.SITE_USER).toBe('owner');
  });

  it('still accepts API_ACCESS_TOKEN without SITE_PASSWORD', () => {
    const config = parseConfig({ NODE_ENV: 'production', EXPOSURE_MODE: 'private', API_ACCESS_TOKEN: 'api-token-example', AI_PROVIDER: 'none' });
    expect(config.API_ACCESS_TOKEN).toBe('api-token-example');
    expect(config.SITE_PASSWORD).toBeUndefined();
  });
});
