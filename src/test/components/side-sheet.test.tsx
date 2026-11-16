// @vitest-environment jsdom
import React from 'react';
import { JSDOM } from 'jsdom';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../App';

const fakeResult = {
  backtestId: 'run-sheet-1',
  strategy: { name: 'Sheet run' },
  symbol: { ticker: 'RELIANCE' },
} as never;

vi.mock('../../components/chat/AiCopilotDock', () => ({
  AiCopilotDock: ({ onOpenDetails }: { onOpenDetails: (result: unknown) => void }) => (
    <button type="button" onClick={() => onOpenDetails(fakeResult)}>view details</button>
  ),
}));
vi.mock('../../components/strategy/StrategyBuilder', () => ({ StrategyBuilder: () => <div>Builder</div> }));
vi.mock('../../components/scanner/MarketScannerView', () => ({ MarketScannerView: () => <div>Scanner</div> }));
vi.mock('../../components/results/ResultsDashboard', () => ({
  ResultsDashboard: ({ result }: { result: { strategy: { name: string } } | null }) => (
    <div data-testid="results-view">{result ? result.strategy.name : 'no result'}</div>
  ),
}));
vi.mock('../../components/library/StrategyLibraryView', () => ({ StrategyLibraryView: () => <div>Library</div> }));
vi.mock('../../components/settings/ProviderSettings', () => ({ ProviderSettings: () => <div>Settings</div> }));

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

describe('results side sheet', () => {
  it('opens the chat result in a sheet without leaving the conversation', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'view details' }));
    const dialog = await screen.findByRole('dialog', { name: 'Backtest result' });
    expect(dialog).toBeTruthy();
    expect(screen.getByTestId('results-view').textContent).toBe('Sheet run');
    // The conversation is still the active view behind the sheet.
    expect(screen.getByRole('button', { name: 'Chat' }).getAttribute('aria-current')).toBe('page');
  });

  it('keeps today\'s route behind "Open full page"', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'view details' }));
    await screen.findByRole('dialog', { name: 'Backtest result' });
    fireEvent.click(screen.getByRole('button', { name: 'Open full page' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Backtest results' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByTestId('results-view').textContent).toBe('Sheet run');
  });
});
