// @vitest-environment jsdom
import React from 'react';
import { JSDOM } from 'jsdom';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../App';

let releaseRun: (() => void) | undefined;
const pendingRun = () => new Promise(resolve => { releaseRun = () => resolve({ backtestId: 'run-late', strategy: { name: 'Late run' } } as never); });

vi.mock('../../components/chat/AiCopilotDock', () => ({ AiCopilotDock: () => <div>Copilot</div> }));
vi.mock('../../components/strategy/StrategyBuilder', () => ({
  StrategyBuilder: ({ onRunBacktest }: { onRunBacktest: () => void }) => (
    <div data-testid="builder-view"><button type="button" onClick={() => void onRunBacktest()}>Run test</button></div>
  ),
}));
vi.mock('../../components/results/ResultsDashboard', () => ({ ResultsDashboard: () => <div data-testid="results-view">Results view</div> }));
vi.mock('../../components/scanner/MarketScannerView', () => ({ MarketScannerView: () => <div>Scanner view</div> }));
vi.mock('../../components/library/StrategyLibraryView', () => ({ StrategyLibraryView: () => <div data-testid="library-view">Library view</div> }));
vi.mock('../../components/settings/ProviderSettings', () => ({ ProviderSettings: () => <div>Settings</div> }));
vi.mock('../../client/api', () => ({
  requestBacktest: vi.fn(() => pendingRun()),
  requestScan: vi.fn(),
}));

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
  releaseRun = undefined;
});

describe('a run that finishes after navigation', () => {
  it('stays on the view the user chose and offers the result instead', async () => {
    render(<App />);
    await screen.findByText('Copilot');
    const sidebar = within(screen.getByRole('complementary', { name: 'Workspace navigation' }));

    fireEvent.click(sidebar.getByRole('button', { name: 'Strategy tester' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Run test' }));
    fireEvent.click(sidebar.getByRole('button', { name: 'Saved strategies' }));
    expect(await screen.findByTestId('library-view')).toBeTruthy();

    await act(async () => { releaseRun?.(); });
    await waitFor(() => expect(screen.getByText('Backtest ready')).toBeTruthy());
    // The user's view is untouched.
    expect(screen.getByTestId('library-view')).toBeTruthy();
    expect(screen.queryByTestId('results-view')).toBeNull();
    // Exactly one rail item is current.
    const current = sidebar.getByRole('button', { name: 'Saved strategies' });
    expect(current.getAttribute('aria-current')).toBe('page');
    expect(sidebar.getByRole('button', { name: 'Backtest results' }).getAttribute('aria-current')).toBeNull();
    expect(sidebar.getByRole('button', { name: 'Strategy tester' }).getAttribute('aria-current')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    expect(await screen.findByTestId('results-view')).toBeTruthy();
    expect(screen.queryByText('Backtest ready')).toBeNull();
    expect(sidebar.getByRole('button', { name: 'Backtest results' }).getAttribute('aria-current')).toBe('page');
  });
});
