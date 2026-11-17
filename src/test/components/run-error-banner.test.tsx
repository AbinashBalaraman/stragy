// @vitest-environment jsdom
import React from 'react';
import { JSDOM } from 'jsdom';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../App';

vi.mock('../../components/chat/AiCopilotDock', () => ({ AiCopilotDock: () => <div>Copilot</div> }));
vi.mock('../../components/strategy/StrategyBuilder', () => ({
  StrategyBuilder: ({ onRunBacktest, runError }: { onRunBacktest: () => void; runError?: string }) => (
    <div>
      <button type="button" onClick={() => void onRunBacktest()}>Run test</button>
      {runError && <p data-testid="inline-run-error">{runError}</p>}
    </div>
  ),
}));
vi.mock('../../components/results/ResultsDashboard', () => ({ ResultsDashboard: () => <div>Results view</div> }));
vi.mock('../../components/scanner/MarketScannerView', () => ({ MarketScannerView: () => <div>Scanner view</div> }));
vi.mock('../../components/library/StrategyLibraryView', () => ({ StrategyLibraryView: () => <div>Library view</div> }));
vi.mock('../../components/settings/ProviderSettings', () => ({ ProviderSettings: () => <div>Settings</div> }));
vi.mock('../../client/api', () => ({
  requestBacktest: vi.fn(() => Promise.reject(new Error('Angel One rate limit reached; the request will be retried after a short backoff'))),
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
});

describe('run errors stay where the run happened', () => {
  it('shows the provider-busy message in the tester and not again as a page banner', async () => {
    render(<App />);
    await screen.findByText('Copilot');
    fireEvent.click(screen.getByRole('button', { name: 'Strategy tester' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Run test' }));

    const message = "The backtest didn't finish: Angel One is busy with the scanner. Try again in a minute.";
    expect(await screen.findByTestId('inline-run-error')).toHaveTextContent(message);
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Saved strategies' }));
    expect(await screen.findByText('Library view')).toBeTruthy();
    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expect(screen.getAllByText(message)).toHaveLength(1);
  });
});
