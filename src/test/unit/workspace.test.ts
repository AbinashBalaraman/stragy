import { describe, expect, it } from 'vitest';
import { WORKSPACE_KEY, RECOVERY_KEY, loadWorkspace, loadWorkspaceState, saveWorkspace, saveWorkspaceWithLock, WorkspaceConflictError, WorkspaceLockUnavailableError, snapshotStrategy } from '../../client/workspace';
import type { WorkspaceLockManager } from '../../client/workspace';
import { strategy } from '../fixtures/research';
class MemoryStorage implements Storage {
  constructor(readonly data = new Map<string,string>()) {}
  failRecovery = false;
  failWorkspace = false;
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  key(index:number) { return [...this.data.keys()][index] ?? null; }
  getItem(key:string) { return this.data.get(key) ?? null; }
  setItem(key:string,value:string) {
    if (this.failRecovery && key === RECOVERY_KEY) throw new Error('Recovery quota exhausted');
    if (this.failWorkspace && key === WORKSPACE_KEY) throw new Error('Workspace quota exhausted');
    this.data.set(key,String(value));
  }
  removeItem(key:string) { this.data.delete(key); }
}
// Deterministic origin-shared exclusive lock queue, with no timers.
class SharedLocks implements WorkspaceLockManager {
  private tail: Promise<unknown> = Promise.resolve();
  readonly names: string[] = [];
  request<T>(name: string, callback: () => T | PromiseLike<T>): Promise<T> {
    this.names.push(name);
    const result = this.tail.then(callback);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
describe('workspace preservation', () => {
  it('W01 loads validated copies without symbol substitution', () => {
    const storage = new MemoryStorage(), original = strategy();
    saveWorkspace(storage,original);
    const loaded = loadWorkspace(storage,{...original,universe:{...original.universe,symbolId:999}});
    expect(loaded.universe.symbolId).toBe(1);
    const snapshot = snapshotStrategy(loaded); snapshot.name = 'changed copy';
    expect(loadWorkspace(storage,original).name).toBe(original.name);
  });
  it('W02 preserves corrupt raw bytes before fallback autosave', () => {
    const storage = new MemoryStorage(), raw = '{invalid saved JSON';
    storage.setItem(WORKSPACE_KEY,raw);
    const fallback = loadWorkspace(storage,strategy());
    expect(storage.getItem(WORKSPACE_KEY)).toBe(raw);
    expect(storage.getItem(RECOVERY_KEY)).toBe(raw);
    expect(saveWorkspace(storage,fallback).recoveryRetained).toBe(true);
    expect(storage.getItem(RECOVERY_KEY)).toBe(raw);
    expect(loadWorkspace(storage,strategy()).name).toBe(fallback.name);
  });
  it('W03 failed recovery writes never overwrite the original', () => {
    const storage = new MemoryStorage(), raw = '{corrupt';
    storage.setItem(WORKSPACE_KEY,raw); storage.failRecovery = true;
    const fallback = loadWorkspace(storage,strategy());
    expect(()=>saveWorkspace(storage,fallback)).toThrow('Recovery quota exhausted');
    expect(storage.getItem(WORKSPACE_KEY)).toBe(raw);
    expect(storage.getItem(RECOVERY_KEY)).toBeNull();
  });
  it('W04 an occupied recovery slot preserves both rejected records', () => {
    const storage = new MemoryStorage();
    storage.setItem(RECOVERY_KEY,'previous rejected bytes'); storage.setItem(WORKSPACE_KEY,'new rejected bytes');
    expect(()=>saveWorkspace(storage,strategy())).toThrow('already exists');
    expect(storage.getItem(WORKSPACE_KEY)).toBe('new rejected bytes');
    expect(storage.getItem(RECOVERY_KEY)).toBe('previous rejected bytes');
  });
  it('W05 handles a denied browser storage getter without crashing startup', () => {
    const loaded = loadWorkspace(()=>{throw new Error('Browser storage denied');},strategy());
    expect(loaded.name).toBe(strategy().name);
  });
  it('W06 invalid edits cannot replace a valid saved definition', () => {
    const storage = new MemoryStorage(); saveWorkspace(storage,strategy());
    const previous = storage.getItem(WORKSPACE_KEY), invalid = strategy(); invalid.rules.entry = [];
    expect(()=>saveWorkspace(storage,invalid)).toThrow();
    expect(storage.getItem(WORKSPACE_KEY)).toBe(previous);
  });
  it('W07 legacy migration backs up original input and keeps its symbol', () => {
    const storage = new MemoryStorage(), legacy = {...strategy(),version:1};
    const raw = JSON.stringify(legacy); storage.setItem('stragy_active_strategy',raw); storage.setItem('stragy_active_symbol_id','999');
    expect(loadWorkspace(storage,strategy()).universe.symbolId).toBe(legacy.universe.symbolId);
    expect(JSON.parse(storage.getItem('stragy_workspace_legacy_backup')!).strategy).toBe(raw);
  });
});

describe('workspace cross-tab revisions', () => {
  it('W08 rejects a stale tab and keeps its draft and the winning bytes', () => {
    const shared = new Map<string,string>(), tabA = new MemoryStorage(shared), tabB = new MemoryStorage(shared);
    const a = loadWorkspaceState(tabA, strategy()), b = loadWorkspaceState(tabB, strategy());
    a.strategy.name = 'Tab A'; b.strategy.name = 'Unsaved tab B';
    const saved = saveWorkspace(tabA, a.strategy, a.revision);
    expect(() => saveWorkspace(tabB, b.strategy, b.revision)).toThrow(WorkspaceConflictError);
    expect(tabB.getItem(WORKSPACE_KEY)).toBe(saved.revision);
    expect(b.strategy.name).toBe('Unsaved tab B');
    expect(() => saveWorkspace(tabB, b.strategy, b.revision)).toThrow(WorkspaceConflictError);
    const reloaded = loadWorkspaceState(tabB, strategy());
    reloaded.strategy.name = 'Explicitly reloaded';
    expect(saveWorkspace(tabB, reloaded.strategy, reloaded.revision).revision).not.toBe(saved.revision);
  });
  it('W09 compatibility callers retain an observed base per tab facade', () => {
    const shared = new Map<string,string>(), tabA = new MemoryStorage(shared), tabB = new MemoryStorage(shared);
    const a = loadWorkspace(tabA, strategy()), b = loadWorkspace(tabB, strategy());
    a.name = 'A wins'; b.name = 'B stale'; saveWorkspace(tabA, a);
    expect(() => saveWorkspace(tabB, b)).toThrow(WorkspaceConflictError);
    expect(loadWorkspace(tabA, strategy()).name).toBe('A wins');
  });
  it('W10 loads old version-1 envelope bytes without rewriting or treating them as corrupt', () => {
    const storage = new MemoryStorage();
    const raw = JSON.stringify({version:1, savedAt:'2024-01-01T00:00:00Z', strategy:{...strategy(),version:1}}, null, 2);
    storage.setItem(WORKSPACE_KEY, raw);
    const loaded = loadWorkspaceState(storage, strategy());
    expect(loaded.revision).toBe(raw);
    expect(storage.getItem(WORKSPACE_KEY)).toBe(raw);
    expect(storage.getItem(RECOVERY_KEY)).toBeNull();
    loaded.strategy.name = 'Migrated edit';
    const saved = saveWorkspace(storage, loaded.strategy, loaded.revision);
    expect(JSON.parse(saved.revision!).version).toBe(1);
    expect(loadWorkspace(storage, strategy()).name).toBe('Migrated edit');
  });
  it('W11 legacy migration returns the committed revision for the first edit', () => {
    const storage = new MemoryStorage();
    storage.setItem('stragy_active_strategy', JSON.stringify({...strategy(),version:1}));
    const loaded = loadWorkspaceState(storage, strategy());
    expect(loaded.revision).toBe(storage.getItem(WORKSPACE_KEY));
    expect(loaded.revision).not.toBeNull();
    loaded.strategy.name = 'Legacy edited';
    expect(() => saveWorkspace(storage, loaded.strategy, loaded.revision)).not.toThrow();
  });
  it('W12 quota failure does not advance the base or destroy saved bytes', () => {
    const storage = new MemoryStorage(), loaded = loadWorkspaceState(storage, strategy());
    const saved = saveWorkspace(storage, loaded.strategy, loaded.revision);
    storage.failWorkspace = true; loaded.strategy.name = 'Retry this draft';
    expect(() => saveWorkspace(storage, loaded.strategy, saved.revision)).toThrow('Workspace quota exhausted');
    expect(storage.getItem(WORKSPACE_KEY)).toBe(saved.revision);
    storage.failWorkspace = false;
    expect(() => saveWorkspace(storage, loaded.strategy)).not.toThrow();
  });
  it('W13 blind saves cannot overwrite valid records; deletion is a conflict', () => {
    const shared = new Map<string,string>(), tabA = new MemoryStorage(shared), blind = new MemoryStorage(shared);
    saveWorkspace(tabA, strategy());
    expect(() => saveWorkspace(blind, strategy())).toThrow(WorkspaceConflictError);
    const loaded = loadWorkspaceState(tabA, strategy()); blind.removeItem(WORKSPACE_KEY);
    expect(() => saveWorkspace(tabA, loaded.strategy, loaded.revision)).toThrow(WorkspaceConflictError);
  });
  it('W14 empty corrupt bytes and changed corrupt records are not silently discarded', () => {
    const storage = new MemoryStorage(); storage.setItem(WORKSPACE_KEY, '');
    const loaded = loadWorkspaceState(storage, strategy());
    expect(storage.getItem(RECOVERY_KEY)).toBe('');
    storage.setItem(WORKSPACE_KEY, '{new rejected bytes');
    expect(() => saveWorkspace(storage, loaded.strategy, loaded.revision)).toThrow(WorkspaceConflictError);
    expect(storage.getItem(WORKSPACE_KEY)).toBe('{new rejected bytes');
    expect(storage.getItem(RECOVERY_KEY)).toBe('');
  });
  it('W15 serializes simultaneous cooperating writers and rejects the second stale base', async () => {
    const shared = new Map<string,string>(), tabA = new MemoryStorage(shared), tabB = new MemoryStorage(shared), locks = new SharedLocks();
    const a = loadWorkspaceState(tabA, strategy()), b = loadWorkspaceState(tabB, strategy());
    a.strategy.name = 'Locked A'; b.strategy.name = 'Locked B';
    const outcomes = await Promise.allSettled([
      saveWorkspaceWithLock(tabA, a.strategy, a.revision, locks),
      saveWorkspaceWithLock(tabB, b.strategy, b.revision, locks),
    ]);
    expect(outcomes[0].status).toBe('fulfilled');
    expect(outcomes[1].status).toBe('rejected');
    if (outcomes[1].status === 'rejected') expect(outcomes[1].reason).toBeInstanceOf(WorkspaceConflictError);
    expect(locks.names).toEqual([WORKSPACE_KEY, WORKSPACE_KEY]);
    expect(loadWorkspace(tabA, strategy()).name).toBe('Locked A');
    const reloaded = loadWorkspaceState(tabB, strategy()); reloaded.strategy.name = 'Lock remains usable';
    await expect(saveWorkspaceWithLock(tabB, reloaded.strategy, reloaded.revision, locks)).resolves.toHaveProperty('revision');
  });
  it('W16 snapshots queued drafts before waiting on the shared lock', async () => {
    const storage = new MemoryStorage(), loaded = loadWorkspaceState(storage, strategy()), locks = new SharedLocks();
    loaded.strategy.name = 'Submitted snapshot';
    const pending = saveWorkspaceWithLock(storage, loaded.strategy, loaded.revision, locks);
    loaded.strategy.name = 'New unsaved edit';
    await pending;
    expect(loadWorkspace(storage, strategy()).name).toBe('Submitted snapshot');
  });
  it('W17 refuses unavailable lock protection without writing', async () => {
    const storage = new MemoryStorage();
    // null explicitly disables the manager, independent of browser defaults.
    await expect(saveWorkspaceWithLock(storage, strategy(), null, null)).rejects.toBeInstanceOf(WorkspaceLockUnavailableError);
    expect(storage.getItem(WORKSPACE_KEY)).toBeNull();
  });
});
