// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDerivativeRequest } from '../../components/scanner/useDerivativeRequest';
import { GttBracketCalculator } from '../../components/scanner/GttBracketCalculator';
import { calculateGttBracketOrder } from '../../server/data/smartApi';
const parse = (v: unknown) => { if (typeof v !== 'string') throw new Error('invalid'); return v; };
const response = (value: unknown) => ({ ok: true, json: async () => value }) as Response;
const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
afterEach(async () => {
  cleanup();
  if (vi.isFakeTimers()) {
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    vi.clearAllTimers();
    vi.useRealTimers();
  }
});
describe('derivative hook ownership', () => {
  it('clears old success immediately on change and ignores late old response', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); let finish!: (r: Response) => void;
    const mock = vi.fn().mockResolvedValueOnce(response('a')).mockImplementationOnce(() => new Promise<Response>(r => { finish = r; })).mockResolvedValueOnce(response('c'));
    vi.stubGlobal('fetch', mock);
    const { result, rerender } = renderHook(({ key }) => useDerivativeRequest(key, '/demo/' + key, parse), { initialProps: { key: 'a' } });
    await flush(); expect(result.current.data).toBe('a');
    rerender({ key: 'b' }); expect(result.current.data).toBeNull(); await flush();
    rerender({ key: 'c' }); await flush(); expect(result.current.data).toBe('c');
    expect(mock.mock.calls[1][1].signal.aborted).toBe(true);
    await act(async () => { finish(response('late b')); });
    expect(result.current.data).toBe('c');
  });
  it('removes successful data on refresh failure and cleanup aborts', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); const mock = vi.fn().mockResolvedValueOnce(response('a')).mockResolvedValueOnce({ ok: false, status: 503 }); vi.stubGlobal('fetch', mock);
    const { result, unmount } = renderHook(() => useDerivativeRequest('a', '/demo', parse));
    await flush(); expect(result.current.data).toBe('a');
    act(() => result.current.refresh()); expect(result.current.data).toBeNull();
    await flush(); expect(result.current.error).toContain('503'); expect(result.current.isLoading).toBe(false);
    unmount(); expect(mock.mock.calls[1][1].signal.aborted).toBe(true);
  });
  it('debounces input changes and never sends invalid inputs', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); const mock = vi.fn().mockResolvedValue(response('ok')); vi.stubGlobal('fetch', mock);
    const { rerender } = renderHook(({ key, valid }) => useDerivativeRequest(key, '/preview', parse, { post: true, delay: 300, valid }), { initialProps: { key: 'a', valid: true } });
    await flush(200); rerender({ key: 'b', valid: true }); await flush(299); expect(mock).not.toHaveBeenCalled(); await flush(1); expect(mock).toHaveBeenCalledTimes(1);
    rerender({ key: 'bad', valid: false }); await flush(500); expect(mock).toHaveBeenCalledTimes(1);
  });
});
describe('GTT preview clipboard', () => {
  it('awaits clipboard, includes warnings, clears success on change and shows clipboard failure', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => { const i = JSON.parse(options.body); return response({ success: true, mode: 'demo', ...calculateGttBracketOrder(i.symbolId, i.action, i.capitalAllocated, i.riskPct, i.rewardRatio, i.trailPct) }); }));
    let finish!: () => void;
    const writeText = vi.fn().mockImplementationOnce(() => new Promise<void>(r => { finish = r; })).mockRejectedValueOnce(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<GttBracketCalculator onSelectStockAndBacktest={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Copy preview with warnings' })).toBeNull();
    await flush(300); fireEvent.click(screen.getByRole('button', { name: 'Copy preview with warnings' }));
    expect(screen.queryByText('Copied!')).toBeNull();
    expect(JSON.parse(writeText.mock.calls[0][0]).previewOnly).toBe(true);
    await act(async () => { finish(); }); expect(screen.getByText('Copied!')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Capital Allocated (₹)'), { target: { value: '120000' } });
    expect(screen.queryByText('Copied!')).toBeNull(); expect(screen.queryByRole('button', { name: 'Copy preview with warnings' })).toBeNull();
    await flush(300); fireEvent.click(screen.getByRole('button', { name: 'Copy preview with warnings' })); await flush();
    expect(screen.getByRole('alert').textContent).toContain('Clipboard copy failed');
  });
});
