// @vitest-environment jsdom
import React from 'react';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../../App';
import { saveWorkspace, WORKSPACE_KEY } from '../../client/workspace';
import { STRATEGY_TEMPLATES } from '../../shared/strategy/templates';
import type { StrategyAST } from '../../shared/strategy/types';

vi.mock('../../components/strategy/StrategyBuilder', () => ({
  StrategyBuilder: ({ strategy, onChange }: { strategy: StrategyAST; onChange: (next: StrategyAST) => void }) => (
    <div data-testid="builder-view">
      <span data-testid="builder-name">{strategy.name}</span>
      <button type="button" onClick={() => onChange({ ...strategy, name: 'Draft B' })}>Change draft</button>
    </div>
  ),
}));
vi.mock('../../components/results/ResultsDashboard', () => ({ ResultsDashboard: () => <div>Results view</div> }));
vi.mock('../../components/scanner/MarketScannerView', () => ({ MarketScannerView: () => <div>Scanner view</div> }));
vi.mock('../../components/library/StrategyLibraryView', () => ({ StrategyLibraryView: () => <div>Library view</div> }));
vi.mock('../../client/engine', async () => await import('../../test/support/engineMock'));
vi.mock('../../client/api', () => ({ requestScan: vi.fn(), requestBacktest: vi.fn() }));

let storageDom: JSDOM | undefined;
const storage = () => storageDom!.window.localStorage;
const seed = (name: string) => {
  const draft = JSON.parse(JSON.stringify(STRATEGY_TEMPLATES[0].strategy)) as StrategyAST;
  draft.name = name;
  const { revision } = saveWorkspace(storage(), draft, null);
  return { draft, raw: revision as string };
};
const sidebar = () => within(screen.getByRole('complementary', { name: 'Workspace navigation' }));

beforeEach(() => {
  storageDom = new JSDOM('', { url: 'https://app.test/' });
  vi.stubGlobal('localStorage', storage());
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: { request: async (_name: string, callback: () => Promise<unknown>) => callback() },
  });
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ mode: 'real', symbols: [] }),
  })));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  storageDom?.window.close();
  storageDom = undefined;
});

describe('workspace autosave and conflict recovery', () => {
  it('does not rewrite an unchanged persisted workspace on mount', async () => {
    const { raw } = seed('Workspace A');
    render(<App />);
    expect(await screen.findByText('Test a trading idea before you trust it.')).toBeTruthy();
    // Settled save states stay out of the rail; only unsaved work is announced.
    expect(screen.queryByText(/Workspace unchanged/)).toBeNull();
    expect(screen.queryByText(/Saved locally/)).toBeNull();
    expect(storage().getItem(WORKSPACE_KEY)).toBe(raw);
  });

  it('offers a workspace reload after a cross-tab save conflict instead of export alone', async () => {
    const { draft, raw } = seed('Workspace A');
    let release!: () => void;
    const request = vi.fn((_name: string, callback: () => Promise<unknown>) => new Promise((resolve, reject) => {
      release = () => {
        try { resolve(callback()); } catch (error) { reject(error); }
      };
    }));
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } });

    render(<App />);
    await screen.findByText('Test a trading idea before you trust it.');
    fireEvent.click(sidebar().getByRole('button', { name: 'Strategy tester' }));
    expect((await screen.findByTestId('builder-name')).textContent).toBe('Workspace A');

    fireEvent.click(screen.getByRole('button', { name: 'Change draft' }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));

    const otherTab = JSON.parse(JSON.stringify(draft)) as StrategyAST;
    otherTab.name = 'Workspace C';
    const saved = saveWorkspace(storage(), otherTab, raw);
    release();

    expect(await screen.findByText('Unsaved changes')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Export unsaved draft' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reload workspace' }));

    await waitFor(() => expect(screen.getByTestId('builder-name').textContent).toBe('Workspace C'));
    expect(storage().getItem(WORKSPACE_KEY)).toBe(saved.revision);
    await waitFor(() => expect(screen.queryByText('Unsaved changes')).toBeNull());
  });
});
