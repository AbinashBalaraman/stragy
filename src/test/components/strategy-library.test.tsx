// @vitest-environment jsdom
import React from 'react';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrategyLibraryView } from '../../components/library/StrategyLibraryView';
import { commitStrategyLibrary, readStrategyLibrary, STRATEGY_LIBRARY_KEY as KEY, STRATEGY_LIBRARY_RECOVERY_KEY as BACKUP } from '../../client/strategyLibrary';
import { STRATEGY_TEMPLATES } from '../../shared/strategy/templates';
import { strategy } from '../fixtures/research';
const locks = { request: async <T,>(_name: string, callback: () => T | PromiseLike<T>) => callback() };
class TestStorage implements Storage {
  private data = new Map<string, string>();
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, String(value)); }
  removeItem(key: string) { this.data.delete(key); }
  key(i: number) { return [...this.data.keys()][i] ?? null; }
}
let descriptor: PropertyDescriptor | undefined;
let storageDescriptor: PropertyDescriptor | undefined;
beforeEach(() => {
  storageDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
  Object.defineProperty(window, 'localStorage', { configurable: true, value: new TestStorage() });
  descriptor = Object.getOwnPropertyDescriptor(navigator, 'locks');
  Object.defineProperty(navigator, 'locks', { configurable: true, value: locks });
});
afterEach(() => {
  cleanup();
  if (descriptor) Object.defineProperty(navigator, 'locks', descriptor); else Reflect.deleteProperty(navigator, 'locks');
  if (storageDescriptor) Object.defineProperty(window, 'localStorage', storageDescriptor); else Reflect.deleteProperty(window, 'localStorage');
});
const saveButton = () => screen.getByRole('button', { name: 'Save current strategy as new' });
async function seed() {
  return commitStrategyLibrary(window.localStorage, null, { type: 'saveAs', strategy: strategy(), name: 'Saved fixture' }, { locks, now: () => '2026-10-13T10:00:00.000Z', newId: () => 'fixture-id' });
}

