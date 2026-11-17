import { describe, expect, it, vi } from 'vitest';
import { handleAIChat } from '../../server/ai/copilot';
import { researchChat } from '../../server/ai/researchChat';
import { detectMarketSymbols, lastCompletedSessionDate } from '../../server/ai/marketContext';
import { MarketDataError, type MarketSeries } from '../../server/data/marketSeries';
import type { LiveQuote, LiveQuotesResult } from '../../server/data/liveQuotes';
import { createRequestBudget } from '../../server/ai/provider';
import { fakeResponse, openAIBody, READY_ENV, recordingFetch } from '../../server/ai/testFixtures';
import type { OHLCVBar } from '../../shared/strategy/types';

const NOW = new Date('2026-11-16T08:35:00.000Z'); // Monday 14:05 IST
const LIVE_AT = '2026-11-16T14:04:00+05:30';

function seriesFor(id: number, mode: 'demo' | 'real' = 'demo', endDate = '2026-11-13'): MarketSeries {
  const end = Date.parse(`${endDate}T00:00:00.000Z`);
  const bars: OHLCVBar[] = Array.from({ length: 60 }, (_, i) => {
    const timestamp = end - (59 - i) * 86_400_000;
    const close = 24_000 + i * 16.949;
    return { date: new Date(timestamp).toISOString().slice(0, 10), timestamp, open: close - 20, high: close + 60, low: close - 80, close, volume: 100_000 + i };
  });
  const last = bars[bars.length - 1];
  return {
    bars,
    provenance: {
      mode, source: mode === 'demo' ? 'DETERMINISTIC_DEMO_V1' : 'YAHOO_PUBLIC_CHART', symbolId: id,
      asOf: last.date, fetchedAt: '2026-11-13T10:00:00.000Z', requestedRange: {}, actualRange: { start: bars[0].date, end: last.date },
      adjustment: 'unadjusted', checksum: 'fixture', coverage: 'available-history',
      freshness: mode === 'demo' ? 'fixed-demo' : 'end-of-day', warnings: [], calendarVersion: 'fixture',
    },
  };
}
const loadFor = (mode: 'demo' | 'real' = 'demo', endDate = '2026-11-13') => vi.fn(async (id: number, options: { mode: 'demo' | 'real' }) => seriesFor(id, options.mode ?? mode, endDate));

function liveQuote(overrides: Partial<LiveQuote> = {}): LiveQuote {
  return {
    symbolId: 1, ticker: '^NSEI', ltp: 25_216.4, open: 25_100, high: 25_250, low: 25_050, close: 25_144.3,
    changePercent: 0.29, exchangeTimestamp: LIVE_AT, fetchedAt: '2026-11-16T08:34:00.000Z', source: 'ANGEL_SMARTAPI', delay: 'live',
    ...overrides,
  };
}
function liveResult(quotes: LiveQuote[]): LiveQuotesResult {
  return {
    source: 'ANGEL_SMARTAPI', available: quotes.length > 0, delay: quotes.every(quote => quote.delay === 'live') ? 'live' : 'unknown',
    fetchedAt: '2026-11-16T08:34:00.000Z', cached: false, configured: true, quotes, unavailable: [],
  };
}

