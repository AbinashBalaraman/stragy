import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { approvalFromTool, parseToolOutput, toolSummary, toolTitle, type ToolState } from '../opencode/sessionStore';
import { ApprovalCard } from './ApprovalCard';

type Props = {
  tools: ToolState[];
  sessionId?: string;
  resolvedApprovals?: Record<string, 'approved' | 'rejected'>;
  onApprovalResolved?: (approvalId: string, decision: 'approved' | 'rejected', followUp: string) => void;
};

function detailText(value: unknown): string {
  if (value == null) return '';
  const parsed = parseToolOutput(value);
  if (parsed) {
    try { return JSON.stringify(parsed, null, 2).slice(0, 4000); } catch { /* fall through */ }
  }
  if (typeof value === 'string') return value.slice(0, 4000);
  try { return JSON.stringify(value, null, 2).slice(0, 4000); } catch { return String(value).slice(0, 4000); }
}

function statusChipClass(tool: ToolState): string {
  if (tool.status === 'success') return 'ready';
  if (tool.status === 'failed') return 'failed';
  if (tool.status === 'running' || tool.status === 'called') return 'running';
  return 'queued';
}

function ToolRow({ tool, sessionId, resolvedApprovals, onApprovalResolved }: { tool: ToolState } & Omit<Props, 'tools'>) {
  const [open, setOpen] = useState(false);
  const approval = approvalFromTool(tool);
  const running = tool.status === 'running' || tool.status === 'called' || tool.status === 'pending';
  const input = detailText(tool.input);
  const output = detailText(tool.output);

  return (
    <div className={`tool-card tool-row ${tool.status === 'failed' ? 'failed' : ''}`} data-testid="tool-row">
      <button
        type="button"
        className="tool-row-head"
        aria-expanded={open}
        data-testid="tool-toggle"
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`tool-ico ${running ? 'running' : tool.status === 'failed' ? 'failed' : 'ok'}`} aria-hidden>
          {running ? (
            <svg viewBox="0 0 24 24" fill="none" className="spin"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" strokeDasharray="42" strokeLinecap="round" /></svg>
          ) : tool.status === 'failed' ? (
            <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" /><path d="M12 7.5v5.5M12 16.4v.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none"><path d="m5.5 12.5 4.2 4.2L18.5 8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          )}
        </span>
        <span className="tool-name">{toolTitle(tool)}</span>
        <span className="tool-summary" data-testid="tool-summary">{toolSummary(tool)}</span>
        <span className={`chip ${statusChipClass(tool)} tool-status`} aria-label={tool.status}><span className="cdot" /></span>
        <svg className={`tool-chev ${open ? 'open' : ''}`} viewBox="0 0 24 24" fill="none" aria-hidden><path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <div className="tool-detail" data-testid="tool-detail">
          {input && <pre className="tool-output">{input}</pre>}
          {output && <pre className="tool-output">{output}</pre>}
          {tool.error && <div className="tool-error">{tool.error}</div>}
        </div>
      )}
      {approval && sessionId && (
        <ApprovalCard
          request={approval}
          sessionId={sessionId}
          resolved={resolvedApprovals?.[approval.approvalId]}
          onResolved={onApprovalResolved}
        />
      )}
    </div>
  );
}

/**
 * Tool activity is telemetry, not content: one quiet line per call, collapsed
 * by default, smaller than the messages it serves. Raw payloads stay one
 * click away for inspection.
 */
export function ToolTimeline({ tools, sessionId, resolvedApprovals, onApprovalResolved }: Props) {
  if (!tools.length) return null;
  return (
    <div className="tool-timeline" data-testid="tool-timeline">
      {tools.map((tool) => (
        <ToolRow key={tool.id} tool={tool} sessionId={sessionId} resolvedApprovals={resolvedApprovals} onApprovalResolved={onApprovalResolved} />
      ))}
    </div>
  );
}
