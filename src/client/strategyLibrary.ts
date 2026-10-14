import { z } from 'zod';
import type { StrategyAST } from '../shared/strategy/types';
import { parseStrategy } from './workspace';

export const STRATEGY_LIBRARY_KEY = 'stragy_strategy_library_v1';
export const STRATEGY_LIBRARY_RECOVERY_KEY = 'stragy_strategy_library_invalid_backup_v1';
/** UTF-16 storage bytes, including metadata. No automatic eviction of revisions or trash. */
export const LIBRARY_LIMITS = Object.freeze({ entries: 50, revisionsPerEntry: 20, totalRevisions: 200, bytes: 1_048_576, strategyBytes: 262_144 });
export interface SavedStrategyRevision { revision: number; savedAt: string; strategy: StrategyAST }
export interface SavedStrategy { id: string; createdAt: string; deletedAt: string | null; revisions: SavedStrategyRevision[] }
export interface StrategyLibraryState { entries: SavedStrategy[]; revision: string | null; corrupt: boolean }
export interface LibraryLocks { request<T>(name: string, callback: () => T | PromiseLike<T>): Promise<T> }
export interface LibraryOptions { locks?: LibraryLocks | null; now?: () => string; newId?: () => string }
export type LibraryOperation =
  | { type: 'saveAs'; strategy: StrategyAST; name: string }
  | { type: 'revise'; id: string; strategy: StrategyAST }
  | { type: 'rename'; id: string; name: string }
  | { type: 'duplicate'; id: string; revision?: number }
  | { type: 'delete'; id: string }
  | { type: 'restore'; id: string };
export class StrategyLibraryConflictError extends Error {
  constructor() { super('My Strategies changed in another tab. Nothing was saved. Reload the library and retry.'); this.name = 'StrategyLibraryConflictError'; }
}
const timestamp = z.string().datetime();
const identity = z.string().min(1).max(128);
const nameSchema = z.string().trim().min(1).max(80);
const recordSchema = z.object({
  version: z.literal(1),
  entries: z.array(z.object({
    id: identity, createdAt: timestamp, deletedAt: timestamp.nullable(),
    revisions: z.array(z.object({ revision: z.number().int().positive(), savedAt: timestamp, strategy: z.unknown() }).strict()).min(1).max(LIBRARY_LIMITS.revisionsPerEntry),
  }).strict()).max(LIBRARY_LIMITS.entries),
}).strict();
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function checkedStrategy(input: unknown): StrategyAST {
  const bytes = JSON.stringify(input);
  if (!bytes || bytes.length * 2 > LIBRARY_LIMITS.strategyBytes) throw new Error('Strategy exceeds the local library byte limit.');
  return clone(parseStrategy(input));
}
function decode(raw: string): SavedStrategy[] {
  if (raw.length * 2 > LIBRARY_LIMITS.bytes) throw new Error('Local library byte limit reached.');
  const record = recordSchema.parse(JSON.parse(raw));
  const ids = new Set<string>();
  let total = 0;
  const entries = record.entries.map(entry => {
    if (ids.has(entry.id)) throw new Error('Duplicate saved strategy identity.');
    ids.add(entry.id);
    const revisions = entry.revisions.map((rev, i) => {
      if (rev.revision !== i + 1) throw new Error('Invalid saved revision sequence.');
      const strategy = checkedStrategy(rev.strategy);
      if (strategy.id !== entry.id || nameSchema.parse(strategy.name) !== strategy.name) throw new Error('Invalid saved strategy identity or name.');
      return { ...rev, strategy };
    });
    total += revisions.length;
    return { ...entry, revisions };
  });
  if (total > LIBRARY_LIMITS.totalRevisions) throw new Error('Local library revision limit reached.');
  return entries;
}
/** Corrupt bytes stay untouched until an explicit successful, lock-protected recovery commit. */
export function readStrategyLibrary(storage: Storage): StrategyLibraryState {
  const revision = storage.getItem(STRATEGY_LIBRARY_KEY);
  if (revision === null) return freeze({ entries: [], revision, corrupt: false });
  try { return freeze({ entries: decode(revision), revision, corrupt: false }); }
  catch { return freeze({ entries: [], revision, corrupt: true }); }
}
export function getSavedStrategy(entry: SavedStrategy, revision = entry.revisions.length): StrategyAST {
  const saved = entry.revisions.find(r => r.revision === revision);
  if (!saved) throw new Error('Saved revision not found.');
  return checkedStrategy(saved.strategy);
}
/** Standalone validated AST JSON, compatible with the builder/import contract. */
export function exportSavedStrategy(entry: SavedStrategy, revision?: number): string {
  return JSON.stringify(getSavedStrategy(entry, revision), null, 2);
}
/** All origin writers use this lock and exact bytes observed by their own tab.
 * Missing Web Locks fails closed; stale writers never merge or silently replace newer saves. */
