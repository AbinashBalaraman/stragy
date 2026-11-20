import { describe, expect, it } from 'vitest';
import { approvalFromTool, parseToolOutput, toolSummary, type ToolState } from '../../frontend/opencode/sessionStore';

const tool = (patch: Partial<ToolState> = {}): ToolState => ({
  id: 't1', name: 'get_data_cache', status: 'success', ...patch,
});

describe('parseToolOutput', () => {
  it('passes objects through and parses JSON text from OpenCode content parts', () => {
    expect(parseToolOutput({ a: 1 })).toEqual({ a: 1 });
    expect(parseToolOutput('{"status":"queued"}')).toEqual({ status: 'queued' });
  });

  it('rejects non-JSON strings, arrays and nullish values', () => {
    expect(parseToolOutput('plain text')).toBeNull();
    expect(parseToolOutput('[1,2]')).toBeNull();
    expect(parseToolOutput(null)).toBeNull();
    expect(parseToolOutput(undefined)).toBeNull();
  });
});

describe('approvalFromTool', () => {
  const payload = {
    status: 'approval_required',
    approvalId: 'apr_123',
    approval: { id: 'apr_123', tool: 'run_backtest', status: 'pending', title: 'Run backtest: RSI pullback', summary: ['line A'] },
    assumptions: ['Entry: RSI(14) < 30', 'Stop: 5%'],
  };

  it('detects the gate from object output and from JSON text output', () => {
    const fromObject = approvalFromTool(tool({ name: 'run_backtest', output: payload }));
    const fromText = approvalFromTool(tool({ name: 'run_backtest', output: JSON.stringify(payload) }));
    for (const request of [fromObject, fromText]) {
      expect(request).not.toBeNull();
      expect(request?.approvalId).toBe('apr_123');
      expect(request?.title).toBe('Run backtest: RSI pullback');
      expect(request?.summary).toEqual(['Entry: RSI(14) < 30', 'Stop: 5%']);
    }
  });

  it('falls back to approval.summary when assumptions are absent', () => {
    const request = approvalFromTool(tool({ output: { status: 'approval_required', approvalId: 'apr_9', approval: { title: 'T', summary: ['only line'] } } }));
    expect(request?.summary).toEqual(['only line']);
  });

  it('ignores non-approval outputs', () => {
    expect(approvalFromTool(tool({ output: { status: 'queued', jobId: 'job_1' } }))).toBeNull();
    expect(approvalFromTool(tool({ output: 'done' }))).toBeNull();
    expect(approvalFromTool(tool())).toBeNull();
  });
});

describe('toolSummary', () => {
  it('summarizes cache stats (top-level and nested) as one human line', () => {
    expect(toolSummary(tool({ output: { stats: { symbols: 203, lastDate: '2026-11-19' } } }))).toBe('203 symbols · EOD 2026-11-19');
    expect(toolSummary(tool({ output: { symbols: 47, lastDate: '2026-11-18' } }))).toBe('47 symbols · EOD 2026-11-18');
  });

  it('summarizes scan matches with the evaluated universe', () => {
    expect(toolSummary(tool({ name: 'scan_market', output: { matches: [{}, {}], evaluated: 47 } }))).toBe('2 matches of 47');
    expect(toolSummary(tool({ name: 'scan_market', output: { matches: [{}] } }))).toBe('1 match');
  });

  it('names the approval gate and queued jobs', () => {
    expect(toolSummary(tool({ output: { status: 'approval_required', approvalId: 'apr_1' } }))).toBe('awaiting your approval');
    expect(toolSummary(tool({ output: { status: 'queued', jobId: 'job_abcdef123456789' } }))).toBe('job job_abcdef1234 queued');
  });

  it('surfaces typed failures instead of raw JSON', () => {
    expect(toolSummary(tool({ output: { status: 'failed', error: { code: 'X', message: 'Window too short.\nDetails' } } }))).toBe('Window too short.');
    expect(toolSummary(tool({ status: 'failed', error: 'ATR_NOT_READY' }))).toBe('ATR_NOT_READY');
  });

  it('shows working state and a generic fact line for unknown shapes', () => {
    expect(toolSummary(tool({ status: 'running' }))).toBe('working…');
    expect(toolSummary(tool({ output: { kind: 'quotes', count: 3, live: true, nested: { a: 1 } } }))).toContain('kind: quotes');
    expect(toolSummary(tool({ output: { nested: { a: 1 } } }))).toBe('done');
  });
});
