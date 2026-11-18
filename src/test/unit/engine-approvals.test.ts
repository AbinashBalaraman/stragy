import { describe, expect, it } from 'vitest';
import { ApprovalError, ApprovalStore, APPROVAL_TTL_MS, assumptionsHash } from '../../server/ai/engineApprovals';

const strategy = JSON.stringify({ name: 'Fixture', version: 2 });
const assumptions = { strategy, asOf: '2026-01-09', initialCapital: 100000 };

describe('engine approval tokens', () => {
  it('mints a one-time token for the exact reviewed assumptions', () => {
    const store = new ApprovalStore();
    const pending = store.createPending({ sessionId: 's1', tool: 'run_backtest', title: 'Run it', summary: ['Stop loss 5%.'], assumptions });
    expect(pending.status).toBe('pending');
    const decided = store.decide(pending.id, 'approve');
    expect(decided.approval.status).toBe('approved');
    const token = decided.token!.token;
    const hash = assumptionsHash(assumptions);
    // A different payload leaves the token intact.
    expect(store.consume(token, assumptionsHash({ ...assumptions, initialCapital: 200000 }))).toBe(false);
    expect(store.consume(token, hash)).toBe(true);
    // ...and a token can never be used twice.
    expect(store.consume(token, hash)).toBe(false);
  });

  it('lets the UI-issued token reach the tool through the session without a token field', () => {
    const store = new ApprovalStore();
    const pending = store.createPending({ sessionId: 's2', tool: 'run_backtest', title: 'Run it', summary: [], assumptions });
    store.decide(pending.id, 'approve');
    const hash = assumptionsHash(assumptions);
    expect(store.consumeForSession('s2', hash)).toBe(true);
    expect(store.consumeForSession('s2', hash)).toBe(false);
    expect(store.consumeForSession('other-session', hash)).toBe(false);
  });

  it('accepts a direct operator approval of reviewed assumptions', () => {
    const store = new ApprovalStore();
    const approved = store.approveAssumptions({ sessionId: 's3', assumptions, title: 'Reviewed in the UI' });
    expect(approved.approval.status).toBe('approved');
    expect(store.consume(approved.token.token, assumptionsHash(assumptions))).toBe(true);
  });

  it('hashes semantically identical assumptions the same way, regardless of key order', () => {
    const a = assumptionsHash({ strategy, asOf: '2026-01-09', initialCapital: 100000 });
    const b = assumptionsHash({ initialCapital: 100000, strategy, asOf: '2026-01-09' });
    expect(a).toBe(b);
    expect(a).not.toBe(assumptionsHash({ strategy, initialCapital: 100000 }));
  });

  it('rejects a reuse and an expired token honestly', () => {
    let now = 1_000_000;
    const store = new ApprovalStore({ now: () => now });
    const pending = store.createPending({ sessionId: 's4', tool: 'run_backtest', title: 'Run', summary: [], assumptions });
    const decided = store.decide(pending.id, 'approve');
    now += APPROVAL_TTL_MS + 1;
    expect(store.consume(decided.token!.token, assumptionsHash(assumptions))).toBe(false);
    expect(() => store.decide(pending.id, 'approve')).toThrow(ApprovalError);
  });

  it('records a rejection without issuing a token', () => {
    const store = new ApprovalStore();
    const pending = store.createPending({ sessionId: 's5', tool: 'run_backtest', title: 'Run', summary: [], assumptions });
    const decided = store.decide(pending.id, 'reject', 'Not now');
    expect(decided.approval.status).toBe('rejected');
    expect(decided.token).toBeUndefined();
    expect(store.pendingForSession('s5')).toHaveLength(0);
  });

  it('reuses an identical pending gate instead of piling up cards', () => {
    const store = new ApprovalStore();
    const first = store.createPending({ sessionId: 's6', tool: 'run_backtest', title: 'Run', summary: [], assumptions });
    const second = store.createPending({ sessionId: 's6', tool: 'run_backtest', title: 'Run again', summary: [], assumptions });
    expect(second.id).toBe(first.id);
  });
});