export async function commitStrategyLibrary(storage: Storage, expectedRevision: string | null, operation: LibraryOperation, options: LibraryOptions = {}): Promise<StrategyLibraryState> {
  const op = clone(operation); // Capture the draft before awaiting a lock.
  const locks = options.locks === undefined ? (typeof navigator === 'undefined' ? undefined : navigator.locks) : options.locks;
  if (!locks) throw new Error('Cross-tab protection is unavailable. My Strategies was not saved.');
  return locks.request(STRATEGY_LIBRARY_KEY, () => {
    const state = readStrategyLibrary(storage);
    if (state.revision !== expectedRevision) throw new StrategyLibraryConflictError();
    const entries = clone(state.entries);
    const savedAt = timestamp.parse((options.now ?? (() => new Date().toISOString()))());
    const newIdentity = () => {
      const id = identity.parse((options.newId ?? (() => crypto.randomUUID()))());
      if (entries.some(e => e.id === id)) throw new Error('Saved strategy identity collision. Nothing was saved.');
      return id;
    };
    const append = (entry: SavedStrategy, strategy: StrategyAST) => {
      if (entry.revisions.length >= LIBRARY_LIMITS.revisionsPerEntry) throw new Error('Revision retention limit reached. Export your history; no revisions were removed.');
      entry.revisions.push({ revision: entry.revisions.length + 1, savedAt, strategy: checkedStrategy({ ...strategy, id: entry.id }) });
    };
    if (op.type === 'saveAs') {
      const id = newIdentity();
      const strategy = checkedStrategy({ ...op.strategy, id, name: nameSchema.parse(op.name) });
      entries.push({ id, createdAt: savedAt, deletedAt: null, revisions: [{ revision: 1, savedAt, strategy }] });
    } else {
      const entry = entries.find(e => e.id === op.id);
      if (!entry) throw new Error('Saved strategy not found.');
      if (op.type === 'restore') {
        if (!entry.deletedAt) throw new Error('Strategy is not in trash.');
        entry.deletedAt = null;
      } else if (op.type === 'delete') {
        if (entry.deletedAt) throw new Error('Strategy is already in trash.');
        entry.deletedAt = savedAt;
      } else {
        if (entry.deletedAt) throw new Error('Restore this strategy before changing it.');
        if (op.type === 'duplicate') {
          const id = newIdentity();
          const strategy = getSavedStrategy(entry, op.revision);
          strategy.id = id;
          strategy.name = nameSchema.parse(strategy.name.slice(0, 73) + ' (copy)');
          entries.push({ id, createdAt: savedAt, deletedAt: null, revisions: [{ revision: 1, savedAt, strategy }] });
        } else if (op.type === 'rename') {
          append(entry, { ...getSavedStrategy(entry), name: nameSchema.parse(op.name) });
        } else {
          append(entry, { ...checkedStrategy(op.strategy), name: getSavedStrategy(entry).name });
        }
      }
    }
    const next = JSON.stringify({ version: 1, entries });
    const validated = decode(next); // Check ALL persisted schema and retention limits before any write.
    if (state.corrupt && state.revision !== null) {
      if (state.revision.length * 2 > LIBRARY_LIMITS.bytes) throw new Error('Corrupt library is too large to back up safely. Original bytes were not overwritten.');
      const backup = storage.getItem(STRATEGY_LIBRARY_RECOVERY_KEY);
      if (backup !== null && backup !== state.revision) throw new Error('A different recovery backup exists. Original library was not overwritten.');
      if (backup === null) storage.setItem(STRATEGY_LIBRARY_RECOVERY_KEY, state.revision);
      if (storage.getItem(STRATEGY_LIBRARY_RECOVERY_KEY) !== state.revision) throw new Error('Recovery backup failed. Original library was not overwritten.');
    }
    if (storage.getItem(STRATEGY_LIBRARY_KEY) !== expectedRevision) throw new StrategyLibraryConflictError();
    storage.setItem(STRATEGY_LIBRARY_KEY, next); // SecurityError/QuotaExceededError propagate, never false success.
    if (storage.getItem(STRATEGY_LIBRARY_KEY) !== next) throw new Error('Local library write could not be verified.');
    return freeze({ entries: validated, revision: next, corrupt: false });
  });
}
