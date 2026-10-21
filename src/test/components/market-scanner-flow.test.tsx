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
const openMatches = () => fireEvent.click(screen.getByRole('button', { name: /Strategy Matches/ }));
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
    const match = (lastDate: string) => ({ symbolId: 7, ticker: 'TEST', name: 'Test equity', sector: 'IT', lastDate, lastClose: 100, changePercent: 1, matchedRules: [], indicatorValues: {}, provenance: { mode: 'real', actualRange: { end: lastDate } } });
    scan.mockResolvedValueOnce(scanResult({ matched: 1, matches: [match('2025-01-02')], sourceCoverage: { real: 84 }, dataSource: 'OHLCV_ANALYSIS' }))
      .mockResolvedValueOnce(scanResult({ matched: 1, matches: [match('2025-01-10')], sourceCoverage: { real: 84 }, dataSource: 'OHLCV_ANALYSIS' }));
    const onBacktest = vi.fn();
    render(<MarketScannerView strategy={strategy} onSelectStockAndBacktest={onBacktest} />);
    openMatches();
    fireEvent.click(await screen.findByRole('button', { name: 'Load & Run Backtest on TEST' }));
    expect(onBacktest).toHaveBeenLastCalledWith(7, '2025-01-02');
    fireEvent.change(document.querySelector('input[type="date"]')!, { target: { value: '2025-01-05' } });
    await waitFor(() => expect(scan).toHaveBeenCalledTimes(2));
    fireEvent.click(await screen.findByRole('button', { name: 'Load & Run Backtest on TEST' }));
    expect(onBacktest).toHaveBeenLastCalledWith(7, '2025-01-05');
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
    expect(screen.getByRole('button', { name: 'Strategy Matches (pending)' })).toBeTruthy();
    expect(screen.queryByText(/No matches/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Gainers.*Losers/ }));
    expect(scan.mock.calls[0][1]?.aborted).toBe(true);
    expect(market).toHaveBeenCalledTimes(2);
    await act(async () => { pendingScan.resolve(scanResult()); pendingMarket.resolve(snapshot()); });
    expect(screen.getByRole('button', { name: 'Strategy Matches (not evaluated)' })).toBeTruthy();
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
    expect(screen.getByRole('button', { name: 'Strategy Matches (pending)' })).toBeTruthy();
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
    expect(screen.getByRole('button', { name: 'Strategy Matches (pending)' })).toBeTruthy();
    await act(async () => { retry.reject(new Error('HTTP 504: scan job failed')); });
    expect(screen.getByRole('alert').textContent).toContain('504');
    expect(screen.queryByText(/No matches/)).toBeNull();
    expect(screen.queryByText(/No stocks currently trigger/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Strategy Matches (unavailable)' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry strategy scan' }));
    await screen.findByText(/No matches in the 84 evaluated symbols/);
    expect(scan).toHaveBeenCalledTimes(3);
    expect(market).toHaveBeenCalledTimes(1);
  });

  it('reports genuine successful zero matches only for the evaluated subset with partial counts', async () => {
    scan.mockResolvedValueOnce(scanResult({ scanned: 10, succeeded: 10, unavailable: 70, failed: 4 }));
    renderScanner(); openMatches();
    expect(await screen.findByText('No matches in the 10 evaluated symbols. This does not establish no matches across the full universe.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Strategy Matches (0)' })).toBeTruthy();
    expect(screen.getByText(/Evaluated: 10; unavailable: 70; failed: 4/)).toBeTruthy();
    expect(screen.getByText(/Demo OHLCV · not observed market prices/)).toBeTruthy();
  });

  it('does not call unavailable or missing evaluated coverage zero matches', async () => {
    scan.mockResolvedValueOnce(scanResult({ scanned: 0, succeeded: 0, unavailable: 84 }));
    renderScanner(); openMatches();
    await screen.findByText('Strategy results unavailable: no evaluated coverage was reported.');
    expect(screen.queryByText(/No matches/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Strategy Matches (not evaluated)' })).toBeTruthy();
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
  renderScanner();await screen.findByText(/Observed sessions: 2026-10-15 to 2026-10-16/);expect(screen.getAllByText(/NIFTY 50 \(official constituent feed\)/).length).toBeGreaterThan(0);expect(screen.getByRole('option',{name:'NIFTY 50 (official 50-member feed)'})).toBeTruthy();
});
