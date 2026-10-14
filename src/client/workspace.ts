import { validateStrategy } from '../shared/strategy/schema';
import { StrategyAST } from '../shared/strategy/types';
export const WORKSPACE_KEY = 'stragy_workspace_v1';
export const RECOVERY_KEY = 'stragy_workspace_invalid_backup_v1';
/** Opaque exact-byte base revision; null means no saved workspace. */
export type WorkspaceRevision = string | null;
export interface WorkspaceState { strategy: StrategyAST; revision: WorkspaceRevision }
export class WorkspaceConflictError extends Error {
  readonly code = 'WORKSPACE_CONFLICT';
  constructor() {
    super('Workspace changed in another tab. Your draft was not saved. Reload the saved workspace before editing again.');
    this.name = 'WorkspaceConflictError';
  }
}
export class WorkspaceLockUnavailableError extends Error {
  readonly code = 'WORKSPACE_LOCK_UNAVAILABLE';
  constructor() {
    super('Cross-tab workspace protection is unavailable. Your draft was not saved; keep or export it before reloading.');
    this.name = 'WorkspaceLockUnavailableError';
  }
}
export interface WorkspaceLockManager {
  request<T>(name: string, callback: () => T | PromiseLike<T>): Promise<T>;
}
const observedRevisions = new WeakMap<Storage, WorkspaceRevision>();
function readRecord(raw: string): StrategyAST {
  if (raw.length > 262144) throw new Error('Workspace exceeds the import budget');
  const record = JSON.parse(raw);
  if (record.version !== 1) throw new Error('Unsupported workspace version');
  return parseStrategy(record.strategy);
}
function preserveInvalid(storage: Storage, raw: string) {
  const previous = storage.getItem(RECOVERY_KEY);
  if (previous !== null && previous !== raw) throw new Error('A recovery backup already exists. Original workspace was not overwritten.');
  if (previous === null) storage.setItem(RECOVERY_KEY, raw);
}
export function parseStrategy(raw: unknown): StrategyAST {
  const result = validateStrategy(raw);
  if (!result.success || !result.data) throw new Error(result.errors?.join('; ') ?? 'Invalid strategy');
  return result.data;
}
/** Optimistic check only: localStorage has no atomic compare-and-set. Use
 * saveWorkspaceWithLock for cross-tab commits. Never refresh a stale draft's
 * base automatically. Version-1 bytes work as revisions without an upgrade. */
export function saveWorkspace(storage: Storage, strategy: StrategyAST, expectedRevision?: WorkspaceRevision): { recoveryRetained: boolean; revision: WorkspaceRevision } {
  const validated = parseStrategy(strategy);
  const current = storage.getItem(WORKSPACE_KEY);
  let invalid = false;
  if (current !== null) {
    try { readRecord(current); }
    catch { invalid = true; }
  }
  // Preserve direct corrupt-record recovery, but reject blind valid overwrites.
  const base = expectedRevision !== undefined ? expectedRevision
    : observedRevisions.has(storage) ? observedRevisions.get(storage)!
    : invalid ? current : null;
  if (current !== base) throw new WorkspaceConflictError();
  if (invalid && current !== null) preserveInvalid(storage, current);
  const recoveryRetained = storage.getItem(RECOVERY_KEY) !== null;
  const next = JSON.stringify({version: 1, savedAt: new Date().toISOString(), strategy: validated});
  if (next.length > 262144) throw new Error('Workspace exceeds the import budget');
  if (storage.getItem(WORKSPACE_KEY) !== base) throw new WorkspaceConflictError();
  storage.setItem(WORKSPACE_KEY, next);
  observedRevisions.set(storage, next);
  return { recoveryRetained, revision: next };
}
/** All cooperating writers must use the same origin-scoped Web Lock. Reject
 * missing locks rather than silently downgrade to an optimistic-only save. */
export async function saveWorkspaceWithLock(storage: Storage, strategy: StrategyAST, expectedRevision: WorkspaceRevision, locks?: WorkspaceLockManager | null): Promise<{ recoveryRetained: boolean; revision: WorkspaceRevision }> {
  const draft = snapshotStrategy(strategy);
  const manager = locks === undefined ? (typeof navigator !== 'undefined' ? navigator.locks : undefined) : locks;
  if (!manager) throw new WorkspaceLockUnavailableError();
  return manager.request(WORKSPACE_KEY, () => saveWorkspace(storage, draft, expectedRevision));
}
export function loadWorkspaceState(input: Storage | (() => Storage), fallback: StrategyAST, options: { deferLegacyCommit?: boolean } = {}): WorkspaceState {
  let revision: WorkspaceRevision = null;
  try {
    const storage = typeof input === 'function' ? input() : input;
    const current = storage.getItem(WORKSPACE_KEY);
    revision = current;
    observedRevisions.set(storage, current);
    if (current !== null) {
      try { return { strategy: readRecord(current), revision }; }
      catch { preserveInvalid(storage, current); throw new Error('Invalid workspace retained for recovery'); }
    }
    const legacy = storage.getItem('stragy_active_strategy');
    if (legacy) {
      storage.setItem('stragy_workspace_legacy_backup', JSON.stringify({strategy: legacy, symbol: storage.getItem('stragy_active_symbol_id')}));
      const draft = parseStrategy(JSON.parse(legacy));
      if (options.deferLegacyCommit) return { strategy: draft, revision };
      const saved = saveWorkspace(storage, draft, revision);
      return { strategy: draft, revision: saved.revision };
    }
  } catch { /* Preserve invalid records, never invent executable rules. */ }
  return { strategy: parseStrategy(JSON.parse(JSON.stringify(fallback))), revision };
}
export function loadWorkspace(input: Storage | (() => Storage), fallback: StrategyAST): StrategyAST {
  return loadWorkspaceState(input, fallback).strategy;
}
export function snapshotStrategy(strategy: StrategyAST, symbolId = strategy.universe.symbolId): StrategyAST {
  const universe = symbolId === strategy.universe.symbolId ? { ...strategy.universe }
    : { symbolId, instrumentId: 'legacy:' + symbolId, timeframe: strategy.universe.timeframe };
  return parseStrategy(JSON.parse(JSON.stringify({ ...strategy, universe })));
}
export class RequestOwner { private generation = 0; begin() { return ++this.generation; } owns(id: number) { return id === this.generation; } invalidate() { ++this.generation; } }
