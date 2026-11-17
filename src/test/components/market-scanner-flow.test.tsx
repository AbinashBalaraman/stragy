// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarketScannerView } from '../../components/scanner/MarketScannerView';
import type { StrategyAST } from '../../shared/strategy/types';
import type { ScannerPrefill } from '../../shared/contracts/featureRegistry';
import { STRATEGY_TEMPLATES } from '../../shared/strategy/templates';
import { cancelResearchJob, checkMarketJob, requestMarketSnapshot, requestScan } from '../../client/api';
import { UNIVERSE_OPTIONS } from '../../shared/data/symbols';

vi.mock('../../client/api', () => ({ requestMarketSnapshot: vi.fn(), requestScan: vi.fn(), checkMarketJob: vi.fn(), cancelResearchJob: vi.fn() }));
const market = vi.mocked(requestMarketSnapshot);
const scan = vi.mocked(requestScan);
const checkMarket = vi.mocked(checkMarketJob);
const cancelMarket = vi.mocked(cancelResearchJob);
const deadline = () => Object.assign(new Error('The market snapshot is still loading. Check again.'), { code: 'CLIENT_DEADLINE', jobId: 'job-late' });
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
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('bounded lazy market scanner flow', () => {
  it('labels real market prices without calling them demo and retains model-only derivatives disclosure', async () => {
    market.mockResolvedValueOnce({ ...snapshot(), mode: 'real', provenance: { mode: 'real', actualRange: { end: '2025-01-02' } }, sourceCoverage: { real: 84 } } as unknown as Awaited<ReturnType<typeof requestMarketSnapshot>>);
    renderScanner();
    await screen.findByText('Date: 02 Jan 2025');
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
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText(/Price source not reported; observed coverage unverified/)).toBeTruthy();
  });

  it('applies a chat scanner prefill: universe, cutoff, limit, tab and note', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url) === '/api/market/dates') {
        return { ok: true, status: 200, json: async () => ({ success: true, dates: [{ date: '2025-01-02', label: '2025-01-02', isLatest: true }, { date: '2025-01-01', label: '2025-01-01', isLatest: false }] }) };
      }
      return { ok: true, status: 200, json: async () => ({ success: true }) };
    }));
    scan.mockResolvedValue(scanResult());
    const prefill = {
      feature: 'market_scanner', universe: 'NIFTY_IT', strategy,
      asOf: '2025-01-01', limit: 12, source: 'chat', assumptions: ['Uses the active entry rules'],
    } as ScannerPrefill;
    render(<MarketScannerView strategy={strategy} onSelectStockAndBacktest={vi.fn()} prefill={prefill} />);
    expect(await screen.findByText(/Filled from chat/)).toBeTruthy();
    expect((screen.getByLabelText('Market universe') as HTMLSelectElement).value).toBe('NIFTY_IT');
    await waitFor(() => expect(scan).toHaveBeenCalledWith(expect.objectContaining({ universe: 'NIFTY_IT', limit: 12, asOf: '2025-01-01' }), expect.anything()));
  });

  it('keeps a remembered universe selectable and requests it', async () => {
    const onUniverseChange = vi.fn();
    render(<MarketScannerView strategy={strategy} onSelectStockAndBacktest={vi.fn()} initialUniverse="NIFTY_IT" onUniverseChange={onUniverseChange} />);
    expect(await screen.findByText('Market scanner')).toBeTruthy();
    const select = screen.getByLabelText('Market universe') as HTMLSelectElement;
    expect(select.value).toBe('NIFTY_IT');
    expect(onUniverseChange).not.toHaveBeenCalled();
    expect(market).toHaveBeenCalledWith({ universe: 'NIFTY_IT', asOf: undefined }, expect.anything(), expect.anything());
    expect(market).toHaveBeenCalledTimes(1);
    expect(scan).not.toHaveBeenCalled();
  });

  it('renders every universe option enabled and requests a new selection', async () => {
    const onUniverseChange = vi.fn();
    render(<MarketScannerView strategy={strategy} onSelectStockAndBacktest={vi.fn()} onUniverseChange={onUniverseChange} />);
    await waitFor(() => expect(screen.getByText('Date: 02 Jan 2025')).toBeTruthy());
    const select = screen.getByLabelText('Market universe') as HTMLSelectElement;
    const options = Array.from(select.querySelectorAll('option')) as HTMLOptionElement[];
    expect(options).toHaveLength(UNIVERSE_OPTIONS.length);
    expect(options.every(option => !option.disabled)).toBe(true);
    expect(options.map(option => option.value).sort()).toEqual(UNIVERSE_OPTIONS.map(option => option.id).sort());
    expect(select.textContent).not.toContain('not available');

    fireEvent.change(select, { target: { value: 'NIFTY_IT' } });
    expect(onUniverseChange).toHaveBeenCalledWith('NIFTY_IT');
    await waitFor(() => expect(market).toHaveBeenLastCalledWith({ universe: 'NIFTY_IT', asOf: undefined }, expect.anything(), expect.anything()));
  });

  it('shows a compact inline status when the selected universe has no data', async () => {
    market.mockResolvedValueOnce({
      ...snapshot(), universe: 'NIFTY_IT',
      coverage: { requested: 50, succeeded: 0, unavailable: 50 },
      errors: Array.from({ length: 50 }, (_, index) => ({ symbolId: index + 1, code: 'NO_MEMBERSHIP', ticker: 'S' + index })),
    } as unknown as Awaited<ReturnType<typeof requestMarketSnapshot>>);
    render(<MarketScannerView strategy={strategy} onSelectStockAndBacktest={vi.fn()} initialUniverse="NIFTY_IT" />);

    expect(await screen.findByText('No verified data for NIFTY IT in the current feed')).toBeTruthy();
    expect(screen.getByText(/The feed returned no evaluated symbols for this universe/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry snapshot' }));
    await waitFor(() => expect(market).toHaveBeenCalledTimes(2));
  });

  it('renders matched rule evidence in plain language when the rule index is known', async () => {
    scan.mockResolvedValueOnce(scanResult({
      matched: 1,
      matches: [{
        symbolId: 7, ticker: 'TEST', name: 'Test equity', sector: 'IT', lastDate: '2025-01-02',
        lastClose: 100, changePercent: 1,
        matchedRules: [{ rule: 'close gt st1', ruleIndex: 0, actualLeft: 100, actualRight: 90 }],
        indicatorValues: {}, provenance: { mode: 'real', actualRange: { end: '2025-01-02' } },
      }],
      sourceCoverage: { real: 84 }, dataSource: 'OHLCV_ANALYSIS',
    }));
    render(<MarketScannerView strategy={STRATEGY_TEMPLATES[0].strategy} onSelectStockAndBacktest={vi.fn()} />);
    openMatches();
    expect(await screen.findByRole('button', { name: 'Backtest TEST' })).toBeTruthy();
    expect(screen.queryByText('close gt st1')).toBeNull();
    expect(screen.getAllByText('Close above Supertrend (10, 3)').length).toBeGreaterThanOrEqual(2);
  });

  it('explains the Angel rate limit when a scan is still running after 30 seconds', async () => {
    vi.useFakeTimers();
    try {
      scan.mockImplementationOnce(() => new Promise(() => {}));
      renderScanner();
      fireEvent.click(screen.getByRole('button', { name: /Strategy matches/i }));
      await act(async () => { await Promise.resolve(); });
      expect(screen.queryByText(/Still scanning/)).toBeNull();
      act(() => { vi.advanceTimersByTime(30_000); });
      expect(screen.getByText('Still scanning · Angel One allows 2 requests a second')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders the demo-model note immediately for a model-only tab', () => {
    market.mockImplementationOnce(() => new Promise(() => {}));
    renderScanner();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('button', { name: /Option chain/i }));
    expect(screen.getByText("Option chain isn't available")).toBeTruthy();
    expect(screen.queryByText(/Loading Nifty 50 prices/)).toBeNull();
  });

  it('keeps one loading line after ten seconds, without a second header status', () => {
    vi.useFakeTimers();
    try {
      market.mockImplementationOnce(() => new Promise(() => {}));
      renderScanner();
      expect(screen.getByText(/Loading Nifty 50 prices\. The first load takes up to 4 minutes/)).toBeTruthy();
      act(() => { vi.advanceTimersByTime(10_000); });
      expect(screen.getByText(/Loading Nifty 50 prices\. The first load takes up to 4 minutes/)).toBeTruthy();
      expect(screen.queryByText(/Still loading market data/)).toBeNull();
      expect(screen.queryByText(/end-of-day loading|checking live prices|Refreshing…/)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the header to the universe and date while the first load is in flight', () => {
    market.mockImplementationOnce(() => new Promise(() => {}));
    renderScanner();
    expect(screen.getByText(/Loading Nifty 50 prices/)).toBeTruthy();
    expect(screen.getByText('checking latest close…')).toBeTruthy();
    expect(screen.queryByText(/session unavailable/)).toBeNull();
    expect(screen.queryByText('checking live prices…')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
    expect(screen.queryByText('Refreshing…')).toBeNull();
  });

  it('maps an unsupported-universe rejection to the compact inline status', async () => {
    market.mockRejectedValueOnce(Object.assign(
      new Error('I can only screen the Nifty 50 with verified membership. Use the Market scanner for NIFTY IT.'),
      { status: 422, code: 'UNIVERSE_UNSUPPORTED' },
    ));
    render(<MarketScannerView strategy={strategy} onSelectStockAndBacktest={vi.fn()} initialUniverse="NIFTY_IT" />);

    expect(await screen.findByText('No verified data for NIFTY IT in the current feed')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows running job progress from the server stage and cancels the load', async () => {
    market.mockReturnValueOnce(new Promise(() => {}));
    renderScanner();
    await waitFor(() => expect(market).toHaveBeenCalledTimes(1));
    const onProgress = market.mock.calls[0][2];
    act(() => onProgress?.({ status: 'running', stage: 'market symbols 7/50' }));

    expect(screen.getByText('Loading Nifty 50 prices · 7 of 50')).toBeTruthy();
    const cancel = screen.getByRole('button', { name: 'Cancel load' });
    expect(cancel.className).toContain('min-h-11');
    fireEvent.click(cancel);

    expect(screen.getByText('Market load cancelled.')).toBeTruthy();
    expect(market.mock.calls[0][1]?.aborted).toBe(true);
  });

  it('offers a retry path after 90 seconds without progress', async () => {
    vi.useFakeTimers();
    try {
      market.mockImplementationOnce(() => new Promise(() => {}));
      renderScanner();
      expect(screen.queryByRole('button', { name: 'Retry snapshot' })).toBeNull();
      act(() => { vi.advanceTimersByTime(90_000); });
      expect(screen.getByText(/Still loading after 90 seconds/)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Retry snapshot' }));
      expect(market).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows finished coverage, status, warnings and membership quietly', async () => {
    const salesforceMembership = {
      requested: 50, unmapped: [{ ticker: 'OLD', reason: 'Not in feed' }],
      source: 'https://nsearchives.nseindia.com/content/indices/ind_nifty50list.csv',
      observedAt: '2026-11-17T10:00:00.000Z', freshness: 'official feed observed',
      warnings: ['One symbol was renamed.'],
    };
    market.mockResolvedValueOnce({
      ...snapshot(), status: 'partial', warnings: ['Two symbols had no close for this session.'],
      membership: salesforceMembership,
      coverage: { requested: 50, succeeded: 49, unavailable: 1 },
      errors: [{ symbolId: 18, code: 'PROVIDER_RATE_LIMITED', ticker: 'TATAMOTORS' }],
    } as unknown as Awaited<ReturnType<typeof requestMarketSnapshot>>);
    renderScanner();
    expect(await screen.findByText(/49 of 50 stocks priced · partial coverage · TATAMOTORS unavailable/)).toBeTruthy();
    expect(screen.getByText('Two symbols had no close for this session.')).toBeTruthy();
    expect(screen.getByText(/Membership: 50 requested, 1 unmapped/)).toBeTruthy();
    expect(screen.getByText(/Membership check: 50 requested · 1 unmapped · official feed observed/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.body.textContent).not.toContain('symbolId');
    expect(document.body.textContent).not.toContain('PROVIDER_RATE_LIMITED');
  });

  it('offers Check again and Cancel for a client deadline instead of a failure banner', async () => {
    market.mockRejectedValueOnce(deadline());
    renderScanner();
    expect(await screen.findByText('The market snapshot is still loading. Check again.')).toBeTruthy();
    expect(screen.queryByText(/Market snapshot unavailable/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Check again' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
  });

  it('shows the snapshot when Check again finds the job finished', async () => {
    market.mockRejectedValueOnce(deadline());
    checkMarket.mockResolvedValueOnce({ state: 'done', result: snapshot() });
    renderScanner();
    fireEvent.click(await screen.findByRole('button', { name: 'Check again' }));
    expect(await screen.findByRole('heading', { name: /^Top gainers —/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull();
    expect(checkMarket).toHaveBeenCalledWith('job-late');
  });

  it('keeps the deadline line while Check again reports still running', async () => {
    market.mockRejectedValueOnce(deadline());
    checkMarket.mockResolvedValueOnce({ state: 'running', stage: 'scan 12/50' });
    renderScanner();
    fireEvent.click(await screen.findByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(checkMarket).toHaveBeenCalledWith('job-late'));
    expect(screen.getByText('The market snapshot is still loading. Check again.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Check again' })).toBeTruthy();
  });

  it('shows the lost-run copy when Check again finds a 404', async () => {
    market.mockRejectedValueOnce(deadline());
    checkMarket.mockRejectedValueOnce(Object.assign(new Error('Request failed (404)'), { status: 404 }));
    renderScanner();
    fireEvent.click(await screen.findByRole('button', { name: 'Check again' }));
    expect(await screen.findByText(/The server restarted and the market load was lost/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull();
  });

  it('cancels the kept job and stops pretending to load', async () => {
    market.mockRejectedValueOnce(deadline());
    renderScanner();
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(cancelMarket).toHaveBeenCalledWith('job-late');
    expect(await screen.findByText('Market load cancelled.')).toBeTruthy();
  });

  it('keeps more than three unpriced names behind a quiet disclosure', async () => {
    const errors = ['AAA', 'BBB', 'CCC', 'DDD'].map((ticker, index) => ({ symbolId: 100 + index, code: 'PROVIDER_RATE_LIMITED', ticker }));
    market.mockResolvedValueOnce({ ...snapshot(), coverage: { requested: 50, succeeded: 46, unavailable: 4 }, errors } as unknown as Awaited<ReturnType<typeof requestMarketSnapshot>>);
    renderScanner();
    expect(await screen.findByText('46 of 50 stocks priced · 4 unavailable')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Which symbols')).toBeTruthy();
    expect(document.body.textContent).toContain('AAA, BBB, CCC, DDD');
  });

  it('says the session is unavailable only after an empty snapshot finishes', async () => {
    market.mockResolvedValueOnce({
      ...snapshot(), mode: 'real', trends: [], provenance: undefined,
      coverage: { requested: 84, succeeded: 0, unavailable: 84 }, sourceCoverage: {}, movers: null,
    } as unknown as Awaited<ReturnType<typeof requestMarketSnapshot>>);
    renderScanner();

    expect((await screen.findAllByText('Gainers unavailable: no evaluated price coverage.')).length).toBeGreaterThan(0);
    expect(screen.getByText(/end-of-day session unavailable/)).toBeTruthy();
    expect(screen.queryByText(/checking latest close…/)).toBeNull();
  });

  it('never turns unavailable market data into no gainers, no losers, or zero breadth', async () => {
    market.mockResolvedValueOnce({ ...snapshot(), mode: 'real', trends: [], provenance: undefined, coverage: { requested: 84, succeeded: 0, unavailable: 84 }, sourceCoverage: {}, movers: { asOfDate: '2025-01-02', formattedDate: '2025-01-02', totalFilteredCount: 0, topGainers: [], topLosers: [], volumeShockers: [], nearFiftyTwoWeekHigh: [], nearFiftyTwoWeekLow: [], derivativesBuildup: { longBuildup: [], shortCovering: [], shortBuildup: [], longUnwinding: [] }, sectorHeatmap: [], marketBreadth: { advances: 0, declines: 0, unchanged: 0, advanceDeclineRatio: 0, bullishPercent: 0 } } } as unknown as Awaited<ReturnType<typeof requestMarketSnapshot>>);
    const onBacktest = vi.fn();
    render(<MarketScannerView strategy={strategy} onSelectStockAndBacktest={onBacktest} />);
    expect(await screen.findByText(/Price data unavailable: no evaluated coverage/)).toBeTruthy();
    expect(screen.getByText('Gainers unavailable: no evaluated price coverage.')).toBeTruthy();
    expect(screen.getByText('Losers unavailable: no evaluated price coverage.')).toBeTruthy();
    expect(screen.queryByText(/No gainers|No losers|0% Bullish/)).toBeNull();
    expect(screen.getAllByText('Date: Date unavailable').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /Technical regimes/i }));
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
    fireEvent.click(await screen.findByRole('button', { name: 'Backtest TEST' }));
    expect(onBacktest).toHaveBeenLastCalledWith(7, '2025-01-02');
    await screen.findByRole('option', { name: '2025-01-01' });
    fireEvent.change(screen.getByLabelText('Trading date'), { target: { value: '2025-01-01' } });
    await waitFor(() => expect(scan).toHaveBeenCalledTimes(2));
    fireEvent.click(await screen.findByRole('button', { name: 'Backtest TEST' }));
    expect(onBacktest).toHaveBeenLastCalledWith(7, '2025-01-01');
  });

  it('shows strategy-scan loading copy instead of market loading copy and finishes with a result title', async () => {
    const pending = deferred<Awaited<ReturnType<typeof requestScan>>>();
    scan.mockReturnValueOnce(pending.promise);
    renderScanner();
    openMatches();

    expect(screen.getByText(/Scanning Nifty 50 with your strategy… This can take up to 4 minutes on a cold load\./)).toBeTruthy();
    expect(screen.queryByText(/Loading Nifty 50 prices/)).toBeNull();
    expect(screen.queryByText(/session unavailable/)).toBeNull();
    expect(screen.getByText('checking latest close…')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Scanning Nifty 50 with “Test rules”…' })).toBeTruthy();

    const matches = Array.from({ length: 9 }, (_, index) => ({
      symbolId: index + 1, ticker: 'T' + index, name: 'Stock ' + index, sector: 'IT', lastDate: '2025-01-02',
      lastClose: 100, changePercent: 1, matchedRules: [], indicatorValues: {},
      provenance: { mode: 'real', actualRange: { end: '2025-01-02' } },
    }));
    await act(async () => { pending.resolve(scanResult({ asOf: '2025-01-02', matched: 9, matches })); });

    expect(await screen.findByRole('heading', { name: '9 matches for “Test rules” in Nifty 50' })).toBeTruthy();
    expect(screen.getByText(/end-of-day 02 Jan 2025/)).toBeTruthy();
    expect(screen.queryByText(/session unavailable/)).toBeNull();
  });

  it('names a finished scan with no matches instead of saying it is still scanning', async () => {
    scan.mockResolvedValueOnce(scanResult({ matched: 0, matches: [] }));
    renderScanner();
    openMatches();
    expect(await screen.findByRole('heading', { name: 'No matches for “Test rules” in Nifty 50' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /Scanning Nifty 50 with/ })).toBeNull();
  });

  it('names a failed strategy scan and keeps the retry action', async () => {
    scan.mockRejectedValueOnce(new Error('HTTP 504'));
    renderScanner();
    openMatches();
    expect(await screen.findByRole('heading', { name: "The strategy scan didn't finish" })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry strategy scan' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /Scanning Nifty 50 with/ })).toBeNull();
  });

  it('shows one loading skeleton instead of false unavailable copy before market data arrives', async () => {
    const pending = deferred<Awaited<ReturnType<typeof requestMarketSnapshot>>>();
    market.mockReturnValueOnce(pending.promise);
    renderScanner();
    expect(await screen.findByText(/Loading Nifty 50 prices/)).toBeTruthy();
    expect(screen.queryByText(/Price source not yet reported/)).toBeNull();
    expect(screen.queryByText(/Gainers unavailable/)).toBeNull();
    await act(async () => { pending.resolve(snapshot()); });
    expect(await screen.findByRole('heading', { name: /^Top gainers —/i })).toBeTruthy();
  });

  it('defaults to the bounded labelled pool, loads only market and never refetches for an observed cutoff', async () => {
    renderScanner();
    await waitFor(() => expect(screen.getByText('Date: 02 Jan 2025')).toBeTruthy());
    expect((universe() as HTMLSelectElement).value).toBe('NIFTY_50');
    expect(market).toHaveBeenCalledTimes(1);
    expect(market.mock.calls[0][0]).toEqual({ universe: 'NIFTY_50', asOf: undefined });
    expect(scan).not.toHaveBeenCalled();
    expect(screen.getByText(/current NIFTY 50 membership and count are unverified/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Technical regimes/i }));
    expect(market).toHaveBeenCalledTimes(1);
    expect(scan).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
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
    fireEvent.click(screen.getByRole('button', { name: /gainers.*losers/i }));
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
    expect(screen.getByText('Date: 02 Jan 2025')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy();
    openMatches();
    fireEvent.change(universe(), { target: { value: 'NIFTY_50' } });
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: '' } });
    expect(scan).toHaveBeenCalledTimes(1);
    expect(scan.mock.calls[0][1]?.aborted).toBe(false);
    expect(screen.getByRole('button', { name: /Strategy matches/i })).toBeTruthy();
    await act(async () => { pendingScan.resolve(scanResult()); });
    expect(screen.getByText(/No matches in the 84 evaluated symbols/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy();
  });

  it('never presents failed HTTP 504 jobs as no matches and clears stale success on retry', async () => {
    renderScanner(); openMatches();
    await screen.findByText(/No matches in the 84 evaluated symbols/);
    const retry = deferred<Awaited<ReturnType<typeof requestScan>>>();
    scan.mockReturnValueOnce(retry.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
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

  it('ignores late scan completion and errors from replaced strategy contexts', async () => {
    const first = deferred<Awaited<ReturnType<typeof requestScan>>>();
    const second = deferred<Awaited<ReturnType<typeof requestScan>>>();
    scan.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockResolvedValueOnce(scanResult({ scanned: 3, succeeded: 3 }));
    const { rerender } = renderScanner(); openMatches();
    const nextStrategy = { name: 'Replacement rules' } as unknown as StrategyAST;
    rerender(<MarketScannerView strategy={nextStrategy} onSelectStockAndBacktest={vi.fn()} />);
    rerender(<MarketScannerView strategy={{ name: 'Final rules' } as unknown as StrategyAST} onSelectStockAndBacktest={vi.fn()} />);
    await screen.findByText(/No matches in the 3 evaluated symbols/);
    expect(scan.mock.calls[0][1]?.aborted).toBe(true);
    expect(scan.mock.calls[1][1]?.aborted).toBe(true);
    await act(async () => { first.resolve(scanResult({ succeeded: 84 })); second.reject(new Error('old HTTP 504')); });
    expect(screen.getByText(/No matches in the 3 evaluated symbols/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(scan.mock.calls.map(call => call[0].universe)).toEqual(['NIFTY_50', 'NIFTY_50', 'NIFTY_50']);
    expect(market).toHaveBeenCalledTimes(1);
  });

  it('isolates market failures from scans and ignores old market completions after a date change', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url) === '/api/market/dates') return { ok: true, status: 200, json: async () => ({ success: true, dates: [{ date: '2025-01-01', label: '2025-01-01', isLatest: false }] }) };
      return { ok: true, status: 200, json: async () => ({ success: true }) };
    }));
    const old = deferred<Awaited<ReturnType<typeof requestMarketSnapshot>>>();
    market.mockReturnValueOnce(old.promise).mockRejectedValueOnce(new Error('HTTP 504 market job'));
    renderScanner();
    await screen.findByRole('option', { name: '2025-01-01' });
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: '2025-01-01' } });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('504'));
    expect(market.mock.calls[0][1]?.aborted).toBe(true);
    expect(market.mock.calls[1][0]).toEqual({ universe: 'NIFTY_50', asOf: '2025-01-01' });
    await act(async () => { old.resolve(snapshot()); });
    expect(screen.queryByText('Date: 02 Jan 2025')).toBeNull();
    openMatches();
    await screen.findByText(/No matches in the 84 evaluated symbols/);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

it('shows official membership and actual observation dates after a real market response',async()=>{
  market.mockResolvedValueOnce({...snapshot(),mode:'real',sourceCoverage:{YAHOO_PUBLIC_CHART:50},membership:{requested:50,unmapped:[],source:'https://nsearchives.nseindia.com/content/indices/ind_nifty50list.csv',observedAt:'2026-10-16T11:00:00.000Z',freshness:'official-feed-observed; effective date not supplied',warnings:[]},observationDates:{earliest:'2026-10-15',latest:'2026-10-16',staleSymbols:0}});
  renderScanner();await screen.findByText(/Observed sessions: 2026-10-15 to 2026-10-16/);expect(screen.getAllByText(/NIFTY 50 \(official constituent feed\)/).length).toBeGreaterThan(0);expect(screen.getByRole('option',{name:/NIFTY 50/i})).toBeTruthy();
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
    await screen.findByRole('heading', { name: /^Top gainers —/i });
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

    fireEvent.click(screen.getByRole('button', { name: /Technical regimes/i }));
    await waitFor(() => expect(screen.getAllByText('TRENDCO').length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getAllByText('Live', { exact: true }).length).toBeGreaterThan(0));
    expect(screen.getByText('1 stock · 13 Nov close. Live prices shown separately.')).toBeTruthy();
  });

  it('shows 20 regime rows first and expands to all 25', async () => {
    const trends = Array.from({ length: 25 }, (_, index) => liveStock(100 + index, 'TR' + String(index).padStart(2, '0')));
    market.mockResolvedValueOnce({ ...snapshot(), mode: 'real', trends, provenance: { mode: 'real', actualRange: { end: '2025-01-02' } }, sourceCoverage: { real: 25 } } as unknown as Awaited<ReturnType<typeof requestMarketSnapshot>>);
    renderScanner();
    fireEvent.click(screen.getByRole('button', { name: /Technical regimes/i }));
    expect(await screen.findByText('TR00')).toBeTruthy();
    expect(screen.getByText('TR19')).toBeTruthy();
    expect(screen.queryByText('TR20')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show all 25' }));
    expect(screen.getByText('TR24')).toBeTruthy();
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
    fireEvent.click(screen.getByRole('button', { name: /Option chain/i }));
    expect(screen.getByRole('button', { name: 'More · Option chain' })).toBeTruthy();
    expect(screen.queryByText(/do not support the selected historical cutoff/)).toBeNull();
    expect(screen.getByText(/Latest session only/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Trading date'), { target: { value: '2025-01-01' } });
    expect(screen.getByText(/uses the latest model reference/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Use latest session' }));
    await waitFor(() => expect(screen.queryByText(/uses the latest model reference/)).toBeNull());
  });

  it('shows an honest model-disabled empty state under real market data', async () => {
    market.mockResolvedValueOnce({ ...snapshot(), mode: 'real', provenance: { mode: 'real', actualRange: { end: '2025-01-02' } }, sourceCoverage: { real: 84 } } as unknown as Awaited<ReturnType<typeof requestMarketSnapshot>>);
    renderScanner();
    await screen.findByText('Market scanner');
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('button', { name: /Option chain/i }));
    expect(await screen.findByText("Option chain isn't available")).toBeTruthy();
    expect(screen.getByText("Stragy only shows real observed data, and there's no real option-chain feed yet.")).toBeTruthy();
    const panel = screen.getByText("Option chain isn't available").closest('[role="status"]') as HTMLElement;
    expect(panel.className).not.toContain('border-dashed');
    expect(panel.className).not.toContain('text-center');
    const back = screen.getByRole('button', { name: 'Back to Top gainers & losers' });
    expect(back.className).toContain('min-h-11');
    expect(screen.queryByText(/model-only derivatives are disabled/)).toBeNull();
    expect(screen.queryByText(/HTTP 422/)).toBeNull();
    fireEvent.click(back);
    expect(screen.queryByText("Option chain isn't available")).toBeNull();
  });

  it('uses one universe picker, one session picker and a mobile section select without emoji copy', async () => {
    renderScanner();
    expect(await screen.findByText('Market scanner')).toBeTruthy();
    expect(screen.getByLabelText('Market universe')).toBeTruthy();
    expect(screen.getByLabelText('Trading date')).toBeTruthy();
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
    expect(screen.getByText(/1,089\.16 vs 0\.60/)).toBeTruthy();
    expect(document.body.textContent).not.toContain('1089.159426855896');
    expect(document.body.textContent).not.toContain('-0.5982512655315242');
  });
});

