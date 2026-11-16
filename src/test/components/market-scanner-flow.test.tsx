// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarketScannerView } from '../../components/scanner/MarketScannerView';
import type { StrategyAST } from '../../shared/strategy/types';
import { requestMarketSnapshot, requestScan } from '../../client/api';

vi.mock('../../client/api', () => ({ requestMarketSnapshot: vi.fn(), requestScan: vi.fn() }));
const market = vi.mocked(requestMarketSnapshot);
const scan = vi.mocked(requestScan);
const strategy = { name: 'Test rules' } as unknown as StrategyAST;
const snapshot = () => ({ trends: [], errors: [], coverage: { requested: 84, succeeded: 84, unavailable: 0 }, provenance: [{ mode: 'demo', source: 'fixture', actualRange: { start: '2025-01-01', end: '2025-01-02' } }], mode: 'demo' }) as unknown as Awaited<ReturnType<typeof requestMarketSnapshot>>;
const scanResult = (overrides: Record<string, unknown> = {}) => ({ universe: 'NIFTY_50', scanned: 84, matched: 0, requested: 84, attempted: 84, succeeded: 84, unavailable: 0, failed: 0, scannedAt: '2025-01-02', dataSource: 'DETERMINISTIC_DEMO_V1', sourceCoverage: { demo: 84 }, warnings: ['Current membership unverified'], errors: [], matches: [], offset: 0, limit: 35, ...overrides }) as unknown as Awaited<ReturnType<typeof requestScan>>;
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const renderScanner = () => render(<MarketScannerView strategy={strategy} onSelectStockAndBacktest={vi.fn()} />);
const openMatches = () => fireEvent.click(screen.getByRole('button', { name: /Strategy matches/i }));
const universe = () => screen.getAllByRole('combobox')[0];

