import type { OHLCVBar } from '../../shared/strategy/types';
import { getSymbolById } from './symbols';
import { MarketDataError, type MarketProvider, type ProviderObservation } from './marketSeries';
import { getAngelCandles, type AngelCandle } from './angelClient';
import { resolveAngelInstrument } from './angelSymbols';

// Angel candles include the in-progress session; the research pipeline only accepts
// completed sessions. Mirror the Yahoo rule: drop today until 15:30 IST.
export function completedAngelBars(candles: AngelCandle[], now: number = Date.now()): { bars: OHLCVBar[]; skipped: number; incomplete: number } {
  const ist = new Date(now + 19_800_000);
  const today = ist.toISOString().slice(0, 10);
  const afterClose = ist.getUTCHours() * 60 + ist.getUTCMinutes() >= 15 * 60 + 30;
  const byDate = new Map<string, OHLCVBar>();
  let skipped = 0;
  let incomplete = 0;
  for (const candle of candles) {
    if (candle.date > today || (candle.date === today && !afterClose)) { incomplete++; continue; }
    const { date, timestamp, open, high, low, close, volume } = candle;
    if (![open, high, low, close, volume].every(Number.isFinite) || Math.min(open, high, low, close) <= 0 || volume < 0 || high < Math.max(open, close) || low > Math.min(open, close) || low > high) {
      skipped++;
      continue;
    }
    byDate.set(date, { date, timestamp, open, high, low, close, volume });
  }
  const bars = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-5_000);
  return { bars, skipped, incomplete };
}

export function angelEvidence(bars: OHLCVBar[], token: string, now: number, skipped: number, incomplete: number, exchange: 'NSE' | 'BSE' = 'NSE'): ProviderObservation['evidence'] {
  const today = new Date(now + 19_800_000).toISOString().slice(0, 10);
  const latest = bars[bars.length - 1];
  return {
    source: 'ANGEL_SMARTAPI',
    providerSymbol: `${exchange}:${token}`,
    exchangeTimezone: 'Asia/Kolkata',
    providerMarketTime: new Date(latest.timestamp).toISOString(),
    adjustment: `Unadjusted ${exchange} daily OHLCV from Angel One SmartAPI`,
    freshness: latest.date === today ? 'same-day-broker-close' : 'last-completed-session',
    calendarVersion: 'provider-observed-sessions',
    warnings: [
      "Owner's Angel One SmartAPI entitlement; Angel One redistribution terms apply to any public display",
      'End-of-day daily bars only, not an exchange tick stream',
      ...(incomplete ? [`${incomplete} unfinished session row(s) omitted`] : []),
      ...(skipped ? [`${skipped} invalid row(s) omitted without synthesis`] : [])
    ]
  };
}

export function createAngelProvider(
  fetcher: typeof fetch = fetch,
  options: { now?: () => number; cacheDirectory?: string } = {}
): MarketProvider {
  const now = options.now ?? (() => Date.now());
  return {
    name: 'ANGEL_SMARTAPI',
    // The first load may fetch the ~39 MB instrument master before requesting candles.
    deadlineMs: 45_000,
    async load(id, signal) {
      const symbol = getSymbolById(id);
      signal.throwIfAborted();
      const instrument = await resolveAngelInstrument(symbol.ticker, { fetch: fetcher, cacheDirectory: options.cacheDirectory, now, signal });
      signal.throwIfAborted();
      const at = now();
      const candles = await getAngelCandles(
        { exchange: instrument.exchange, symbolToken: instrument.token, interval: 'ONE_DAY', fromDate: new Date(at - 1100 * 86_400_000), toDate: new Date(at) },
        // Wait out a rate-limit window, but never past the provider deadline.
        { signal, fetch: fetcher, retryDeadlineAt: Date.now() + 35_000 }
      );
      const { bars, skipped, incomplete } = completedAngelBars(candles, at);
      if (!bars.length) throw new MarketDataError('PROVIDER_UNAVAILABLE', 'Angel One returned no completed daily bars');
      return { bars, evidence: angelEvidence(bars, instrument.token, at, skipped, incomplete, instrument.exchange), fetchedAt: new Date(at).toISOString() };
    }
  };
}
