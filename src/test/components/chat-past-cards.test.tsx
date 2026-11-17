// @vitest-environment jsdom
import React from 'react';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AiCopilotDock } from '../../components/chat/AiCopilotDock';
import { validStrategy } from '../../server/ai/testFixtures';
import { createProposal } from '../../server/ai/proposals';
import { requestResearchChat } from '../../client/researchChat';
import { requestScan } from '../../client/api';
import type { CreateProposalResult } from '../../server/ai/types';
import type { ResearchScreenPlan } from '../../shared/contracts/research-chat';
import type { ScanResult } from '../../client/api';

vi.mock('../../client/researchChat', () => ({ requestResearchChat: vi.fn() }));
vi.mock('../../client/api', () => ({
  requestScan: vi.fn(),
  checkScanJob: vi.fn(),
  checkBacktestJob: vi.fn(),
  cancelResearchJob: vi.fn(),
}));
vi.mock('../../client/featureSetup', () => ({ requestFeatureSetup: vi.fn() }));

const PAST_NAME = 'RSI above 60 · kept screen';

const symbol = { id: 7, ticker: 'RELIANCE', name: 'Reliance Industries', exchange: 'NSE' as const, sector: 'Energy', currentPrice: 2900, changePercent: 0.5 };

const scanResult = {
  mode: 'real', universe: 'NIFTY_50', scanned: 50, matched: 1, scannedAt: '2026-11-17T12:00:00Z',
  dataSource: 'PROVENANCE_PER_SYMBOL', requested: 50, attempted: 50, succeeded: 50, unavailable: 0, failed: 0,
  offset: 0, limit: 100, errors: [], sourceCoverage: { ANGEL_SMARTAPI: 50 }, warnings: [],
  observationDates: { earliest: '2024-11-18', latest: '2026-11-16', staleSymbols: 0 },
  matches: [{
    symbolId: 7, ticker: 'RELIANCE', name: 'Reliance Industries', sector: 'Energy',
    lastDate: '2026-11-16', lastClose: 2900, changePercent: 0.5, matchedRules: [], indicatorValues: {},
    provenance: { mode: 'real', source: 'ANGEL_SMARTAPI', symbolId: 7, asOf: '2026-11-16', fetchedAt: '2026-11-17T12:00:00Z', requestedRange: {}, actualRange: { start: '2024-11-18', end: '2026-11-16' }, adjustment: 'split', checksum: 'x', coverage: 'full', freshness: 'FRESH', warnings: [], calendarVersion: 'v1' },
  }],
  nearMatches: [],
} as unknown as ScanResult;

const floorPlan = (): ResearchScreenPlan => {
  const base = validStrategy();
  return {
    schemaVersion: 1,
    kind: 'screen',
    originatingRevision: 1,
    message: 'Scanning Nifty 50 for RSI above 60.',
    method: 'rule_parser',
    provider: { name: 'none', model: null, aiGenerated: false },
    warnings: [],
    universe: 'NIFTY_50',
    strategy: { ...base, name: PAST_NAME },
    assumptions: [],
    missingBacktestRules: ['exits'],
    backtestReady: false,
  } as unknown as ResearchScreenPlan;
};

const proposalReply = async () => {
  const draft = await createProposal(
    { prompt: 'Set my stop loss to 5%', currentStrategy: validStrategy(), originatingRevision: 1 },
    { env: { AI_PROVIDER: 'none' }, idFactory: () => 'past-card-fixture', now: () => new Date('2026-01-01T00:00:00Z') },
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
};

let dom: JSDOM;

beforeEach(async () => {
  dom = new JSDOM('', { url: 'https://past-cards.test' });
  vi.stubGlobal('localStorage', dom.window.localStorage);
  vi.mocked(requestResearchChat)
    .mockReset()
    .mockResolvedValueOnce(floorPlan() as never)
    .mockResolvedValueOnce(await proposalReply());
  vi.mocked(requestScan).mockReset().mockResolvedValue(scanResult);
});

afterEach(() => {
  cleanup();
  dom.window.close();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const send = (text: string) => {
  fireEvent.change(screen.getByLabelText('Research request'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
};

describe('a completed card after a later request', () => {
  it('keeps the scan table and adds the draft card, with exactly one table', async () => {
    render(<AiCopilotDock strategy={validStrategy()} symbols={[symbol]} />);
    send('Screen Nifty 50 for RSI above 60');
    const results = await screen.findByLabelText('Screen results');
    expect(within(results).getByRole('button', { name: 'Prepare backtest for RELIANCE' })).toBeTruthy();

    send('Set my stop loss to 5%');
    expect(await screen.findByRole('article', { name: 'Draft proposal' })).toBeTruthy();

    // The answer to the first request did not disappear with the second one.
    const tables = screen.getAllByLabelText('Screen results');
    expect(tables).toHaveLength(1);
    expect(within(tables[0]).getByRole('button', { name: 'Prepare backtest for RELIANCE' })).toBeTruthy();
    expect(document.body.textContent).toContain(PAST_NAME);
    // The kept card is read-only: no retry / check-again actions survive it.
    expect(screen.queryByRole('button', { name: 'Retry scan' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull();
  });

  it('prepares a review from the kept scan’s own plan', async () => {
    render(<AiCopilotDock strategy={validStrategy()} symbols={[symbol]} />);
    send('Screen Nifty 50 for RSI above 60');
    await screen.findByLabelText('Screen results');
    send('Set my stop loss to 5%');
    await screen.findByRole('article', { name: 'Draft proposal' });

    // Re-query: the kept card is a new element after the live one is archived.
    const kept = screen.getByLabelText('Screen results');
    fireEvent.click(within(kept).getByRole('button', { name: 'Prepare backtest for RELIANCE' }));
    const review = await screen.findByRole('article', { name: 'Backtest review' });
    expect(within(review).getByRole('button', { name: 'Use these assumptions and run' })).toBeTruthy();
    expect(review.textContent).toContain('Read-only screen');
    expect(review.textContent).toContain(PAST_NAME);
  });

  it('replaces the live card with the newest screen, keeping the older table once', async () => {
    vi.mocked(requestResearchChat).mockReset();
    const nextPlan = { ...floorPlan(), message: 'Scanning Nifty 50 for RSI below 40.', strategy: { ...floorPlan().strategy, name: 'RSI below 40 · live screen' } };
    vi.mocked(requestResearchChat)
      .mockResolvedValueOnce(floorPlan() as never)
      .mockResolvedValueOnce(nextPlan as never);
    render(<AiCopilotDock strategy={validStrategy()} symbols={[symbol]} />);
    send('Screen Nifty 50 for RSI above 60');
    await screen.findByLabelText('Screen results');
    send('Screen Nifty 50 for RSI below 40');

    await waitFor(() => expect(screen.getAllByLabelText('Screen results')).toHaveLength(2));
    const titles = screen.getAllByText(/kept screen|live screen/).map(node => node.textContent);
    expect(titles.some(title => title?.includes('kept screen'))).toBe(true);
    expect(titles.some(title => title?.includes('live screen'))).toBe(true);
  });
});
