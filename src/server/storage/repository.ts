import { readFile, mkdir, writeFile, rename, copyFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { BacktestResponse, StrategyAST } from '../../shared/strategy/types';
import { validateStrategy, canonicalStrategyJSON } from '../../shared/strategy/schema';
import { parseBacktestResult } from '../../shared/contracts/research';
export class StorageError extends Error { constructor(public code: string, message: string, public status = 409) { super(message); } }
export interface SavedRevision { id: string; revision: number; strategy: StrategyAST; hash: string; updatedAt: string; }
interface State { schemaVersion: 2; runs: BacktestResponse[]; strategies: SavedRevision[]; revisions: SavedRevision[]; }
interface Draft { runs: Map<string, BacktestResponse>; strategies: Map<string, SavedRevision>; revisions: Map<string, SavedRevision>; }
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
/** Single-instance repository. File persistence requires a verified persistent disk, not ephemeral hosting. */
export class ResearchRepository {
  private state: Draft = { runs: new Map(), strategies: new Map(), revisions: new Map() };
  private operations: Promise<void> = Promise.resolve();
  private constructor(private options: { filePath?: string; maxRuns?: number; maxStrategies?: number; maxRevisions?: number }) {}
  static async open(options: { filePath?: string; maxRuns?: number; maxStrategies?: number; maxRevisions?: number } = {}): Promise<ResearchRepository> {
    const repository = new ResearchRepository(options);
    if (options.filePath) {
      try {
        const raw = await readFile(options.filePath, 'utf8');
        if (Buffer.byteLength(raw) > 50_000_000) throw new StorageError('STORAGE_TOO_LARGE', 'Stored data exceeds recovery budget.');
        const stored = JSON.parse(raw) as Partial<State> & { schemaVersion: number };
        if (![1, 2].includes(stored.schemaVersion) || !Array.isArray(stored.runs) || !Array.isArray(stored.strategies)) throw new StorageError('UNSUPPORTED_STORAGE_VERSION', 'Stored file requires a supported migration.');
        for (const run of stored.runs) {
          let validated: BacktestResponse;
          try { validated = parseBacktestResult(run); }
          catch { throw new StorageError('INVALID_STORED_RUN', 'Malformed stored run; original is preserved.'); }
          repository.state.runs.set(validated.backtestId, clone(validated));
        }
        const validateRecord = (record: SavedRevision) => { const parsed = validateStrategy(record.strategy); if (!parsed.success || !record.id || !Number.isInteger(record.revision) || record.revision < 1) throw new StorageError('INVALID_STORED_STRATEGY', 'Invalid stored strategy; original is preserved.'); };
        for (const record of stored.strategies) { validateRecord(record); repository.state.strategies.set(record.id, clone(record)); }
        for (const record of stored.revisions ?? stored.strategies) { validateRecord(record); repository.state.revisions.set(record.id + '@' + record.revision, clone(record)); }
        await copyFile(options.filePath, options.filePath + '.backup'); repository.trim(repository.state);
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    return repository;
  }
  private trim(draft: Draft) {
    while (draft.runs.size > (this.options.maxRuns ?? 20)) draft.runs.delete(draft.runs.keys().next().value!);
    while (draft.revisions.size > (this.options.maxRevisions ?? 500)) draft.revisions.delete(draft.revisions.keys().next().value!);
  }
  private async writeState(draft: Draft) {
    if (!this.options.filePath) return;
    const text = JSON.stringify({ schemaVersion: 2, runs: [...draft.runs.values()], strategies: [...draft.strategies.values()], revisions: [...draft.revisions.values()] } satisfies State);
    if (Buffer.byteLength(text) > 50_000_000) throw new StorageError('STORAGE_LIMIT', 'Storage output exceeds budget.', 429);
    const target = this.options.filePath, temporary = target + '.' + randomUUID() + '.tmp';
    try { await mkdir(path.dirname(target), { recursive: true }); await writeFile(temporary, text, { mode: 0o600 }); await rename(temporary, target); }
    catch { await unlink(temporary).catch(() => {}); throw new StorageError('STORAGE_WRITE_FAILED', 'Atomic storage write failed. No in-memory commit was accepted.', 503); }
  }
  private transaction<T>(change: (draft: Draft) => T): Promise<T> {
    const operation = this.operations.then(async () => {
      const draft: Draft = { runs: new Map(this.state.runs), strategies: new Map(this.state.strategies), revisions: new Map(this.state.revisions) };
      const value = change(draft); this.trim(draft); await this.writeState(draft); this.state = draft; return value;
    });
    this.operations = operation.then(() => {}, () => {}); return operation;
  }
  getRun(id: string): BacktestResponse | undefined { const run = this.state.runs.get(id); return run ? clone(run) : undefined; }
  listRuns(): { id: string; name: string; executedAt: string }[] { return [...this.state.runs.values()].map(r => ({ id: r.backtestId, name: r.strategy.name, executedAt: r.executedAt })); }
  putRun(run: BacktestResponse): Promise<void> {
    let validated: BacktestResponse;
    try { validated = parseBacktestResult(run); }
    catch { return Promise.reject(new StorageError('INVALID_RUN', 'Research result does not satisfy the storage contract.', 422)); }
    return this.transaction(draft => { const existing = draft.runs.get(validated.backtestId); if (existing && JSON.stringify(existing) !== JSON.stringify(validated)) throw new StorageError('IMMUTABLE_RUN_CONFLICT', 'Existing runs cannot be rewritten.'); if (!existing) draft.runs.set(validated.backtestId, clone(validated)); });
  }
  listStrategies(): SavedRevision[] { return clone([...this.state.strategies.values()]); }
  getStrategy(id: string, revision?: number): SavedRevision | undefined { const record = revision === undefined ? this.state.strategies.get(id) : this.state.revisions.get(id + '@' + revision); return record ? clone(record) : undefined; }
  saveStrategy(raw: unknown, expectedRevision?: number): Promise<SavedRevision> {
    const parsed = validateStrategy(raw);
    if (!parsed.success || !parsed.data || !parsed.canonicalData) return Promise.reject(new StorageError('INVALID_STRATEGY', parsed.errors?.join('; ') ?? 'Invalid strategy.', 422));
    const ast = parsed.data, canonical = parsed.canonicalData;
    return this.transaction(draft => {
      const id = ast.id ?? randomUUID(), existing = draft.strategies.get(id);
      if (existing && expectedRevision !== existing.revision) throw new StorageError('REVISION_CONFLICT', 'Strategy changed since it was loaded.');
      if (!existing && draft.strategies.size >= (this.options.maxStrategies ?? 100)) throw new StorageError('STORAGE_LIMIT', 'Saved-strategy limit reached.', 429);
      const record: SavedRevision = { id, revision: (existing?.revision ?? 0) + 1, strategy: { ...clone(ast), id }, hash: createHash('sha256').update(canonicalStrategyJSON({ ...canonical, id })).digest('hex'), updatedAt: new Date().toISOString() };
      draft.strategies.set(id, record); draft.revisions.set(id + '@' + record.revision, record); return clone(record);
    });
  }
  deleteStrategy(id: string, expectedRevision: number): Promise<void> {
    return this.transaction(draft => { const record = draft.strategies.get(id); if (!record) throw new StorageError('STRATEGY_NOT_FOUND', 'Strategy not found.', 404); if (record.revision !== expectedRevision) throw new StorageError('REVISION_CONFLICT', 'Strategy revision differs.'); draft.strategies.delete(id); });
  }
  async close() { await this.operations; }
}
