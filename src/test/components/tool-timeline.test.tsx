// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ToolTimeline } from '../../frontend/components/ToolTimeline';
import type { ToolState } from '../../frontend/opencode/sessionStore';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const successTool: ToolState = {
  id: 't1', name: 'get_data_cache', status: 'success',
  input: { scope: 'all' },
  output: { stats: { symbols: 203, lastDate: '2026-11-19' } },
};

const approvalTool: ToolState = {
  id: 't2', name: 'run_backtest', status: 'success',
  output: JSON.stringify({
    status: 'approval_required',
    approvalId: 'apr_123',
    approval: { id: 'apr_123', tool: 'run_backtest', status: 'pending', title: 'Run backtest: RSI pullback', summary: [] },
    assumptions: ['Entry: RSI(14) < 30', 'Stop loss: 5%'],
  }),
};

describe('ToolTimeline (compact telemetry)', () => {
  it('renders one quiet collapsed row per tool — no raw JSON until expanded', () => {
    render(<ToolTimeline tools={[successTool]} />);
    const rows = screen.getAllByTestId('tool-row');
    expect(rows).toHaveLength(1);
    expect(screen.getByTestId('tool-summary').textContent).toBe('203 symbols · EOD 2026-11-19');
    expect(screen.queryByTestId('tool-detail')).toBeNull();
    // e2e contract: success rows keep the .tool-card .chip.ready selectors.
    expect(rows[0].classList.contains('tool-card')).toBe(true);
    expect(rows[0].querySelector('.chip.ready')).not.toBeNull();
  });

  it('expands and collapses details on click', () => {
    render(<ToolTimeline tools={[successTool]} />);
    fireEvent.click(screen.getByTestId('tool-toggle'));
    expect(screen.getByTestId('tool-detail').textContent).toContain('203');
    fireEvent.click(screen.getByTestId('tool-toggle'));
    expect(screen.queryByTestId('tool-detail')).toBeNull();
  });

  it('offers an inline approval card for gated backtests', () => {
    render(<ToolTimeline tools={[approvalTool]} sessionId="ses_1" />);
    const card = screen.getByTestId('approval-card');
    expect(card.textContent).toContain('Run backtest: RSI pullback');
    expect(card.textContent).toContain('Entry: RSI(14) < 30');
    expect(screen.getByTestId('approval-approve')).toBeTruthy();
    expect(screen.getByTestId('approval-decline')).toBeTruthy();
  });

  it('approve posts the decision and hands the agent a follow-up turn', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const onResolved = vi.fn();
    render(<ToolTimeline tools={[approvalTool]} sessionId="ses_1" onApprovalResolved={onResolved} />);
    fireEvent.click(screen.getByTestId('approval-approve'));
    await waitFor(() => expect(onResolved).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v2/engine/approvals');
    expect(JSON.parse(String(init.body))).toEqual({ sessionId: 'ses_1', approvalId: 'apr_123', decision: 'approve' });
    const [approvalId, decision, followUp] = onResolved.mock.calls[0];
    expect(approvalId).toBe('apr_123');
    expect(decision).toBe('approved');
    expect(followUp).toContain('apr_123');
    expect(screen.getByTestId('approval-status').textContent).toContain('Approved');
  });

  it('a resolved approval renders its outcome, not live buttons', () => {
    render(<ToolTimeline tools={[approvalTool]} sessionId="ses_1" resolvedApprovals={{ apr_123: 'rejected' }} />);
    expect(screen.queryByTestId('approval-approve')).toBeNull();
    expect(screen.getByTestId('approval-status').textContent).toContain('Declined');
  });

  it('failed tools read as failed with the error line', () => {
    const failed: ToolState = { id: 't3', name: 'scan_market', status: 'failed', error: 'DATA_UNAVAILABLE' };
    render(<ToolTimeline tools={[failed]} />);
    expect(screen.getByTestId('tool-row').classList.contains('failed')).toBe(true);
    expect(screen.getByTestId('tool-summary').textContent).toBe('DATA_UNAVAILABLE');
  });
});