describe('market-data grounding', () => {
  it('answers price questions deterministically from demo data when no AI is configured', async () => {
    const load = loadFor('demo');
    const out = await handleAIChat({ message: 'what is the current Nifty price?' }, { env: { AI_PROVIDER: 'none' }, market: { mode: 'demo', load, env: { QUOTES_PROVIDER: 'none' }, now: () => NOW } });
    expect(out.aiConnected).toBe(false);
    expect(out.method).toBe('local_heuristic');
    expect(out.reply).toMatch(/\*\*Nifty 50: [\d,.]+/);
    expect(out.reply).toMatch(/· Stragy demo data \(generated\) · 13 Nov 2026/);
    expect(out.reply).toMatch(/Generated demo data, not observed market data/);
    expect(out.reply).toMatch(/RSI\(14\)/);
    expect(out.reply).not.toMatch(/DETERMINISTIC_DEMO_V1|stale|Demo market context/i);
    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0][0]).toBe(1);
    expect(load.mock.calls[0][1]).toEqual({ mode: 'demo' });
    expect(out.warnings.join(' ')).toMatch(/not AI and not a real-time quote/);
  });

  it('labels real-mode daily closes as Yahoo daily closes with no internal code', async () => {
    const load = loadFor('real');
    const out = await handleAIChat({ message: 'where is RELIANCE trading?' }, { env: { AI_PROVIDER: 'none', DATA_MODE: 'real' }, market: { mode: 'real', env: { QUOTES_PROVIDER: 'none' }, load, now: () => NOW } });
    expect(out.reply).toMatch(/\*\*Reliance Industries \(RELIANCE\): ₹[\d,.]+/);
    expect(out.reply).toMatch(/· Yahoo daily close · 13 Nov 2026/);
    expect(out.reply).toMatch(/Daily close, not a live quote/);
    expect(out.reply).not.toMatch(/YAHOO_PUBLIC_CHART|stale|Observed daily market context/i);
    expect(load.mock.calls[0][0]).toBe(9);
    expect(load.mock.calls[0][1]).toEqual({ mode: 'real' });
  });

  it('includes an Angel One live quote with LTP, change, exchange time and human source', async () => {
    const load = loadFor('real');
    const live = vi.fn(async () => liveResult([liveQuote()]));
    const out = await handleAIChat({ message: 'What is the current Nifty price?' }, { env: { AI_PROVIDER: 'none' }, market: { mode: 'real', env: { QUOTES_PROVIDER: 'angel' }, load, live, now: () => NOW } });
    expect(live).toHaveBeenCalledWith([1]);
    expect(out.reply).toMatch(/\*\*Nifty 50: 25,216\.40\*\* \(\+0\.29% today\) · Angel One live quote/);
    expect(out.reply).toContain('As of 2:04 pm IST.');
    expect(out.reply).toMatch(/52-week range [\d,.]+ – [\d,.]+ · RSI\(14\) [\d.]+/);
    expect(out.reply).toMatch(/Last daily close [\d,.]+ on 13 Nov 2026/);
    expect(out.reply).not.toMatch(/\^NSEI|ANGEL_SMARTAPI|YAHOO_PUBLIC_CHART|exchange time|Source: Angel One/);
    expect(out.warnings.join(' ')).toMatch(/Angel One live quote plus daily closes/);
  });

  it('says live is unavailable and still gives the dated last close when the live call fails', async () => {
    const load = loadFor('real');
    const live = vi.fn(async () => { throw new Error('broker timeout'); });
    const out = await handleAIChat({ message: 'What is the current Nifty price?' }, { env: { AI_PROVIDER: 'none' }, market: { mode: 'real', env: { QUOTES_PROVIDER: 'angel' }, load, live, now: () => NOW } });
    expect(out.reply).toMatch(/Live quotes are currently unavailable from Angel One/);
    expect(out.reply).toMatch(/This is the last daily close/);
    expect(out.reply).toMatch(/\*\*Nifty 50: [\d,.]+/);
    expect(out.reply).toMatch(/· Yahoo daily close · 13 Nov 2026/);
    expect(out.reply).not.toMatch(/live quote:/);
    expect(out.reply).not.toMatch(/ANGEL_SMARTAPI|YAHOO_PUBLIC_CHART|exchange time/);
  });

  it('never attempts a live call when QUOTES_PROVIDER is not angel', async () => {
    const load = loadFor('real');
    const live = vi.fn(async () => liveResult([liveQuote()]));
    const out = await handleAIChat({ message: 'What is the current Nifty price?' }, { env: { AI_PROVIDER: 'none' }, market: { mode: 'real', env: { QUOTES_PROVIDER: 'none' }, load, live, now: () => NOW } });
    expect(live).not.toHaveBeenCalled();
    expect(out.reply).toMatch(/· Yahoo daily close · 13 Nov 2026/);
    expect(out.reply).not.toMatch(/Angel One live quote|live quote:/);
  });

  it('passes human-readable sources and live fields to the model with a live-only price instruction', async () => {
    const load = loadFor('real');
    const live = vi.fn(async () => liveResult([liveQuote()]));
    const f = recordingFetch(() => fakeResponse({ body: openAIBody('NIFTY is up on the day.') }));
    await handleAIChat({ message: 'What is the current Nifty price?' }, { env: { ...READY_ENV }, fetch: f, budget: createRequestBudget(), market: { mode: 'real', env: { QUOTES_PROVIDER: 'angel' }, load, live, now: () => NOW } });
    const request = JSON.parse(f.calls[0].init.body);
    const system = request.messages[0].content as string;
    expect(system).toMatch(/may call a price live only when its source is "Angel One \(live\)"/i);
    expect(system).toMatch(/Never mention internal provider codes/);
    expect(system).toMatch(/Only say data is stale when market_data includes a freshnessNote or dailyClosesNote/);
    const user = JSON.parse(request.messages[1].content);
    expect(user.market_data.quotes).toHaveLength(1);
    expect(user.market_data.quotes[0].live).toMatchObject({
      ltp: 25_216.4, changePercent: 0.29, exchangeTime: '16 Nov 2026, 14:04 IST', age: '1 minute ago', source: 'Angel One (live)',
    });
    expect(user.market_data.quotes[0].provenance).toMatchObject({ source: 'Yahoo daily close', asOf: '2026-11-13', mode: 'real' });
    expect(JSON.stringify(user.market_data)).not.toMatch(/ANGEL_SMARTAPI|YAHOO_PUBLIC_CHART/);
  });

  it('does not show an exchange-time dump when the broker omits the time', async () => {
    const load = loadFor('real');
    const live = vi.fn(async () => liveResult([liveQuote({ exchangeTimestamp: null, delay: 'unknown' })]));
    const out = await handleAIChat({ message: 'What is the current Nifty price?' }, { env: { AI_PROVIDER: 'none' }, market: { mode: 'real', env: { QUOTES_PROVIDER: 'angel' }, load, live, now: () => NOW } });
    expect(out.reply).toContain('Angel One did not provide a trade time.');
    expect(out.reply).toContain('Angel One live quote');
    expect(out.reply).not.toMatch(/exchange time|time not provided/i);
  });

  it('only calls daily closes stale when they predate the last completed session, with a plain age', async () => {
    const load = loadFor('real', '2026-11-06');
    const out = await handleAIChat({ message: 'What is the current Nifty price?' }, { env: { AI_PROVIDER: 'none' }, market: { mode: 'real', env: { QUOTES_PROVIDER: 'none' }, load, now: () => NOW } });
    expect(out.reply).toMatch(/The daily closes are 7 days old/);
    expect(out.reply).toMatch(/before the last trading session \(13 Nov 2026\)/);
  });

  it('shows an old Angel quote with its human date and age, never as a current tick', async () => {
    const load = loadFor('real');
    const live = vi.fn(async () => liveResult([liveQuote({ exchangeTimestamp: '2026-11-12T15:29:00+05:30' })]));
    const out = await handleAIChat({ message: 'What is the current Nifty price?' }, { env: { AI_PROVIDER: 'none' }, market: { mode: 'real', env: { QUOTES_PROVIDER: 'angel' }, load, live, now: () => NOW } });
    expect(out.reply).toMatch(/Last traded 12 Nov 2026 at 3:29 pm IST/);
    expect(out.reply).toMatch(/the market is open/);
    expect(out.reply).toContain('Angel One live quote');
  });

  it('resolves the last completed session around weekends and the 15:30 IST close', () => {
    expect(lastCompletedSessionDate(new Date('2026-11-16T08:35:00.000Z'))).toBe('2026-11-13');
    expect(lastCompletedSessionDate(new Date('2026-11-16T10:30:00.000Z'))).toBe('2026-11-16');
    expect(lastCompletedSessionDate(new Date('2026-11-14T08:00:00.000Z'))).toBe('2026-11-13');
  });

  it('reports an unavailable data source without fabricating a price or leaking a code', async () => {
    const load = vi.fn(async () => { throw new MarketDataError('PROVIDER_UNAVAILABLE', 'No provider'); });
    const out = await handleAIChat({ message: 'what is the current RELIANCE price?' }, { env: { AI_PROVIDER: 'none' }, market: { mode: 'real', env: { QUOTES_PROVIDER: 'none' }, load, now: () => NOW } });
    expect(out.reply).toMatch(/Market data is unavailable right now/);
    expect(out.reply).toMatch(/No price was fabricated/);
    expect(out.reply).not.toMatch(/PROVIDER_UNAVAILABLE/);
    expect(out.reply).not.toMatch(/24,|25,|last close \d/);
  });

  it('does not load market data for non-price questions or explicit build/edit requests', async () => {
    const load = vi.fn();
    const deps = { env: { AI_PROVIDER: 'none' }, market: { mode: 'demo' as const, load, now: () => NOW } };
    await handleAIChat({ message: 'In one sentence, what does RSI measure?', currentStrategy: undefined }, deps);
    await handleAIChat({ message: 'Build a RELIANCE strategy' }, deps);
    await handleAIChat({ message: 'Set stop loss to 2% on RELIANCE' }, deps);
    expect(load).not.toHaveBeenCalled();
  });

  it('resolves Nifty/Bank Nifty aliases and caps a message at three symbols', async () => {
    expect(detectMarketSymbols('what is bank nifty price?')).toEqual([2]);
    expect(detectMarketSymbols('what is the nifty 50 level?')).toEqual([1]);
    const load = loadFor('demo');
    await handleAIChat({ message: 'Compare RELIANCE, HDFCBANK, TCS and INFY last price' }, { env: { AI_PROVIDER: 'none' }, market: { mode: 'demo', load, env: { QUOTES_PROVIDER: 'none' }, now: () => NOW } });
    expect(load.mock.calls.map(call => call[0])).toEqual([9, 10, 11]);
  });

  it('routes researchChat price questions through the same deterministic grounding', async () => {
    const load = loadFor('demo');
    const out = await researchChat({ message: 'what is the current Nifty price?' }, { env: { AI_PROVIDER: 'none' }, market: { mode: 'demo', load, env: { QUOTES_PROVIDER: 'none' }, now: () => NOW } });
    expect(out.kind).toBe('conversation');
    expect(out.message).toMatch(/\*\*Nifty 50: [\d,.]+/);
    expect(out.message).toMatch(/Stragy demo data \(generated\)/);
    expect(load).toHaveBeenCalledTimes(1);
  });
});

