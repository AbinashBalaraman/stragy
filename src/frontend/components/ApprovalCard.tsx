import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import type { ApprovalRequest } from '../opencode/sessionStore';

type Props = {
  request: ApprovalRequest;
  sessionId: string;
  resolved?: 'approved' | 'rejected';
  onResolved?: (approvalId: string, decision: 'approved' | 'rejected', followUp: string) => void;
};

/**
 * The operator gate, inline in the transcript. A gated run_backtest used to
 * dead-end here ("POST to /api/v2/engine/approvals yourself"); the card makes
 * the exact assumptions reviewable and approval one click, then hands the
 * agent a follow-up so the run starts without retyping anything.
 */
export function ApprovalCard({ request, sessionId, resolved, onResolved }: Props) {
  const [phase, setPhase] = useState<'idle' | 'sending' | 'approved' | 'rejected' | 'error'>(resolved ?? 'idle');
  const [error, setError] = useState('');

  const decide = async (decision: 'approve' | 'reject') => {
    setPhase('sending');
    setError('');
    try {
      const res = await fetch('/api/v2/engine/approvals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, approvalId: request.approvalId, decision }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!res.ok) throw new Error(body?.error?.message || `Approval failed (${res.status})`);
      const next = decision === 'approve' ? 'approved' : 'rejected';
      setPhase(next);
      onResolved?.(
        request.approvalId,
        next,
        decision === 'approve'
          ? `The operator approved ${request.approvalId} in the UI. Call run_backtest again now with the identical strategy and options, then report the result.`
          : '',
      );
    } catch (e) {
      setPhase('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const done = phase === 'approved' || phase === 'rejected';

  return (
    <div className="approval-card" data-testid="approval-card">
      <div className="approval-head">
        <ShieldCheck size={15} />
        <span>{request.title}</span>
      </div>
      {request.summary.length > 0 && (
        <ul className="approval-lines">
          {request.summary.map((line, i) => <li key={i}>{line}</li>)}
        </ul>
      )}
      {phase === 'error' && <div className="approval-error" data-testid="approval-error">{error}</div>}
      {done ? (
        <div className={`approval-status ${phase}`} data-testid="approval-status">
          {phase === 'approved' ? 'Approved — the run is starting.' : 'Declined. Nothing was run.'}
        </div>
      ) : (
        <div className="approval-actions">
          <button
            type="button"
            className="approval-approve"
            data-testid="approval-approve"
            disabled={phase === 'sending'}
            onClick={() => void decide('approve')}
          >{phase === 'sending' ? 'Sending…' : 'Approve & run'}</button>
          <button
            type="button"
            className="approval-decline"
            data-testid="approval-decline"
            disabled={phase === 'sending'}
            onClick={() => void decide('reject')}
          >Decline</button>
        </div>
      )}
    </div>
  );
}
