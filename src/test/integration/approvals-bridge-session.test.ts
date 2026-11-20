/**
 * Approval-route regression (found in live E2E, 2026-11-19):
 * the standalone OpenCode UI plugin instructs operators to approve with the
 * OpenCode session id, but POST /api/v2/engine/approvals only accepted
 * embedded-engine sessions and 404'd every bridge session — the documented
 * operator approval path for the chat-first architecture was unusable.
 */
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../server/app';
import { parseConfig, type RuntimeConfig } from '../../server/config';
import { ResearchRepository } from '../../server/storage/repository';
import { engineApprovals } from '../../server/ai/engineApprovals';
import { canonicalStrategyJSON, validateStrategy } from '../../shared/strategy/schema';
import { STRATEGY_TEMPLATES } from '../../shared/strategy/templates';

const repositories: ResearchRepository[] = [];
let engineDir = '';
beforeEach(() => {
  engineDir = mkdtempSync(join(tmpdir(), 'stragy-approvals-bridge-'));
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

const BRIDGE_SESSION = 'ses_bridge_approval_regression';

function canonicalTemplate() {
  const validated = validateStrategy(STRATEGY_TEMPLATES[0].strategy);
  if (!validated.success || !validated.data) throw new Error('template must be valid');
  return canonicalStrategyJSON(validated.canonicalData ?? validated.data);
}

function pendingGate() {
  const template = STRATEGY_TEMPLATES[0];
  return engineApprovals.createPending({
    sessionId: BRIDGE_SESSION,
    tool: 'run_backtest',
    title: 'Run backtest: ' + template.strategy.name,
    summary: ['Fixture gate for the bridge-session approval regression.'],
    assumptions: { strategy: canonicalTemplate() },
  });
}

describe('operator approvals for standalone UI (bridge) sessions', () => {
  it('approves a pending gate owned by a bridge session and mints a one-time token', async () => {
    const app = await setup();
    const gate = pendingGate();
    const res = await request(app).post('/api/v2/engine/approvals')
      .send({ sessionId: BRIDGE_SESSION, approvalId: gate.id, decision: 'approve' });
    expect(res.status).toBe(200);
    expect(res.body.approval.status).toBe('approved');
    expect(typeof res.body.token).toBe('string');
    expect(res.body.token.length).toBeGreaterThan(10);
    // The token is consumable exactly once for the reviewed assumptions.
    const { assumptionsHash } = await import('../../server/ai/engineApprovals');
    const record = engineApprovals.get(gate.id);
    expect(record?.status).toBe('approved');
    const hash = assumptionsHash({ strategy: canonicalTemplate() });
    expect(engineApprovals.consumeForSession(BRIDGE_SESSION, hash)).toBe(true);
    expect(engineApprovals.consumeForSession(BRIDGE_SESSION, hash)).toBe(false);
  });

  it('still rejects sessions unknown to both the engine and the approval store', async () => {
    const app = await setup();
    const res = await request(app).post('/api/v2/engine/approvals')
      .send({ sessionId: 'ses_never_seen_anywhere', approvalId: 'apr_does_not_exist', decision: 'approve' });
    // 404 when the engine host is up, 503 when it is unavailable (test env);
    // both fail closed and neither mints a token.
    expect([404, 503]).toContain(res.status);
    expect(res.body.token).toBeUndefined();
  });

  it('rejects a mismatched session for an existing gate', async () => {
    const app = await setup();
    const gate = pendingGate();
    const res = await request(app).post('/api/v2/engine/approvals')
      .send({ sessionId: 'ses_some_other_bridge_session', approvalId: gate.id, decision: 'approve' });
    expect([404, 503]).toContain(res.status);
    expect(res.body.token).toBeUndefined();
    expect(engineApprovals.get(gate.id)?.status).toBe('pending');
  });
});
