/**
 * One-time approval tokens for state-changing engine tools.
 *
 * The engine model cannot approve its own work. Only the UI route
 * POST /api/v2/engine/approvals can mint a token, and the token is bound to a
 * canonical hash of the exact reviewed assumptions. run_backtest consumes it
 * once; a changed assumption needs a fresh review.
 */
import { createHash, randomUUID } from 'node:crypto';

export type ApprovalDecision = 'approve' | 'reject';

export interface ApprovalAssumptions {
  /** Canonical, validated strategy content (already JSON-canonicalised). */
  strategy: string;
  asOf?: string;
  start?: string;
  end?: string;
  initialCapital?: number;
}

export interface ApprovalRecord {
  id: string;
  sessionId: string;
  tool: string;
  title: string;
  summary: string[];
  assumptions: ApprovalAssumptions;
  payloadHash: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: number;
  decidedAt?: number;
  note?: string;
}

export interface ApprovalToken {
  token: string;
  approvalId: string;
  sessionId: string;
  tool: string;
  payloadHash: string;
  issuedAt: number;
  expiresAt: number;
}

export interface ApprovalView {
  id: string;
  sessionId: string;
  tool: string;
  status: 'pending' | 'approved' | 'rejected';
  title: string;
  summary: string[];
  createdAt: string;
  decidedAt?: string;
  note?: string;
}

export class ApprovalError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); this.name = 'ApprovalError'; }
}

export const APPROVAL_TTL_MS = 10 * 60_000;
const MAX_PENDING = 200;
const MAX_TOKENS = 200;

/** Stable JSON (sorted object keys) for hashing assumptions. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return '{' + Object.keys(record).sort().filter(key => record[key] !== undefined).map(key => JSON.stringify(key) + ':' + canonicalJson(record[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

/** Hash of the reviewed assumptions; undefined fields are ignored consistently. */
export function assumptionsHash(assumptions: ApprovalAssumptions): string {
  return createHash('sha256').update(canonicalJson({
    strategy: assumptions.strategy,
    asOf: assumptions.asOf ?? null,
    start: assumptions.start ?? null,
    end: assumptions.end ?? null,
    initialCapital: assumptions.initialCapital ?? null,
  })).digest('hex');
}

function view(record: ApprovalRecord): ApprovalView {
  return {
    id: record.id,
    sessionId: record.sessionId,
    tool: record.tool,
    status: record.status,
    title: record.title,
    summary: [...record.summary],
    createdAt: new Date(record.createdAt).toISOString(),
    ...(record.decidedAt ? { decidedAt: new Date(record.decidedAt).toISOString() } : {}),
    ...(record.note ? { note: record.note } : {}),
  };
}

