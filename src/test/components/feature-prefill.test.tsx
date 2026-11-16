// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import App from '../../App';
import { FEATURE_PREFILL_EVENT } from '../../client/featureHandoff';
import { STRATEGY_TEMPLATES } from '../../shared/strategy/templates';

vi.mock('../../components/chat/AiCopilotDock', () => ({
  AiCopilotDock: () => <div>Copilot</div>,
}));
vi.mock('../../components/strategy/StrategyBuilder', () => ({
  StrategyBuilder: ({ strategy, prefill, onDescribeInChat }: { strategy: { name: string }; prefill?: { feature: string } | null; onDescribeInChat?: () => void }) => (
    <div data-testid="builder-view">
      {prefill ? 'filled:' + strategy.name : 'builder:' + strategy.name}
      {onDescribeInChat && <button type="button" onClick={onDescribeInChat}>describe</button>}
    </div>
  ),
}));
vi.mock('../../components/scanner/MarketScannerView', () => ({
  MarketScannerView: ({ strategy, prefill }: { strategy: { name: string }; prefill?: { universe: string } | null }) => (
    <div data-testid="scanner-view">{prefill ? 'scan:' + prefill.universe + ':' + strategy.name : 'scan'}</div>
  ),
}));
vi.mock('../../components/results/ResultsDashboard', () => ({ ResultsDashboard: () => <div>Results</div> }));
vi.mock('../../components/library/StrategyLibraryView', () => ({ StrategyLibraryView: () => <div>Library</div> }));
vi.mock('../../components/settings/ProviderSettings', () => ({ ProviderSettings: () => <div>Settings</div> }));

const strategy = (name: string) => {
  const draft = JSON.parse(JSON.stringify(STRATEGY_TEMPLATES[0].strategy));
  draft.name = name;
  return draft;
};
const dispatch = (detail: unknown) => {
  act(() => {
    window.dispatchEvent(new CustomEvent(FEATURE_PREFILL_EVENT, { detail }));
  });
};

let storageDom: JSDOM | undefined;

beforeEach(() => {
  storageDom = new JSDOM('', { url: 'https://app.test/' });
  vi.stubGlobal('localStorage', storageDom.window.localStorage);
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: { request: async (_name: string, callback: () => Promise<unknown>) => callback() },
  });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).startsWith('/api/symbols')) return { ok: true, json: async () => ({ symbols: [], mode: 'demo' }) };
    return { ok: true, json: async () => ({ quotes: [], configured: false, available: false, source: 'ANGEL_SMARTAPI', fetchedAt: '2026-11-16T00:00:00Z', delay: 'unknown' }) };
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  storageDom?.window.close();
  storageDom = undefined;
});

describe('feature prefill hand-off', () => {
  it('opens the strategy tester and applies a validated tester prefill', async () => {
    render(<App />);
    await screen.findByText('Copilot');
    dispatch({
      feature: 'strategy_tester', strategy: strategy('Prefilled idea'),
      start: '2024-01-01', initialCapital: 100000, robustness: false, source: 'chat', assumptions: [],
    });
    expect((await screen.findByTestId('builder-view')).textContent).toContain('filled:Prefilled idea');
  });

  it('opens the market scanner and applies a validated scanner prefill', async () => {
    render(<App />);
    await screen.findByText('Copilot');
    dispatch({
      feature: 'market_scanner', universe: 'NIFTY_IT', strategy: strategy('Scan idea'),
      limit: 35, source: 'chat', assumptions: [],
    });
    expect((await screen.findByTestId('scanner-view')).textContent).toBe('scan:NIFTY_IT:Scan idea');
  });

  it('publishes a validated chat draft from "Describe in chat" and opens the chat', async () => {
    render(<App />);
    await screen.findByText('Copilot');
    dispatch({
      feature: 'strategy_tester', strategy: strategy('Prefilled idea'),
      start: '2024-01-01', initialCapital: 100000, robustness: false, source: 'chat', assumptions: [],
    });
    const button = await screen.findByRole('button', { name: 'describe' });
    const events: Array<Record<string, unknown>> = [];
    const capture = (event: Event) => events.push((event as CustomEvent).detail as Record<string, unknown>);
    window.addEventListener(FEATURE_PREFILL_EVENT, capture);
    fireEvent.click(button);
    window.removeEventListener(FEATURE_PREFILL_EVENT, capture);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ feature: 'chat_draft', source: 'strategy_tester' });
    expect(String(events[0].prompt)).toContain('Prefilled idea');
    expect(screen.getByText('Copilot')).toBeTruthy();
  });

  it('ignores an invalid prefill instead of opening a feature', async () => {
    render(<App />);
    await screen.findByText('Copilot');
    dispatch({ feature: 'strategy_tester', strategy: { name: '' } });
    expect(screen.queryByTestId('builder-view')).toBeNull();
    expect(screen.queryByTestId('scanner-view')).toBeNull();
    expect(screen.getByText('Copilot')).toBeTruthy();
  });
});
