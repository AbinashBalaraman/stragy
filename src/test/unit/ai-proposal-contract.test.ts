import { describe, expect, it } from 'vitest';
import { createProposal } from '../../server/ai/proposals';
import { validStrategy } from '../../server/ai/testFixtures';
import type { StrategyProposalV2 } from '../../server/ai/types';
import { assertProposalCurrent, parseStrategyProposal } from '../../shared/contracts/ai-proposal';

export async function serverDraft(revision: number | string | null = 7): Promise<StrategyProposalV2> {
  const result = await createProposal({
    prompt: 'set stop loss to 3%', currentStrategy: validStrategy(), originatingRevision: revision,
  }, { env: { AI_PROVIDER: 'none' }, idFactory: () => 'contract-fixture', now: () => new Date('2026-01-01T00:00:00Z') });
  if (!result.ok) throw new Error(result.error.message);
  return result.proposal;
}

describe('client AI proposal contract', () => {
  it('accepts a real server-produced local draft without inventing metadata', async () => {
    const draft = await serverDraft();
    expect(parseStrategyProposal(draft)).toEqual(draft);
    expect(draft.provider).toEqual({ name: 'local_heuristic', model: null, aiGenerated: false });
    expect(draft.candidate.risk.stopLoss.value).toBe(3);
  });

  it('accepts the documented external provider object and parameter-sweep method', async () => {
    const draft = await serverDraft();
    const external: StrategyProposalV2 = { ...draft, method: 'external_ai', provider: { name: 'openai', model: 'fixture-model', aiGenerated: true } };
    expect(parseStrategyProposal(external)).toEqual(external);
    expect(parseStrategyProposal({ ...draft, method: 'parameter_sweep' }).method).toBe('parameter_sweep');
  });

  it('rejects malformed metadata, execution flags, unknown keys and invalid candidates without repair', async () => {
    const draft = await serverDraft();
    const malformed = [
      { ...draft, provider: 'local_heuristic' },
      { ...draft, provider: { name: 'local_heuristic', aiGenerated: false } },
      { ...draft, provider: { ...draft.provider, aiGenerated: 'false' } },
      { ...draft, provider: { ...draft.provider, secret: 'unexpected' } },
      { ...draft, method: 'automatic_execution' },
      { ...draft, createdAt: 'yesterday' },
      { ...draft, originatingRevision: Infinity },
      { ...draft, applied: true }, { ...draft, executes: true },
      { ...draft, brokerOrder: {} },
      { ...draft, candidate: { ...draft.candidate, risk: undefined } },
      { ...draft, candidate: { ...draft.candidate, rules: { entry: [], exit: [] } } },
      { ...draft, candidate: { ...draft.candidate, rules: { ...draft.candidate.rules, entry: [{ leftIndicator: 'ghost', operator: 'gt', rightValue: 2 }] } } },
    ];
    for (const value of malformed) expect(() => parseStrategyProposal(value)).toThrow();
  });

  it('rejects revision mismatch, type mismatch and same-revision changed snapshots', async () => {
    const draft = await serverDraft();
    expect(() => assertProposalCurrent(draft, 7, 'same', 'same')).not.toThrow();
    expect(() => assertProposalCurrent(draft, 8, 'same', 'same')).toThrow(/stale/);
    expect(() => assertProposalCurrent(draft, '7', 'same', 'same')).toThrow(/stale/);
    expect(() => assertProposalCurrent(draft, 7, 'before', 'after')).toThrow(/stale/);
  });
});