export class ApprovalStore {
  private records = new Map<string, ApprovalRecord>();
  private tokens = new Map<string, ApprovalToken>();
  private now: () => number;

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? (() => Date.now());
  }

  /** Reuse an identical pending gate so retries don't pile up cards. */
  createPending(input: {
    sessionId: string; tool: string; title: string; summary: string[];
    assumptions: ApprovalAssumptions;
  }): ApprovalView {
    this.prune();
    const payloadHash = assumptionsHash(input.assumptions);
    for (const record of this.records.values()) {
      if (record.status === 'pending' && record.sessionId === input.sessionId && record.tool === input.tool && record.payloadHash === payloadHash) {
        return view(record);
      }
    }
    const record: ApprovalRecord = {
      id: 'apr_' + randomUUID().replace(/-/g, '').slice(0, 18),
      sessionId: input.sessionId,
      tool: input.tool,
      title: input.title.slice(0, 300),
      summary: input.summary.slice(0, 20).map(line => line.slice(0, 500)),
      assumptions: input.assumptions,
      payloadHash,
      status: 'pending',
      createdAt: this.now(),
    };
    this.records.set(record.id, record);
    while (this.records.size > MAX_PENDING) {
      const oldest = [...this.records.values()].filter(item => item.status !== 'pending').sort((a, b) => a.createdAt - b.createdAt)[0]
        ?? [...this.records.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
      if (!oldest) break;
      this.records.delete(oldest.id);
    }
    return view(record);
  }

  get(id: string): ApprovalView | undefined {
    const record = this.records.get(id);
    return record ? view(record) : undefined;
  }

  /** Approve/reject a pending gate. Approval mints the token bound to its hash. */
  decide(id: string, decision: ApprovalDecision, note?: string): { approval: ApprovalView; token?: ApprovalToken } {
    const record = this.records.get(id);
    if (!record) throw new ApprovalError(404, 'APPROVAL_NOT_FOUND', 'This approval request no longer exists. Ask the assistant to prepare it again.');
    if (record.status !== 'pending') throw new ApprovalError(409, 'APPROVAL_ALREADY_DECIDED', 'This approval was already decided.');
    record.status = decision === 'approve' ? 'approved' : 'rejected';
    record.decidedAt = this.now();
    if (note) record.note = note.slice(0, 1000);
    if (decision === 'reject') return { approval: view(record) };
    return { approval: view(record), token: this.mint(record.id, record.sessionId, record.tool, record.payloadHash) };
  }

  /**
   * A direct operator approval of reviewed assumptions (the UI can post the
   * strategy it reviewed instead of a gate id). The token is still one-time.
   */
  approveAssumptions(input: { sessionId: string; tool?: string; assumptions: ApprovalAssumptions; title?: string; summary?: string[]; note?: string }): { approval: ApprovalView; token: ApprovalToken } {
    this.prune();
    const payloadHash = assumptionsHash(input.assumptions);
    const record: ApprovalRecord = {
      id: 'apr_' + randomUUID().replace(/-/g, '').slice(0, 18),
      sessionId: input.sessionId,
      tool: input.tool ?? 'run_backtest',
      title: (input.title ?? 'Operator-approved backtest assumptions').slice(0, 300),
      summary: (input.summary ?? []).slice(0, 20).map(line => line.slice(0, 500)),
      assumptions: input.assumptions,
      payloadHash,
      status: 'approved',
      createdAt: this.now(),
      decidedAt: this.now(),
      ...(input.note ? { note: input.note.slice(0, 1000) } : {}),
    };
    this.records.set(record.id, record);
    return { approval: view(record), token: this.mint(record.id, record.sessionId, record.tool, payloadHash) };
  }

  private mint(approvalId: string, sessionId: string, tool: string, payloadHash: string): ApprovalToken {
    this.prune();
    const issuedAt = this.now();
    const token: ApprovalToken = {
      token: 'apt_' + randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '').slice(0, 8),
      approvalId,
      sessionId,
      tool,
      payloadHash,
      issuedAt,
      expiresAt: issuedAt + APPROVAL_TTL_MS,
    };
    this.tokens.set(token.token, token);
    while (this.tokens.size > MAX_TOKENS) {
      const oldest = [...this.tokens.values()].sort((a, b) => a.issuedAt - b.issuedAt)[0];
      if (!oldest) break;
      this.tokens.delete(oldest.token);
    }
    return token;
  }

  /**
   * Consume a token for exactly these assumptions. Returns false for expired,
   * used, unknown, or hash-mismatched tokens; a mismatch never consumes the
   * token, so the operator's approval is not silently burned by a stray call.
   */
  consume(token: string, payloadHash: string): boolean {
    this.prune();
    const record = this.tokens.get(token);
    if (!record) return false;
    if (record.expiresAt <= this.now()) { this.tokens.delete(token); return false; }
    if (record.payloadHash !== payloadHash) return false;
    this.tokens.delete(token);
    return true;
  }

  /**
   * Consume the newest unused token for this session that matches the hash.
   * This is how an approved UI gate reaches the model: the model calls
   * run_backtest again with the reviewed assumptions and no token field.
   */
  consumeForSession(sessionId: string, payloadHash: string): boolean {
    this.prune();
    const candidates = [...this.tokens.values()]
      .filter(item => item.sessionId === sessionId && item.payloadHash === payloadHash && item.expiresAt > this.now())
      .sort((a, b) => b.issuedAt - a.issuedAt);
    const match = candidates[0];
    if (!match) return false;
    this.tokens.delete(match.token);
    return true;
  }

  /** Test/introspection seam. Never returns token material. */
  pendingForSession(sessionId: string): ApprovalView[] {
    return [...this.records.values()].filter(record => record.sessionId === sessionId && record.status === 'pending').map(view);
  }

  private prune(): void {
    const at = this.now();
    for (const [key, value] of this.tokens) if (value.expiresAt <= at) this.tokens.delete(key);
    // Pending gates are useful for a conversation but should not live forever.
    const cutoff = at - 6 * 60 * 60_000;
    for (const [key, value] of this.records) if (value.status !== 'pending' && value.createdAt < cutoff) this.records.delete(key);
  }
}

/** One process-wide store; tokens are not durable across a restart by design. */
export const engineApprovals = new ApprovalStore();
