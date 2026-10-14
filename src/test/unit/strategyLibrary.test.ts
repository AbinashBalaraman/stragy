import { describe, expect, it } from 'vitest';
import { commitStrategyLibrary, exportSavedStrategy, getSavedStrategy, LIBRARY_LIMITS, readStrategyLibrary, STRATEGY_LIBRARY_KEY as KEY, STRATEGY_LIBRARY_RECOVERY_KEY as BACKUP, StrategyLibraryConflictError } from '../../client/strategyLibrary';
import type { LibraryLocks, LibraryOperation, StrategyLibraryState } from '../../client/strategyLibrary';
import { strategy } from '../fixtures/research';
import { STRATEGY_TEMPLATES } from '../../shared/strategy/templates';

class MemoryStorage implements Storage {
  data = new Map<string, string>();
  writes: string[] = [];
  failKey: string | null = null;
  denyReads = false;
  ignoreKey: string | null = null;
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  key(i: number) { return [...this.data.keys()][i] ?? null; }
  getItem(key: string) { if (this.denyReads) throw new Error('Storage denied'); return this.data.get(key) ?? null; }
  setItem(key: string, value: string) {
    if (key === this.failKey) throw new Error('Quota exceeded');
    this.writes.push(key);
    if (key !== this.ignoreKey) this.data.set(key, value);
  }
  removeItem(key: string) { this.data.delete(key); }
}
class SharedLocks implements LibraryLocks {
  tail: Promise<unknown> = Promise.resolve();
  names: string[] = [];
  request<T>(name: string, callback: () => T | PromiseLike<T>): Promise<T> {
    this.names.push(name);
    const result = this.tail.then(callback);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
const now = () => '2026-10-13T10:00:00.000Z';
function fixture() {
  const storage = new MemoryStorage(), locks = new SharedLocks();
  let counter = 0;
  const options = { locks, now, newId: () => 'saved-' + ++counter };
  const commit = (state: StrategyLibraryState, op: LibraryOperation) => commitStrategyLibrary(storage, state.revision, op, options);
  return { storage, locks, options, commit };
}
const save = (name = 'Mine'): LibraryOperation => ({ type: 'saveAs', strategy: strategy(), name });

describe('local saved strategy library', () => {
  it('saves a validated independent snapshot with a new identity, not a mutable template', async () => {
    const f = fixture(), template = STRATEGY_TEMPLATES[0].strategy, original = JSON.stringify(template);
    const state = await f.commit(readStrategyLibrary(f.storage), { type: 'saveAs', strategy: template, name: 'My example' });
    const entry = state.entries[0];
    expect(entry.id).toBe('saved-1'); expect(entry.revisions[0].strategy.id).toBe(entry.id);
    expect(JSON.stringify(template)).toBe(original);
    const loaded = getSavedStrategy(entry); loaded.name = 'builder changed'; loaded.rules.entry[0].rightValue = 123;
    expect(getSavedStrategy(entry).name).toBe('My example');
    expect(readStrategyLibrary(f.storage).entries[0].revisions[0].strategy.name).toBe('My example');
    expect(Object.isFrozen(entry.revisions[0].strategy.rules.entry)).toBe(true);
  });
  it('rename and current-strategy revision append immutable snapshots; old JSON still exports', async () => {
    const f = fixture(); let state = await f.commit(readStrategyLibrary(f.storage), save());
    const original = exportSavedStrategy(state.entries[0], 1), id = state.entries[0].id;
    state = await f.commit(state, { type: 'rename', id, name: 'Renamed' });
    const edited = strategy(); edited.risk.stopLoss.value = 7;
    state = await f.commit(state, { type: 'revise', id, strategy: edited });
    expect(state.entries[0].revisions.map(r => r.revision)).toEqual([1, 2, 3]);
    expect(exportSavedStrategy(state.entries[0], 1)).toBe(original);
    expect(getSavedStrategy(state.entries[0]).name).toBe('Renamed');
    expect(getSavedStrategy(state.entries[0]).risk.stopLoss.value).toBe(7);
    expect(JSON.parse(exportSavedStrategy(state.entries[0])).id).toBe(id);
  });
  it('duplicates an explicitly selected historical revision with a new identity', async () => {
    const f = fixture(); let state = await f.commit(readStrategyLibrary(f.storage), save());
    const id = state.entries[0].id;
    state = await f.commit(state, { type: 'rename', id, name: 'Later' });
    state = await f.commit(state, { type: 'duplicate', id, revision: 1 });
    expect(state.entries[1].id).not.toBe(id);
    expect(getSavedStrategy(state.entries[1])).toMatchObject({ id: 'saved-2', name: 'Mine (copy)' });
    expect(state.entries[1].revisions).toHaveLength(1);
    expect(state.entries[0].revisions).toHaveLength(2);
  });
  it('soft delete and restore preserve all revision bytes and count toward retention', async () => {
    const f = fixture(); let state = await f.commit(readStrategyLibrary(f.storage), save());
    const entry = state.entries[0], revisions = JSON.stringify(entry.revisions);
    state = await f.commit(state, { type: 'delete', id: entry.id });
    expect(state.entries[0].deletedAt).toBe(now());
    await expect(f.commit(state, { type: 'rename', id: entry.id, name: 'No' })).rejects.toThrow('Restore');
    state = await f.commit(state, { type: 'restore', id: entry.id });
    expect(state.entries[0].deletedAt).toBeNull();
    expect(JSON.stringify(state.entries[0].revisions)).toBe(revisions);
  });
  it('origin lock serializes writers and rejects stale expected bytes without silently losing saves', async () => {
    const f = fixture(), a = readStrategyLibrary(f.storage), b = readStrategyLibrary(f.storage);
    const results = await Promise.allSettled([f.commit(a, save('A')), f.commit(b, save('B'))]);
    expect(results[0].status).toBe('fulfilled');
    expect(results[1]).toMatchObject({ status: 'rejected', reason: expect.any(StrategyLibraryConflictError) });
    expect(f.locks.names).toEqual([KEY, KEY]);
    expect(readStrategyLibrary(f.storage).entries.map(e => getSavedStrategy(e).name)).toEqual(['A']);
  });
  it('captures caller draft before awaiting a lock', async () => {
    const f = fixture(), draft = strategy();
    const promise = f.commit(readStrategyLibrary(f.storage), { type: 'saveAs', strategy: draft, name: 'Captured' });
    draft.risk.stopLoss.value = 99;
    expect(getSavedStrategy((await promise).entries[0]).risk.stopLoss.value).toBe(20);
  });
  it('fails closed when origin locks are missing or denied', async () => {
    const f = fixture();
    await expect(commitStrategyLibrary(f.storage, null, save(), { locks: null })).rejects.toThrow('Cross-tab protection');
    await expect(commitStrategyLibrary(f.storage, null, save(), { locks: { request: async () => { throw new Error('Lock denied'); } } })).rejects.toThrow('Lock denied');
    expect(f.storage.writes).toEqual([]);
  });
  it('reports read denial and quota failure without modifying the last successful library', async () => {
    const f = fixture(); const state = await f.commit(readStrategyLibrary(f.storage), save());
    f.storage.failKey = KEY;
    await expect(f.commit(state, save('Not saved'))).rejects.toThrow('Quota');
    expect(f.storage.getItem(KEY)).toBe(state.revision);
    f.storage.denyReads = true;
    expect(() => readStrategyLibrary(f.storage)).toThrow('Storage denied');
    await expect(f.commit(state, save())).rejects.toThrow('Storage denied');
  });
  it('rejects unverified writes rather than reporting success', async () => {
    const f = fixture(); f.storage.ignoreKey = KEY;
    await expect(f.commit(readStrategyLibrary(f.storage), save())).rejects.toThrow('verified');
    expect(f.storage.getItem(KEY)).toBeNull();
  });
  it.each(['{broken json', JSON.stringify({ version: 2, entries: [] }), JSON.stringify({ version: 1, entries: [], surprise: true })])('retains corrupt schema bytes before any explicit overwrite: %s', async raw => {
    const f = fixture(); f.storage.data.set(KEY, raw);
    const state = readStrategyLibrary(f.storage);
    expect(state).toMatchObject({ entries: [], corrupt: true, revision: raw });
    expect(f.storage.writes).toEqual([]);
    await f.commit(state, save());
    expect(f.storage.writes).toEqual([BACKUP, KEY]); expect(f.storage.getItem(BACKUP)).toBe(raw);
  });
  it('invalid stored strategy or revision sequence is never exposed as executable', async () => {
    const f = fixture(), state = await f.commit(readStrategyLibrary(f.storage), save());
    const record = JSON.parse(state.revision!); record.entries[0].revisions[0].strategy.rules.entry[0].leftIndicator = 'unknown';
    f.storage.data.set(KEY, JSON.stringify(record)); expect(readStrategyLibrary(f.storage).corrupt).toBe(true);
    record.entries[0].revisions[0].revision = 5;
    f.storage.data.set(KEY, JSON.stringify(record)); expect(readStrategyLibrary(f.storage).entries).toEqual([]);
  });
  it('backup quota, conflicting backups, and unverified backup writes never overwrite corrupt originals', async () => {
    const f = fixture(); f.storage.data.set(KEY, 'original');
    const state = readStrategyLibrary(f.storage);
    f.storage.failKey = BACKUP;
    await expect(f.commit(state, save())).rejects.toThrow('Quota'); expect(f.storage.getItem(KEY)).toBe('original');
    f.storage.failKey = null; f.storage.ignoreKey = BACKUP;
    await expect(f.commit(state, save())).rejects.toThrow('Recovery backup failed'); expect(f.storage.getItem(KEY)).toBe('original');
    f.storage.ignoreKey = null; f.storage.data.set(BACKUP, 'older corrupt bytes');
    await expect(f.commit(state, save())).rejects.toThrow('different recovery'); expect(f.storage.getItem(KEY)).toBe('original');
    expect(f.storage.getItem(BACKUP)).toBe('older corrupt bytes');
  });
  it('keeps the recovery backup if the subsequent main write fails', async () => {
    const f = fixture(); f.storage.data.set(KEY, 'corrupt'); f.storage.failKey = KEY;
    await expect(f.commit(readStrategyLibrary(f.storage), save())).rejects.toThrow('Quota');
    expect(f.storage.getItem(KEY)).toBe('corrupt'); expect(f.storage.getItem(BACKUP)).toBe('corrupt');
  });
  it('rejects invalid drafts, names, missing sources, and identity collisions without writes', async () => {
    const f = fixture(), empty = readStrategyLibrary(f.storage);
    const invalid = strategy(); invalid.rules.entry[0].leftIndicator = 'missing';
    await expect(f.commit(empty, { type: 'saveAs', strategy: invalid, name: 'Bad' })).rejects.toThrow();
    await expect(f.commit(empty, save('  '))).rejects.toThrow();
    await expect(f.commit(empty, { type: 'duplicate', id: 'absent' })).rejects.toThrow('not found');
    expect(f.storage.writes).toEqual([]);
    const state = await f.commit(empty, save());
    await expect(commitStrategyLibrary(f.storage, state.revision, save(), { ...f.options, newId: () => state.entries[0].id })).rejects.toThrow('collision');
    expect(f.storage.getItem(KEY)).toBe(state.revision);
  });
  it('bounds revision retention without silently evicting old snapshots', async () => {
    const f = fixture(); let state = await f.commit(readStrategyLibrary(f.storage), save());
    const original = exportSavedStrategy(state.entries[0]);
    for (let i = 1; i < LIBRARY_LIMITS.revisionsPerEntry; i++) state = await f.commit(state, { type: 'rename', id: state.entries[0].id, name: 'Name ' + i });
    await expect(f.commit(state, { type: 'rename', id: state.entries[0].id, name: 'Too many' })).rejects.toThrow('retention limit');
    expect(f.storage.getItem(KEY)).toBe(state.revision); expect(exportSavedStrategy(state.entries[0], 1)).toBe(original);
  });
  it('bounds entries including trash, total revisions, and UTF-16 bytes', async () => {
    const f = fixture(), initial = await f.commit(readStrategyLibrary(f.storage), save());
    const exemplar = initial.entries[0];
    const make = (n: number, count: number) => Array.from({ length: n }, (_, i) => ({ ...exemplar, id: 'seed-' + i, deletedAt: now(), revisions: Array.from({ length: count }, (_, j) => ({ ...exemplar.revisions[0], revision: j + 1, strategy: { ...getSavedStrategy(exemplar), id: 'seed-' + i } })) }));
    f.storage.data.set(KEY, JSON.stringify({ version: 1, entries: make(50, 1) }));
    let state = readStrategyLibrary(f.storage); expect(state.corrupt).toBe(false);
    await expect(f.commit(state, save())).rejects.toThrow(); expect(f.storage.getItem(KEY)).toBe(state.revision);
    f.storage.data.set(KEY, JSON.stringify({ version: 1, entries: make(10, 20) }));
    state = readStrategyLibrary(f.storage); expect(state.corrupt).toBe(false);
    await expect(f.commit(state, save())).rejects.toThrow('revision limit'); expect(f.storage.getItem(KEY)).toBe(state.revision);
    const huge = strategy(); huge.description = 'x'.repeat(LIBRARY_LIMITS.strategyBytes);
    await expect(f.commit(state, { type: 'saveAs', name: 'Huge', strategy: huge })).rejects.toThrow('byte limit');
    f.storage.data.set(KEY, 'x'.repeat(LIBRARY_LIMITS.bytes)); state = readStrategyLibrary(f.storage);
    await expect(f.commit(state, save())).rejects.toThrow('too large'); expect(f.storage.getItem(KEY)).toBe(state.revision);
  });
});