it('answers single-stock performance from observed daily bars, not an unavailable line', async () => {
  const bars: OHLCVBar[] = [];
  for (let t = Date.UTC(2024, 0, 1); t <= Date.UTC(2026, 10, 13); t += 86_400_000) {
    const day = new Date(t);
    if (day.getUTCDay() === 0 || day.getUTCDay() === 6) continue;
    const close = 100 + bars.length * 0.05;
    bars.push({ date: day.toISOString().slice(0, 10), timestamp: t, open: close - 1, high: close + 2, low: close - 2, close, volume: 1_000 });
  }
  const last = bars[bars.length - 1];
  const series: MarketSeries = {
    bars,
    provenance: {
      mode: 'real', source: 'ANGEL_SMARTAPI', symbolId: 9, asOf: last.date, fetchedAt: '2026-11-13T10:00:00.000Z',
      requestedRange: {}, actualRange: { start: bars[0].date, end: last.date }, adjustment: 'unadjusted', checksum: 'fixture',
      coverage: 'available-history', freshness: 'last-completed-session', warnings: [], calendarVersion: 'fixture',
    },
  };
  const load = vi.fn(async () => series);
  const out = await researchChat({ message: 'How has RELIANCE done this year?' }, {
    env: { AI_PROVIDER: 'none' },
    market: { mode: 'real', env: { QUOTES_PROVIDER: 'none' }, load, now: () => NOW },
  });
  expect(out.kind).toBe('conversation');
  expect(out.method).toBe('rule_parser');
  expect(out.message).toContain('Reliance Industries (RELIANCE)');
  expect(out.message).toMatch(/YTD [+-]\d+\.\d+%/);
  expect(out.message).toMatch(/1-year [+-]\d+\.\d+%/);
  expect(out.message).toContain('52-week range');
  expect(out.message).toMatch(/Observed through 13 Nov 2026/);
  expect(out.message).toContain('Angel One daily bars · not AI');
  expect(out.message).not.toMatch(/unavailable|ANGEL_SMARTAPI|Market data is unavailable/i);
  expect(load).toHaveBeenCalledWith(9, { mode: 'real' });
});
