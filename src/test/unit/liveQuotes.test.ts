// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LIVE_QUOTE_POLL_MS,
  fetchLiveQuotes,
  normalizeQuoteSymbolIds,
  useLiveQuotes,
} from '../../client/liveQuotes';

const quote = (symbolId: number, ltp = 100 + symbolId, changePercent = 0.5) => ({
  symbolId,
  ticker: 'SYM' + symbolId,
  ltp,
  open: ltp,
  high: ltp,
  low: ltp,
  close: ltp,
  changePercent,
  exchangeTimestamp: '2026-11-16T09:10:55Z',
  fetchedAt: '2026-11-16T09:10:53.755Z',
  source: 'ANGEL_SMARTAPI' as const,
  delay: 'live' as const,
});
const idsFrom = (url: string) => {
  const query = new URL(String(url), 'http://local').searchParams.get('symbolIds') ?? '';
  return query.split(',').filter(Boolean).map(Number);
};
const responseFor = (ids: number[]) => ({
  success: true,
  source: 'ANGEL_SMARTAPI',
  available: true,
  delay: 'live',
  fetchedAt: '2026-11-16T09:10:53.755Z',
  cached: false,
  configured: true,
  quotes: ids.map((id, index) => quote(id, 1000 + id, index === 0 ? 0.4 : -0.25)),
  unavailable: [],
  labels: [],
});
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () => responseFor(idsFrom(url)) }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});

describe('live quote client', () => {
  it('deduplicates and bounds ids to ten', () => {
    expect(normalizeQuoteSymbolIds([1, 1, 2, -1, 1.5, 3, 4, 5, 6, 7, 8, 9, 10, 11])).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('parses a connected Angel response', async () => {
    const result = await fetchLiveQuotes([1, 9]);
    expect(fetchMock).toHaveBeenCalledWith('/api/v2/quotes?symbolIds=1,9', expect.objectContaining({ headers: { Accept: 'application/json' } }));
    expect(result).toMatchObject({ configured: true, available: true, connected: true, source: 'ANGEL_SMARTAPI' });
    expect(result.quotes.map(item => item.symbolId)).toEqual([1, 9]);
  });

  it('returns unavailable states without throwing', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) });
    const failed = await fetchLiveQuotes([1]);
    expect(failed).toMatchObject({ connected: false, configured: false });
    expect(failed.reason).toContain('503');

    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ source: 'ANGEL_SMARTAPI', available: false, delay: 'unknown', fetchedAt: '2026-11-16T09:10:53.755Z', configured: false, quotes: [], reason: { code: 'PROVIDER_UNAVAILABLE', message: 'Live quotes are not configured' } }),
    });
    expect(await fetchLiveQuotes([1])).toMatchObject({ connected: false, configured: false, reason: 'Live quotes are not configured' });

    fetchMock.mockRejectedValueOnce(new Error('network down'));
    expect((await fetchLiveQuotes([1])).reason).toBe('network down');

    fetchMock.mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'));
    const controller = new AbortController();
    controller.abort();
    expect((await fetchLiveQuotes([1], controller.signal)).reason).toContain('cancelled');
  });

  it('polls every 15 seconds only while the tab is visible', async () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useLiveQuotes([1, 9]));
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.connected).toBe(true);

    await act(async () => { await vi.advanceTimersByTimeAsync(LIVE_QUOTE_POLL_MS); });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(LIVE_QUOTE_POLL_MS); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.loading).toBe(false);

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(3);
    unmount();
  });
});