beforeEach(() => {
  vi.resetAllMocks();
  market.mockResolvedValue(snapshot());
  scan.mockResolvedValue(scanResult());
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ success: true, dates: [] }) })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('bounded lazy market scanner flow', () => {
  it('labels real market prices without calling them demo and retains model-only derivatives disclosure', async () => {
    market.mockResolvedValueOnce({ ...snapshot(), mode: 'real', provenance: { mode: 'real', actualRange: { end: '2025-01-02' } }, sourceCoverage: { real: 84 } } as unknown as Awaited<ReturnType<typeof requestMarketSnapshot>>);
    renderScanner();
    await screen.findByText('Session: 2025-01-02');
    expect(screen.getByText(/Observed OHLCV · not a live tick feed/)).toBeTruthy();
    expect(screen.queryByText(/Demo OHLCV/)).toBeNull();
    expect(screen.getByText(/Derivatives\/OI\/PCR and related model fields are model-only/)).toBeTruthy();
    expect(screen.getByText(/Universe membership is unverified unless explicitly reported/)).toBeTruthy();
  });

  it('uses scan source coverage even with no matches, and does not inherit market demo labels', async () => {
    scan.mockResolvedValueOnce(scanResult({ mode: 'real', dataSource: 'YAHOO_PUBLIC_CHART', sourceCoverage: { YAHOO_PUBLIC_CHART: 84 } }));
    renderScanner();
    await screen.findByText(/Demo OHLCV/);
    openMatches();
    await screen.findByText(/No matches in the 84 evaluated symbols/);
    expect(screen.getByText(/Observed OHLCV · not a live tick feed/)).toBeTruthy();
    expect(screen.queryByText(/Demo OHLCV/)).toBeNull();
  });

  it('labels mixed scan provenance honestly and preserves optional source compatibility', async () => {
    scan.mockResolvedValueOnce(scanResult({ dataSource: 'OHLCV_ANALYSIS', sourceCoverage: { real: 80, demo: 4 } }));
    renderScanner(); openMatches();
    expect(await screen.findByText(/Mixed observed and demo OHLCV/)).toBeTruthy();
    scan.mockResolvedValueOnce(scanResult({ dataSource: 'OHLCV_ANALYSIS', sourceCoverage: {} }));
    fireEvent.click(screen.getByRole('button', { name: 'Reload snapshot' }));
    expect(await screen.findByText(/Price source not reported; observed coverage unverified/)).toBeTruthy();
  });

  it('summarizes partial pricing failures without dumping provider JSON', async () => {
    market.mockResolvedValueOnce({ ...snapshot(), errors: [{ symbolId: 18, code: 'PROVIDER_RATE_LIMITED' }] } as unknown as Awaited<ReturnType<typeof requestMarketSnapshot>>);
    renderScanner();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('1 symbol could not be priced for this context');
    expect(alert.textContent).not.toContain('symbolId');
    expect(alert.textContent).not.toContain('PROVIDER_RATE_LIMITED');
  });

  it('never turns unavailable market data into no gainers, no losers, or zero breadth', async () => {
    market.mockResolvedValueOnce({ ...snapshot(), mode: 'real', trends: [], provenance: undefined, coverage: { requested: 84, succeeded: 0, unavailable: 84 }, sourceCoverage: {}, movers: { asOfDate: '2025-01-02', formattedDate: '2025-01-02', totalFilteredCount: 0, topGainers: [], topLosers: [], volumeShockers: [], nearFiftyTwoWeekHigh: [], nearFiftyTwoWeekLow: [], derivativesBuildup: { longBuildup: [], shortCovering: [], shortBuildup: [], longUnwinding: [] }, sectorHeatmap: [], marketBreadth: { advances: 0, declines: 0, unchanged: 0, advanceDeclineRatio: 0, bullishPercent: 0 } } } as unknown as Awaited<ReturnType<typeof requestMarketSnapshot>>);
    const onBacktest = vi.fn();
    render(<MarketScannerView strategy={strategy} onSelectStockAndBacktest={onBacktest} />);
    expect(await screen.findByText(/Price data unavailable: no evaluated coverage/)).toBeTruthy();
    expect(screen.getByText('Gainers unavailable: no evaluated price coverage.')).toBeTruthy();
    expect(screen.getByText('Losers unavailable: no evaluated price coverage.')).toBeTruthy();
    expect(screen.queryByText(/No gainers|No losers|0% Bullish/)).toBeNull();
    expect(screen.getAllByText('Session: Cutoff unavailable').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /Technical Regimes/ }));
    expect(screen.getByText('Trends unavailable: no evaluated price coverage.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Load.*Backtest/ })).toBeNull();
    expect(onBacktest).not.toHaveBeenCalled();
  });

  it('passes actual matched-row dates to backtests, bounded by the requested cutoff', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url) === '/api/market/dates') return { ok: true, status: 200, json: async () => ({ success: true, dates: [{ date: '2025-01-01', label: '2025-01-01', isLatest: false }] }) };
      return { ok: true, status: 200, json: async () => ({ success: true }) };
    }));
    const match = (lastDate: string) => ({ symbolId: 7, ticker: 'TEST', name: 'Test equity', sector: 'IT', lastDate, lastClose: 100, changePercent: 1, matchedRules: [], indicatorValues: {}, provenance: { mode: 'real', actualRange: { end: lastDate } } });
    scan.mockResolvedValueOnce(scanResult({ matched: 1, matches: [match('2025-01-02')], sourceCoverage: { real: 84 }, dataSource: 'OHLCV_ANALYSIS' }))
      .mockResolvedValueOnce(scanResult({ matched: 1, matches: [match('2025-01-10')], sourceCoverage: { real: 84 }, dataSource: 'OHLCV_ANALYSIS' }));
    const onBacktest = vi.fn();
    render(<MarketScannerView strategy={strategy} onSelectStockAndBacktest={onBacktest} />);
    openMatches();
    fireEvent.click(await screen.findByRole('button', { name: 'Load & Run Backtest on TEST' }));
    expect(onBacktest).toHaveBeenLastCalledWith(7, '2025-01-02');
    await screen.findByRole('option', { name: '2025-01-01' });
    fireEvent.change(screen.getByLabelText('Trading session'), { target: { value: '2025-01-01' } });
    await waitFor(() => expect(scan).toHaveBeenCalledTimes(2));
    fireEvent.click(await screen.findByRole('button', { name: 'Load & Run Backtest on TEST' }));
    expect(onBacktest).toHaveBeenLastCalledWith(7, '2025-01-01');
  });

  it('shows one loading skeleton instead of false unavailable copy before market data arrives', async () => {
    const pending = deferred<Awaited<ReturnType<typeof requestMarketSnapshot>>>();
    market.mockReturnValueOnce(pending.promise);
    renderScanner();
    expect(await screen.findByText(/Loading market snapshot/)).toBeTruthy();
    expect(screen.queryByText(/Price source not yet reported/)).toBeNull();
    expect(screen.queryByText(/Gainers unavailable/)).toBeNull();
    await act(async () => { pending.resolve(snapshot()); });
    expect(await screen.findByRole('heading', { name: /^Top Gainers —/ })).toBeTruthy();
  });

  it('defaults to the bounded labelled pool, loads only market and never refetches for an observed cutoff', async () => {
    renderScanner();
    await waitFor(() => expect(screen.getByText('Session: 2025-01-02')).toBeTruthy());
    expect((universe() as HTMLSelectElement).value).toBe('NIFTY_50');
    expect(market).toHaveBeenCalledTimes(1);
    expect(market.mock.calls[0][0]).toEqual({ universe: 'NIFTY_50', asOf: undefined });
    expect(scan).not.toHaveBeenCalled();
    expect(screen.getByText(/current NIFTY 50 membership and count are unverified/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Technical Regimes/ }));
    expect(market).toHaveBeenCalledTimes(1);
    expect(scan).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Reload snapshot' }));
    await waitFor(() => expect(market).toHaveBeenCalledTimes(2));
    expect(vi.mocked(fetch).mock.calls.map(call => call[0])).toEqual(['/api/market/dates']);
  });

  it('loads scan only on Strategy Matches and cancels replaced market and scan work', async () => {
    const pendingMarket = deferred<Awaited<ReturnType<typeof requestMarketSnapshot>>>();
    const pendingScan = deferred<Awaited<ReturnType<typeof requestScan>>>();
    market.mockReturnValueOnce(pendingMarket.promise);
    scan.mockReturnValueOnce(pendingScan.promise);
    const { unmount } = renderScanner();
    expect(scan).not.toHaveBeenCalled();
    openMatches();
    expect(market.mock.calls[0][1]?.aborted).toBe(true);
    expect(scan).toHaveBeenCalledTimes(1);
    expect(market).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /Strategy matches/i })).toBeTruthy();
    expect(screen.queryByText(/No matches/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Gainers.*Losers/ }));
    expect(scan.mock.calls[0][1]?.aborted).toBe(true);
    expect(market).toHaveBeenCalledTimes(2);
    await act(async () => { pendingScan.resolve(scanResult()); pendingMarket.resolve(snapshot()); });
    expect(screen.getByRole('button', { name: /Strategy matches/i })).toBeTruthy();
    unmount();
    expect(market.mock.calls[1][1]?.aborted).toBe(true);
  });

  it('preserves pending jobs when the already-selected universe or date is selected again', async () => {
    const pendingMarket = deferred<Awaited<ReturnType<typeof requestMarketSnapshot>>>();
    const pendingScan = deferred<Awaited<ReturnType<typeof requestScan>>>();
    market.mockReturnValueOnce(pendingMarket.promise);
    scan.mockReturnValueOnce(pendingScan.promise);
    renderScanner();
    fireEvent.change(universe(), { target: { value: 'NIFTY_50' } });
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: '' } });
    expect(market).toHaveBeenCalledTimes(1);
    expect(market.mock.calls[0][1]?.aborted).toBe(false);
    await act(async () => { pendingMarket.resolve(snapshot()); });
    expect(screen.getByText('Session: 2025-01-02')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload snapshot' })).toBeTruthy();
    openMatches();
    fireEvent.change(universe(), { target: { value: 'NIFTY_50' } });
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: '' } });
    expect(scan).toHaveBeenCalledTimes(1);
    expect(scan.mock.calls[0][1]?.aborted).toBe(false);
    expect(screen.getByRole('button', { name: /Strategy matches/i })).toBeTruthy();
    await act(async () => { pendingScan.resolve(scanResult()); });
    expect(screen.getByText(/No matches in the 84 evaluated symbols/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload snapshot' })).toBeTruthy();
  });

  it('never presents failed HTTP 504 jobs as no matches and clears stale success on retry', async () => {
    renderScanner(); openMatches();
    await screen.findByText(/No matches in the 84 evaluated symbols/);
    const retry = deferred<Awaited<ReturnType<typeof requestScan>>>();
    scan.mockReturnValueOnce(retry.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Reload snapshot' }));
    expect(screen.queryByText(/No matches/)).toBeNull();
    expect(screen.getByRole('button', { name: /Strategy matches/i })).toBeTruthy();
    await act(async () => { retry.reject(new Error('HTTP 504: scan job failed')); });
    expect(screen.getByRole('alert').textContent).toContain('504');
    expect(screen.queryByText(/No matches/)).toBeNull();
    expect(screen.queryByText(/No stocks currently trigger/)).toBeNull();
    expect(screen.getByRole('button', { name: /Strategy matches/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry strategy scan' }));
    await screen.findByText(/No matches in the 84 evaluated symbols/);
    expect(scan).toHaveBeenCalledTimes(3);
    expect(market).toHaveBeenCalledTimes(1);
  });

  it('reports genuine successful zero matches only for the evaluated subset with partial counts', async () => {
    scan.mockResolvedValueOnce(scanResult({ scanned: 10, succeeded: 10, unavailable: 70, failed: 4 }));
    renderScanner(); openMatches();
    expect(await screen.findByText('No matches in the 10 evaluated symbols. This does not establish no matches across the full universe.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Strategy matches/i })).toBeTruthy();
    expect(screen.getByText(/Coverage: 10 of 84 symbols/)).toBeTruthy();
    expect(screen.getByText(/10 of 84 evaluated; 70 unavailable; 4 failed/)).toBeTruthy();
    expect(screen.getByText(/Demo OHLCV · not observed market prices/)).toBeTruthy();
  });

  it('does not call unavailable or missing evaluated coverage zero matches', async () => {
    scan.mockResolvedValueOnce(scanResult({ scanned: 0, succeeded: 0, unavailable: 84 }));
    renderScanner(); openMatches();
    await screen.findByText('Strategy results unavailable: no evaluated coverage was reported.');
    expect(screen.queryByText(/No matches/)).toBeNull();
    expect(screen.getByRole('button', { name: /Strategy matches/i })).toBeTruthy();
  });

  it('ignores late scan completion and errors from replaced universe contexts', async () => {
    const first = deferred<Awaited<ReturnType<typeof requestScan>>>();
    const second = deferred<Awaited<ReturnType<typeof requestScan>>>();
    scan.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockResolvedValueOnce(scanResult({ universe: 'BSE', scanned: 3, succeeded: 3 }));
    renderScanner(); openMatches();
    fireEvent.change(universe(), { target: { value: 'NSE' } });
    fireEvent.change(universe(), { target: { value: 'BSE' } });
    await screen.findByText(/No matches in the 3 evaluated symbols/);
    expect(scan.mock.calls[0][1]?.aborted).toBe(true);
    expect(scan.mock.calls[1][1]?.aborted).toBe(true);
    await act(async () => { first.resolve(scanResult({ succeeded: 84 })); second.reject(new Error('old HTTP 504')); });
    expect(screen.getByText(/No matches in the 3 evaluated symbols/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(scan.mock.calls.map(call => call[0].universe)).toEqual(['NIFTY_50', 'NSE', 'BSE']);
    expect(market).toHaveBeenCalledTimes(1);
  });

  it('isolates market failures from scans and ignores old market completions after context changes', async () => {
    const old = deferred<Awaited<ReturnType<typeof requestMarketSnapshot>>>();
    market.mockReturnValueOnce(old.promise).mockRejectedValueOnce(new Error('HTTP 504 market job'));
    renderScanner();
    fireEvent.change(universe(), { target: { value: 'NSE' } });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('504'));
    expect(market.mock.calls[0][1]?.aborted).toBe(true);
    await act(async () => { old.resolve(snapshot()); });
    expect(screen.queryByText('Session: 2025-01-02')).toBeNull();
    openMatches();
    await screen.findByText(/No matches in the 84 evaluated symbols/);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

it('shows official membership and actual observation dates after a real market response',async()=>{
  market.mockResolvedValueOnce({...snapshot(),mode:'real',sourceCoverage:{YAHOO_PUBLIC_CHART:50},membership:{requested:50,unmapped:[],source:'https://nsearchives.nseindia.com/content/indices/ind_nifty50list.csv',observedAt:'2026-10-16T11:00:00.000Z',freshness:'official-feed-observed; effective date not supplied',warnings:[]},observationDates:{earliest:'2026-10-15',latest:'2026-10-16',staleSymbols:0}});
  renderScanner();await screen.findByText(/Observed sessions: 2026-10-15 to 2026-10-16/);expect(screen.getAllByText(/NIFTY 50 \(official constituent feed\)/).length).toBeGreaterThan(0);expect(screen.getByRole('option',{name:'Nifty 50'})).toBeTruthy();
});

describe('live quotes and readable coverage in the scanner', () => {
  const quotedIds = (url: string) => {
    const query = new URL(String(url), 'http://local').searchParams.get('symbolIds') ?? '';
    return query.split(',').filter(Boolean).map(Number);
  };
  const liveStock = (id: number, ticker: string, overrides: Record<string, unknown> = {}) => ({
    id, ticker, name: ticker + ' Ltd.', sector: 'Energy', exchange: 'NSE',
    ltp: 1000 + id, changePercent: 1.2, date: '2026-11-13', formattedDate: '13 Nov 2026',
    trend: 'BULLISH', trendLabel: 'Bullish momentum', signal: 'PULLBACK_ENTRY', signalLabel: 'Pullback entry',
    rsi: 55, ema20: 990, sma50: 980, fiftyTwoWeekHigh: 1200, fiftyTwoWeekLow: 800,
    distFrom52WHigh: 5, distFrom52WLow: 20, volume: 100000, avg20Volume: 90000, volumeRatio: 1.1,
    momentumScore: 60, openInterest: null, oiChangePercent: null, oiInterpretation: null, pcrRatio: null,
    dataSource: 'OHLCV_ANALYSIS', high: 1010, low: 990, ...overrides,
  });
  const quoteResponse = (ids: number[]) => ({
    success: true, source: 'ANGEL_SMARTAPI', available: true, delay: 'live',
    fetchedAt: '2026-11-16T09:10:53.755Z', cached: false, configured: true,
    quotes: ids.map(id => ({ symbolId: id, ticker: 'SYM' + id, ltp: 7000 + id, open: 7000, high: 7100, low: 6900, close: 7000, changePercent: 0.75, exchangeTimestamp: '2026-11-16T09:10:55Z', fetchedAt: '2026-11-16T09:10:53.755Z', source: 'ANGEL_SMARTAPI', delay: 'live' })),
    unavailable: [], labels: [],
  });
  const q = () => {
    const fetch = vi.fn(async (url: string) => {
      if (String(url).startsWith('/api/v2/quotes')) return { ok: true, status: 200, json: async () => quoteResponse(quotedIds(url)) };
      return { ok: true, status: 200, json: async () => ({ success: true, dates: [] }) };
    });
    vi.stubGlobal('fetch', fetch);
    return fetch;
  };
  const liveSnapshot = () => ({
    ...snapshot(), mode: 'real', coverage: { requested: 50, succeeded: 50, unavailable: 0 }, sourceCoverage: { YAHOO_PUBLIC_CHART: 50 },
    trends: [liveStock(31, 'TRENDCO')],
    movers: {
      asOfDate: '2026-11-13', formattedDate: '13 Nov 2026', totalFilteredCount: 50,
      topGainers: [liveStock(11, 'GAINCO', { ltp: 7011 }), liveStock(12, 'WINCO')],
      topLosers: [liveStock(21, 'LOSECO'), liveStock(22, 'DIPCO')],
      volumeShockers: [], nearFiftyTwoWeekHigh: [], nearFiftyTwoWeekLow: [],
      derivativesBuildup: { longBuildup: [], shortCovering: [], shortBuildup: [], longUnwinding: [] },
      sectorHeatmap: [], marketBreadth: { advances: 20, declines: 20, unchanged: 10, advanceDeclineRatio: 1, bullishPercent: 40 },
    },
  });

  it('shows live LTPs with time beside the 13 Nov EOD ranking and keeps the banner readable', async () => {
    market.mockResolvedValueOnce(liveSnapshot() as unknown as Awaited<ReturnType<typeof requestMarketSnapshot>>);
    const fetch = q();
    renderScanner();
    await screen.findByRole('heading', { name: /^Top Gainers —/ });
    await waitFor(() => expect(screen.getAllByText('Live', { exact: true }).length).toBeGreaterThan(0));
    // GAINCO's live quote equals its EOD close, so its row must not repeat the price/time.
    expect(screen.queryByText('Close (live feed)')).toBeNull();
    expect(screen.getAllByText('₹7,011.00').length).toBe(1);
    // WINCO's live quote differs, so that row keeps the overlay.
    expect(screen.getAllByText(/IST/).length).toBeGreaterThan(0);
    expect(screen.getByText('50 stocks ranked on 13 Nov close')).toBeTruthy();
    expect(screen.getByText(/Coverage: 50 of 50 symbols/)).toBeTruthy();
    expect(screen.getAllByText(/Source: Yahoo public chart \(50\)/).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain('{"requested"');
    expect(document.body.textContent).not.toContain('{"YAHOO_PUBLIC_CHART"');
    expect(screen.getByText('Data details')).toBeTruthy();
    expect(screen.getByText(/Coverage detail: 50 of 50 symbols evaluated/)).toBeTruthy();
    expect(fetch.mock.calls.some(call => { const count = quotedIds(call[0]).length; return count > 0 && count <= 10; })).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /Technical Regimes/ }));
    await waitFor(() => expect(screen.getAllByText('TRENDCO').length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getAllByText('Live', { exact: true }).length).toBeGreaterThan(0));
    expect(screen.getByText(/Technical ranks use the 13 Nov 2026 EOD session/)).toBeTruthy();
  });

  it('renders latest-only model tabs at the latest session and offers recovery for a historical cutoff', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url) === '/api/market/dates') {
        return { ok: true, status: 200, json: async () => ({ success: true, dates: [{ date: '2025-01-02', label: '2025-01-02', isLatest: true }, { date: '2025-01-01', label: '2025-01-01', isLatest: false }] }) };
      }
      return { ok: true, status: 200, json: async () => ({ success: true }) };
    }));
    renderScanner();
    expect(await screen.findByText('Market scanner')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('button', { name: /Option Chain/ }));
    expect(screen.queryByText(/do not support the selected historical cutoff/)).toBeNull();
    expect(screen.getByText(/Latest-only/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Trading session'), { target: { value: '2025-01-01' } });
    expect(await screen.findByText(/uses the latest model reference/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Use latest session' }));
    await waitFor(() => expect(screen.queryByText(/uses the latest model reference/)).toBeNull());
  });

  it('shows an honest model-disabled empty state under real market data', async () => {
    market.mockResolvedValueOnce({ ...snapshot(), mode: 'real', provenance: { mode: 'real', actualRange: { end: '2025-01-02' } }, sourceCoverage: { real: 84 } } as unknown as Awaited<ReturnType<typeof requestMarketSnapshot>>);
    renderScanner();
    await screen.findByText('Market scanner');
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('button', { name: /Option Chain/ }));
    expect(await screen.findByText(/is a fictional demo model/)).toBeTruthy();
    expect(screen.getByText(/model-only derivatives are disabled/)).toBeTruthy();
    expect(screen.queryByText(/HTTP 422/)).toBeNull();
  });

  it('uses one universe picker, one session picker and a mobile section select without emoji copy', async () => {
    renderScanner();
    expect(await screen.findByText('Market scanner')).toBeTruthy();
    expect(screen.getByLabelText('Market universe')).toBeTruthy();
    expect(screen.getByLabelText('Trading session')).toBeTruthy();
    expect(screen.getByLabelText('Scanner section')).toBeTruthy();
    expect(screen.queryByText(/Market Universe \/ Index/)).toBeNull();
    expect(screen.queryByText(/Switch Universe/)).toBeNull();
    expect(screen.queryByText(/Institutional Intelligence/)).toBeNull();
    const emoji = ['🌐', '📈', '🏛️', '💎', '🏦', '💻', '🚗', '💊', '⛏️', '🛒', '📊', '🏢', '🔥', '🚀', '✨', '⚡'];
    expect(emoji.some(char => document.body.textContent?.includes(char))).toBe(false);
  });

  it('rounds scanner match numbers instead of showing raw floats', async () => {
    scan.mockResolvedValueOnce(scanResult({
      matched: 1,
      matches: [{
        symbolId: 7, ticker: 'TEST', name: 'Test equity', sector: 'IT', lastDate: '2025-01-02',
        lastClose: 1089.159426855896, changePercent: -0.5982512655315242, matchedRules: [{ rule: 'rsi', actualLeft: 1089.159426855896, actualRight: 0.5982512655315242 }],
        indicatorValues: {}, provenance: { mode: 'real', actualRange: { end: '2025-01-02' } },
      }],
      sourceCoverage: { real: 84 }, dataSource: 'OHLCV_ANALYSIS',
    }));
    renderScanner();
    openMatches();
    expect(await screen.findByText('₹1,089.16')).toBeTruthy();
    expect(screen.getByText('-0.60%')).toBeTruthy();
    expect(screen.getByText('Actual: 1,089.16 vs 0.60')).toBeTruthy();
    expect(document.body.textContent).not.toContain('1089.159426855896');
    expect(document.body.textContent).not.toContain('-0.5982512655315242');
  });
});

