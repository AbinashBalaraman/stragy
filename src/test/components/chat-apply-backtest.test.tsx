// @vitest-environment jsdom
import React, { useState } from 'react';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AiCopilotDock } from '../../components/chat/AiCopilotDock';
import { validStrategy } from '../../server/ai/testFixtures';
import { createProposal } from '../../server/ai/proposals';
import { requestResearchChat } from '../../client/researchChat';
import type { CreateProposalResult } from '../../server/ai/types';
import type { StrategyAST } from '../../shared/strategy/types';

vi.mock('../../client/researchChat', () => ({ requestResearchChat: vi.fn() }));
vi.mock('../../client/api', () => ({
  requestScan: vi.fn(),
  checkScanJob: vi.fn(),
  checkBacktestJob: vi.fn(),
  cancelResearchJob: vi.fn(),
}));
vi.mock('../../client/featureSetup', () => ({ requestFeatureSetup: vi.fn() }));

const universeId = validStrategy().universe.symbolId;
const symbol = { id: universeId, ticker: 'RELIANCE', name: 'Reliance Industries', exchange: 'NSE' as const, sector: 'Energy', currentPrice: 2900, changePercent: 0.5 };


let dom: JSDOM;

beforeEach(async () => {
  dom = new JSDOM('', { url: 'https://apply-backtest.test' });
  vi.stubGlobal('localStorage', dom.window.localStorage);
  vi.mocked(requestResearchChat).mockReset().mockImplementation(async (input: { message: string; currentStrategy: StrategyAST; originatingRevision: number }) => {
    const draft = await createProposal(
      { prompt: input.message, currentStrategy: input.currentStrategy, originatingRevision: input.originatingRevision },
      { env: { AI_PROVIDER: 'none' }, idFactory: () => 'apply-backtest-fixture', now: () => new Date('2026-01-01T00:00:00Z') },
    ) as CreateProposalResult;
    if (!draft.ok) throw new Error('Fixture proposal failed');
    return {
      schemaVersion: 1,
      kind: 'proposal',
      originatingRevision: draft.proposal.originatingRevision,
      message: draft.proposal.rationale,
      method: draft.proposal.method,
      provider: draft.proposal.provider,
      warnings: draft.proposal.warnings,
      proposal: draft.proposal,
    } as never;
  });
});

afterEach(() => {
  cleanup();
  dom.window.close();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const send = (text: string) => {
  fireEvent.change(screen.getByLabelText('Research request'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
};

/** Mirrors App: apply the variation to the workspace strategy prop. */
const Harness: React.FC<{ delay?: number; confirm?: boolean }> = ({ delay = 0, confirm = true }) => {
  const [strategy, setStrategy] = useState<StrategyAST>(validStrategy());
  return (
    <AiCopilotDock
      strategy={strategy}
      symbols={[symbol]}
      onResearchBacktest={async () => null}
      onApplyVariation={input => {
        if (!confirm) return true;
        if (delay) window.setTimeout(() => setStrategy(input), delay);
        else setStrategy(input);
        return true;
      }}
    />
  );
};

const openDraft = async () => {
  send('Set my stop loss to 5% and my target to 12%');
  await screen.findByRole('article', { name: 'Draft proposal' });
  fireEvent.click(screen.getByRole('button', { name: 'Apply and backtest' }));
};

describe('Apply and backtest', () => {
  it('opens one review for the applied stop loss and target, with the run button', async () => {
    render(<Harness />);
    await openDraft();
    const review = await screen.findByRole('article', { name: 'Backtest review' });
    expect(review.textContent).toContain('5%');
    expect(review.textContent).toContain('12%');
    expect(within(review).getByRole('button', { name: 'Use these assumptions and run' })).toBeTruthy();
    expect(screen.getAllByRole('article', { name: 'Backtest review' })).toHaveLength(1);
  });

  it('still opens the review when the workspace update arrives a tick later', async () => {
    render(<Harness delay={30} />);
    await openDraft();
    const review = await screen.findByRole('article', { name: 'Backtest review' });
    expect(review.textContent).toContain('5%');
    expect(screen.getAllByRole('article', { name: 'Backtest review' })).toHaveLength(1);
  });

  it('says so with a retry when the workspace never confirms', async () => {
    render(<Harness confirm={false} />);
    await openDraft();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 8300)); });
    expect(await screen.findByText(/the workspace did not confirm it in time/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.queryByRole('article', { name: 'Backtest review' })).toBeNull();
  }, 15000);
});