describe('My Strategies alongside immutable templates', () => {
  it('preserves the existing callback/template UI and disables saving without a current strategy', () => {
    const before = JSON.stringify(STRATEGY_TEMPLATES), onLoad = vi.fn(s => { s.name = 'builder edits'; });
    render(<StrategyLibraryView onLoadStrategy={onLoad} />);
    expect(saveButton()).toBeDisabled();
    fireEvent.click(screen.getAllByRole('button', { name: 'Load Template into Builder' })[0]);
    expect(onLoad).toHaveBeenCalledTimes(1); expect(JSON.stringify(STRATEGY_TEMPLATES)).toBe(before);
    expect(window.localStorage.getItem(KEY)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Momentum' }));
    expect(screen.getAllByRole('button', { name: 'Load Template into Builder' })).toHaveLength(STRATEGY_TEMPLATES.filter(t => t.category === 'Momentum').length);
  });
  it('explicitly saves, renames, selects old revisions, duplicates, deletes and restores', async () => {
    const onLoad = vi.fn(), current = strategy(), original = JSON.stringify(current);
    render(<StrategyLibraryView currentStrategy={current} onLoadStrategy={onLoad} />);
    expect(window.localStorage.getItem(KEY)).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: 'Save as name' }), { target: { value: 'Mine' } });
    fireEvent.click(saveButton()); await screen.findByRole('article', { name: 'Mine' });
    expect(screen.getByRole('status')).toHaveTextContent('saved as a new copy');
    expect(JSON.stringify(current)).toBe(original);
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'New strategy name' }), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm rename' }));
    const renamed = await screen.findByRole('article', { name: 'Renamed' });
    fireEvent.change(within(renamed).getByRole('combobox'), { target: { value: '1' } });
    fireEvent.click(within(renamed).getByRole('button', { name: 'Load saved revision' }));
    expect(onLoad.mock.calls[0][0].name).toBe('Mine');
    onLoad.mock.calls[0][0].name = 'mutated builder';
    expect(readStrategyLibrary(window.localStorage).entries[0].revisions[0].strategy.name).toBe('Mine');
    fireEvent.click(within(renamed).getByRole('button', { name: 'Duplicate' }));
    await screen.findByRole('article', { name: 'Mine (copy)' });
    const records = readStrategyLibrary(window.localStorage).entries;
    expect(records[0].id).not.toBe(records[1].id);
    fireEvent.click(within(screen.getByRole('article', { name: 'Renamed' })).getByRole('button', { name: 'Move to trash' }));
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Renamed' })).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Trash (1)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Trash (0)' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Saved strategies' }));
    expect(screen.getByRole('article', { name: 'Renamed' })).toBeInTheDocument();
    expect(readStrategyLibrary(window.localStorage).entries[0].revisions).toHaveLength(2);
  });
  it('saves current edits as a new revision only on explicit action', async () => {
    await seed(); const current = strategy(); current.risk.stopLoss.value = 5;
    render(<StrategyLibraryView currentStrategy={current} onLoadStrategy={vi.fn()} />);
    expect(readStrategyLibrary(window.localStorage).entries[0].revisions).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Save current as new revision' }));
    await waitFor(() => expect(readStrategyLibrary(window.localStorage).entries[0].revisions).toHaveLength(2));
    const entry = readStrategyLibrary(window.localStorage).entries[0];
    expect(entry.revisions[0].strategy.risk.stopLoss.value).toBe(20);
    expect(entry.revisions[1].strategy.risk.stopLoss.value).toBe(5);
  });
  it('exports selected validated JSON and cleans up its temporary download URL', async () => {
    await seed(); const create = vi.fn((_blob: Blob) => 'blob:test'), revoke = vi.fn();
    const OriginalURL = URL;
    class DownloadURL extends OriginalURL { static createObjectURL = create; static revokeObjectURL = revoke; }
    vi.stubGlobal('URL', DownloadURL);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<StrategyLibraryView onLoadStrategy={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export JSON' }));
    expect(create).toHaveBeenCalledTimes(1); expect(create.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect(click).toHaveBeenCalledTimes(1); expect(revoke).toHaveBeenCalledWith('blob:test');
    expect(screen.getByRole('status')).toHaveTextContent('Validated JSON download requested');
    expect(document.querySelector('a[download]')).toBeNull();
  });
  it('reports quota failure as not saved, with no success state or phantom strategy', async () => {
    render(<StrategyLibraryView currentStrategy={strategy()} onLoadStrategy={vi.fn()} />);
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); });
    fireEvent.click(saveButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('Not saved: Quota exceeded');
    expect(screen.queryByRole('status')).toBeNull(); expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(screen.queryAllByRole('article')).toHaveLength(0);
  });
  it('reports unavailable locks and denied storage without false success', async () => {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
    const view = render(<StrategyLibraryView currentStrategy={strategy()} onLoadStrategy={vi.fn()} />);
    fireEvent.click(saveButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('Cross-tab protection');
    expect(screen.queryByRole('status')).toBeNull(); view.unmount();
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => { throw new Error('Access denied'); });
    render(<StrategyLibraryView currentStrategy={strategy()} onLoadStrategy={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Cannot access My Strategies: Access denied');
    expect(saveButton()).toBeDisabled();
  });
  it('retains corrupt bytes on load and backs up originals before explicit save', async () => {
    window.localStorage.setItem(KEY, '{broken');
    render(<StrategyLibraryView currentStrategy={strategy()} onLoadStrategy={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('has not been overwritten');
    expect(window.localStorage.getItem(KEY)).toBe('{broken'); expect(window.localStorage.getItem(BACKUP)).toBeNull();
    fireEvent.click(saveButton());
    await screen.findByRole('status');
    expect(window.localStorage.getItem(BACKUP)).toBe('{broken');
    expect(screen.getByRole('status')).toHaveTextContent('Original corrupt bytes were retained');
  });
  it('blocks stale-tab saves until explicit reload without changing the builder draft', async () => {
    const onLoad = vi.fn(); render(<StrategyLibraryView currentStrategy={strategy()} onLoadStrategy={onLoad} />);
    await seed();
    fireEvent(window, new StorageEvent('storage', { key: KEY }));
    expect(screen.getByRole('alert')).toHaveTextContent('changed in another tab'); expect(saveButton()).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Reload library' }));
    expect(saveButton()).not.toBeDisabled(); expect(screen.getByRole('article', { name: 'Saved fixture' })).toBeInTheDocument();
    expect(onLoad).not.toHaveBeenCalled();
  });
});
