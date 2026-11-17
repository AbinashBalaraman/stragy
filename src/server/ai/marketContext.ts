/**
 * Market-data grounding for chat. Daily closes come from the existing observed/demo
 * dataset loader; when QUOTES_PROVIDER=angel is configured the context also carries a
 * live Angel One quote alongside the daily history. The model never invents quotes.
 * Real mode never falls back to demo data for the daily closes.
 */
import type { OHLCVBar } from '../../shared/strategy/types';
import { ALL_SYMBOLS, getSymbolByTicker, getSymbolById } from '../data/symbols';
import { loadMarketSeries, MarketDataError, type MarketSeries } from '../data/marketSeries';
import { getLiveQuotes, type LiveQuotesResult } from '../data/liveQuotes';
import { formatDate, formatINR, formatNumber, formatPercent } from '../../shared/format';
import { calcRSI } from '../backtest/indicators';
import { hasStrategyActionVerb, isInformationalQuestion } from './intent';
import { resolveSymbolFromPrompt } from './heuristics';

export type MarketMode = 'demo' | 'real';
export type MarketSeriesLoader = (id: number, options: { mode: MarketMode }) => Promise<MarketSeries>;
export type LiveQuoteLoader = (ids: number[]) => Promise<LiveQuotesResult>;
export interface MarketContextDeps {
  load?: MarketSeriesLoader;
  mode?: MarketMode;
  env?: Record<string, string | undefined>;
  /** Angel One live quotes by default; injected in tests. */
  live?: LiveQuoteLoader;
  /** Clock used for plain-language freshness wording. */
  now?: () => Date;
}

export interface MarketLiveQuote {
  /** Last traded price from the broker. */
  ltp: number;
  changePercent: number;
  /** Broker exchange time, already formatted, or "time not provided". */
  exchangeTime: string;
  /** Human status line for the deterministic answer (open/closed, trade time). */
  statusLine: string;
  /** Plain-language age, e.g. "3 minutes ago", when a usable exchange time exists. */
  age?: string;
  source: 'Angel One (live)';
  /** Present only when the quote predates the last completed trading session. */
  freshnessNote?: string;
}
export interface MarketQuote {
  symbolId: number;
  ticker: string;
  name: string;
  lastClose?: number;
  lastDate?: string;
  previousClose?: number;
  changePercent?: number;
  recentCloses: { date: string; close: number }[];
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  rsi14?: number | null;
  ytdReturnPercent?: number;
  oneYearReturnPercent?: number;
  distanceFromHighPercent?: number;
  distanceFromLowPercent?: number;
  /** Human-readable provenance. Internal provider codes are never exposed here. */
  provenance?: { source: string; asOf?: string; fetchedAt: string; mode: MarketMode };
  /** Present only when the daily closes predate the last completed trading session. */
  dailyClosesNote?: string;
  live?: MarketLiveQuote;
  liveUnavailable?: string;
  unavailable?: string;
}
export interface MarketContext { mode: MarketMode; quotes: MarketQuote[] }

const PRICE_TERMS = /\b(?:price|quote|quotes|current|last|close|closing|level|trend|trending|trading|trade|high|low|52[\s-]?week|up|down|gain|gained|loss|lost|change|percent|rsi|move|moves|moving|how\s+much|done|doing|perform(?:ed|ance)?|return|returns|ytd|year[\s-]*to[\s-]*date|this\s+year|last\s+year|1[\s-]?year|one[\s-]?year)\b|%/i;
const QUESTION_SHAPE = /\?|\b(?:price|quote|level|trend|trading\s+at|last\s+close|52[\s-]?week|how\s+much|done|doing|perform(?:ed|ance)?|return|returns|ytd|this\s+year|last\s+year|1[\s-]?year|one[\s-]?year)\b/i;
const BY_TICKER = new Map(ALL_SYMBOLS.map(symbol => [symbol.ticker.toUpperCase(), symbol]));

/**
 * Resolve up to three catalog instruments mentioned in a price/level/trend question.
 * Nifty aliases map to the catalog index symbols when present.
 */
export function detectMarketSymbols(message: string): number[] {
  const text = String(message ?? '');
  if (!text.trim() || !PRICE_TERMS.test(text) || !QUESTION_SHAPE.test(text)) return [];
  if (hasStrategyActionVerb(text) && !isInformationalQuestion(text)) return [];
  const ids: number[] = [];
  const add = (id: number | undefined) => { if (id !== undefined && !ids.includes(id) && getSymbolById(id)) ids.push(id); };
  const bankNifty = /\bbank\s*nifty\b|\bnifty\s*bank\b|\bbanknifty\b/i.test(text);
  if (bankNifty) add(getSymbolByTicker('^NSEBANK')?.id);
  if (/\bnifty\s*50\b|\bnifty50\b/i.test(text) || (!bankNifty && /\bnifty\b/i.test(text))) add(getSymbolByTicker('^NSEI')?.id);
  // Full-name aliases ("Reliance Industries") use the existing whole-word resolver.
  add(resolveSymbolFromPrompt(text) ?? undefined);
  // Remaining names are matched as exact catalog names; tickers by exact token.
  const lower = text.toLowerCase();
  for (const symbol of ALL_SYMBOLS) {
    if (ids.length >= 3) break;
    if (symbol.ticker.startsWith('^') || symbol.name.length <= 3) continue;
    if (lower.includes(symbol.name.toLowerCase())) add(symbol.id);
  }
  const tokens = new Set((text.toUpperCase().match(/[A-Z0-9&.-]+/g) ?? []));
  for (const token of tokens) {
    if (ids.length >= 3) break;
    const symbol = BY_TICKER.get(token);
    if (symbol && !symbol.ticker.startsWith('^')) add(symbol.id);
  }
  return ids.slice(0, 3);
}

function displayName(ticker: string, name: string): string {
  if (ticker === '^NSEI') return 'NIFTY 50';
  if (ticker === '^NSEBANK') return 'BANK NIFTY';
  return name;
}

const IST_OFFSET_MS = 330 * 60_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Human name for a dataset source. Internal codes never reach the model or the user. */
function humanSource(source: string, mode: MarketMode): string {
  if (mode === 'demo' || source === 'DETERMINISTIC_DEMO_V1') return 'Stragy demo data (generated)';
  if (source === 'YAHOO_PUBLIC_CHART') return 'Yahoo daily close';
  if (source === 'ANGEL_SMARTAPI') return 'Angel One daily close';
  const words = source.toLowerCase().replace(/_+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Daily close';
}

function istParts(now: Date) {
  const shifted = new Date(now.getTime() + IST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(), month: shifted.getUTCMonth(), day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(), minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

/** Latest weekday session that has completed, in IST. Exchange holidays are not modelled. */
export function lastCompletedSessionDate(now: Date): string {
  const parts = istParts(now);
  const cursor = new Date(Date.UTC(parts.year, parts.month, parts.day));
  if (parts.weekday >= 1 && parts.weekday <= 5 && parts.minutes < 15 * 60 + 30) cursor.setUTCDate(cursor.getUTCDate() - 1);
  while (cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6) cursor.setUTCDate(cursor.getUTCDate() - 1);
  return cursor.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000));
}

/** Only a close older than the last completed session is stale; a weekend gap is not. */
function dailyClosesNote(lastDate: string, now: Date): string | undefined {
  const session = lastCompletedSessionDate(now);
  if (!lastDate || lastDate >= session) return undefined;
  const days = daysBetween(lastDate, session);
  return `The daily closes are ${days} day${days === 1 ? '' : 's'} old: the last close is ${formatDate(lastDate)}, before the last trading session (${formatDate(session)}).`;
}

function formatExchangeTime(timestamp: string | null): string {
  if (!timestamp) return 'time not provided';
  const at = Date.parse(timestamp);
  if (!Number.isFinite(at)) return 'time not provided';
  const shifted = new Date(at + IST_OFFSET_MS);
  const hh = String(shifted.getUTCHours()).padStart(2, '0');
  const mm = String(shifted.getUTCMinutes()).padStart(2, '0');
  return `${String(shifted.getUTCDate()).padStart(2, '0')} ${MONTHS[shifted.getUTCMonth()]} ${shifted.getUTCFullYear()}, ${hh}:${mm} IST`;
}

function istTimeLabel(timestamp: string | null): string | null {
  if (!timestamp) return null;
  const at = Date.parse(timestamp);
  if (!Number.isFinite(at)) return null;
  const shifted = new Date(at + IST_OFFSET_MS);
  const h24 = shifted.getUTCHours();
  const hour = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${hour}:${String(shifted.getUTCMinutes()).padStart(2, '0')} ${h24 < 12 ? 'am' : 'pm'}`;
}

function istDateLabel(iso: string): string | null {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  const shifted = new Date(at + IST_OFFSET_MS);
  return `${String(shifted.getUTCDate()).padStart(2, '0')} ${MONTHS[shifted.getUTCMonth()]} ${shifted.getUTCFullYear()}`;
}

function isMarketOpen(now: Date): boolean {
  const parts = istParts(now);
  return parts.weekday >= 1 && parts.weekday <= 5 && parts.minutes >= 9 * 60 + 15 && parts.minutes <= 15 * 60 + 30;
}

/** One human sentence: open with the time, or closed with the last trade. */
function liveStatusLine(timestamp: string | null, now: Date): string {
  const time = istTimeLabel(timestamp);
  const today = new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
  const quoteDate = timestamp && Number.isFinite(Date.parse(timestamp))
    ? new Date(Date.parse(timestamp) + IST_OFFSET_MS).toISOString().slice(0, 10)
    : null;
  if (isMarketOpen(now)) {
    if (time && quoteDate === today) return `As of ${time} IST.`;
    if (time && quoteDate) {
      const age = describeAge(timestamp, now);
      return `Last traded ${istDateLabel(timestamp!)} at ${time} IST${age ? ` (${age})` : ''}; the market is open.`;
    }
    return 'Angel One did not provide a trade time.';
  }
  if (!timestamp || !time) return 'Market closed at 3:30 pm IST; this is the last traded price.';
  if (quoteDate === today) return 'Market closed at 3:30 pm IST; this is the last traded price.';
  const date = istDateLabel(timestamp);
  const age = describeAge(timestamp, now);
  return `Last traded ${date} at ${time} IST${age ? ` (${age})` : ''}; the market is closed.`;
}

function describeAge(timestamp: string | null, now: Date): string | undefined {
  if (!timestamp) return undefined;
  const at = Date.parse(timestamp);
  if (!Number.isFinite(at)) return undefined;
  const minutes = Math.floor(Math.max(0, now.getTime() - at) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** Live quotes are only stale when they predate the last completed trading session. */
function liveFreshnessNote(timestamp: string | null, now: Date): string | undefined {
  if (!timestamp) return undefined;
  const at = Date.parse(timestamp);
  if (!Number.isFinite(at)) return undefined;
  const quoteDate = new Date(at + IST_OFFSET_MS).toISOString().slice(0, 10);
  const session = lastCompletedSessionDate(now);
  if (quoteDate >= session) return undefined;
  const days = daysBetween(quoteDate, session);
  return `The Angel One quote is from ${formatDate(quoteDate)}, ${days} day${days === 1 ? '' : 's'} before the last trading session (${formatDate(session)}).`;
}

/** Build compact, honest context from the observed daily loader plus optional live quotes. */
export async function buildMarketContext(ids: number[], deps: MarketContextDeps = {}): Promise<MarketContext> {
  const env = deps.env ?? process.env;
  const mode: MarketMode = deps.mode ?? (env.DATA_MODE === 'demo' ? 'demo' : 'real');
  const load: MarketSeriesLoader = deps.load ?? ((id, options) => loadMarketSeries(id, { mode: options.mode }));
  const now = deps.now ? deps.now() : new Date();
  const wanted = ids.slice(0, 3);
  const liveConfigured = (env.QUOTES_PROVIDER ?? 'none') === 'angel';

  // One live broker call at most, and never a Yahoo fallback relabelled as live.
  let liveResult: LiveQuotesResult | null = null;
  let liveFailure: string | undefined;
  if (liveConfigured && wanted.length) {
    try {
      liveResult = await (deps.live ?? (symbolIds => getLiveQuotes(symbolIds)))(wanted);
      if (!liveResult.available) liveFailure = 'Live quotes are currently unavailable from Angel One.';
    } catch {
      liveFailure = 'Live quotes are currently unavailable from Angel One.';
    }
  }

  const quotes: MarketQuote[] = [];
  for (const id of wanted) {
    const symbol = ALL_SYMBOLS.find(candidate => candidate.id === id);
    if (!symbol) continue;
    try {
      const series = await load(id, { mode });
      const bars: OHLCVBar[] = series.bars;
      if (bars.length < 2) throw new MarketDataError('INSUFFICIENT_HISTORY', 'Not enough bars');
      const last = bars[bars.length - 1];
      const previous = bars[bars.length - 2];
      const window = bars.slice(-250);
      const rsi = calcRSI(bars, 14).at(-1);
      const note = dailyClosesNote(last.date, now);
      const high = Math.max(...window.map(bar => bar.high));
      const low = Math.min(...window.map(bar => bar.low));
      // YTD compares with the last close before this calendar year; 1-year
      // compares with the last close on or before the same date last year.
      const priorYear = [...bars].reverse().find(bar => bar.date < `${last.date.slice(0, 4)}-01-01`);
      const oneYearTargetDate = new Date(last.date + 'T00:00:00Z');
      oneYearTargetDate.setUTCFullYear(oneYearTargetDate.getUTCFullYear() - 1);
      const oneYearTarget = oneYearTargetDate.toISOString().slice(0, 10);
      const oneYearBar = [...bars].reverse().find(bar => bar.date <= oneYearTarget);
      const ytdReturnPercent = priorYear && priorYear.close > 0 ? (last.close / priorYear.close - 1) * 100 : undefined;
      const oneYearReturnPercent = bars[0].date <= oneYearTarget && oneYearBar && oneYearBar.close > 0
        ? (last.close / oneYearBar.close - 1) * 100
        : undefined;
      const quote: MarketQuote = {
        symbolId: symbol.id, ticker: symbol.ticker, name: displayName(symbol.ticker, symbol.name),
        lastClose: last.close, lastDate: last.date, previousClose: previous.close,
        changePercent: previous.close > 0 ? (last.close / previous.close - 1) * 100 : undefined,
        recentCloses: bars.slice(-5).map(bar => ({ date: bar.date, close: bar.close })),
        fiftyTwoWeekHigh: high,
        fiftyTwoWeekLow: low,
        rsi14: typeof rsi === 'number' && Number.isFinite(rsi) ? rsi : null,
        ...(ytdReturnPercent !== undefined ? { ytdReturnPercent } : {}),
        ...(oneYearReturnPercent !== undefined ? { oneYearReturnPercent } : {}),
        ...(high > 0 ? { distanceFromHighPercent: ((high - last.close) / high) * 100 } : {}),
        ...(low > 0 ? { distanceFromLowPercent: ((last.close - low) / low) * 100 } : {}),
        provenance: { source: humanSource(series.provenance.source, series.provenance.mode), asOf: last.date, fetchedAt: series.provenance.fetchedAt, mode: series.provenance.mode },
        ...(note ? { dailyClosesNote: note } : {}),
      };
      const live = liveResult?.quotes.find(candidate => candidate.symbolId === id);
      if (live) {
        const freshnessNote = liveFreshnessNote(live.exchangeTimestamp, now);
        const age = describeAge(live.exchangeTimestamp, now);
        quote.live = {
          ltp: live.ltp, changePercent: live.changePercent, exchangeTime: formatExchangeTime(live.exchangeTimestamp), statusLine: liveStatusLine(live.exchangeTimestamp, now), source: 'Angel One (live)',
          ...(age ? { age } : {}),
          ...(freshnessNote ? { freshnessNote } : {}),
        };
      } else if (liveConfigured) {
        quote.liveUnavailable = liveFailure ?? 'Angel One returned no live quote for this instrument.';
      }
      quotes.push(quote);
    } catch (error) {
      const quote: MarketQuote = {
        symbolId: symbol.id, ticker: symbol.ticker, name: displayName(symbol.ticker, symbol.name), recentCloses: [],
        unavailable: error instanceof MarketDataError ? error.code : 'MARKET_DATA_UNAVAILABLE',
        ...(liveConfigured ? { liveUnavailable: liveFailure ?? 'Live quotes are currently unavailable from Angel One.' } : {}),
      };
      quotes.push(quote);
    }
  }
  return { mode, quotes };
}

const isIndexTicker = (ticker: string): boolean => ticker.startsWith('^');
const priceText = (quote: MarketQuote, value: number): string =>
  isIndexTicker(quote.ticker) ? formatINR(value).replace('₹', '') : formatINR(value);
const percentText = (value: number): string => formatPercent(value, { signed: true, decimals: 2 });

function headlineName(quote: MarketQuote): string {
  if (quote.ticker === '^NSEI') return 'Nifty 50';
  if (quote.ticker === '^NSEBANK') return 'Bank Nifty';
  return `${quote.name.replace(/\s+(?:Ltd\.?|Limited)$/i, '')} (${quote.ticker})`;
}

function rangeAndRsi(quote: MarketQuote): string {
  return [
    quote.fiftyTwoWeekLow !== undefined && quote.fiftyTwoWeekHigh !== undefined
      ? `52-week range ${priceText(quote, quote.fiftyTwoWeekLow)} – ${priceText(quote, quote.fiftyTwoWeekHigh)}`
      : '',
    quote.rsi14 !== undefined && quote.rsi14 !== null ? `RSI(14) ${formatNumber(quote.rsi14, 1)}` : '',
  ].filter(Boolean).join(' · ');
}

/**
 * Deterministic plain-language answer used when no AI provider is ready.
 * Live quotes are short, human sentences; daily history is labelled as daily closes.
 */
export function renderMarketAnswer(context: MarketContext): string {
  const parts = context.quotes.map(quote => {
    if (quote.unavailable) {
      return `**${headlineName(quote)}: price unavailable**\nMarket data is unavailable right now. No price was fabricated.`;
    }
    const live = quote.live;
    if (live) {
      const first = `**${headlineName(quote)}: ${priceText(quote, live.ltp)}** (${percentText(live.changePercent)} today) · Angel One live quote`;
      const sameAsDaily = quote.lastClose !== undefined && Math.abs(quote.lastClose - live.ltp) < 0.005;
      const daily = !sameAsDaily && quote.lastClose !== undefined && quote.lastDate
        ? `Last daily close ${priceText(quote, quote.lastClose)} on ${formatDate(quote.lastDate)}.`
        : '';
      return [first, live.statusLine, rangeAndRsi(quote), daily].filter(Boolean).join('\n');
    }
    const source = quote.provenance?.source ?? 'Daily close';
    const change = quote.changePercent === undefined ? '' : ` (${percentText(quote.changePercent)} today)`;
    const first = `**${headlineName(quote)}: ${priceText(quote, quote.lastClose!)}**${change} · ${source} · ${formatDate(quote.lastDate)}`;
    const status = context.mode === 'demo'
      ? 'Generated demo data, not observed market data.'
      : quote.liveUnavailable
        ? `${quote.liveUnavailable} This is the last daily close.`
        : 'Daily close, not a live quote.';
    return [first, status, rangeAndRsi(quote), quote.dailyClosesNote ?? ''].filter(Boolean).join('\n');
  });
  return parts.join('\n\n');
}

function barsSourceLine(quote: MarketQuote): string {
  const source = quote.provenance?.source ?? 'Daily bars';
  if (/demo/i.test(source)) return 'Generated demo data · not observed';
  if (/angel/i.test(source)) return 'Angel One daily bars · not AI';
  if (/yahoo/i.test(source)) return 'Yahoo daily bars · not AI';
  return source.replace(/\s+close$/i, '') + ' · not AI';
}

function rangeDistance(value: number | undefined, label: string): string {
  if (value === undefined || !Number.isFinite(value)) return '';
  return value < 0.005 ? `at the ${label}` : `${formatPercent(value, { decimals: 1 })} below the ${label}`;
}

function lowDistance(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '';
  return value < 0.005 ? 'at the 52-week low' : `${formatPercent(value, { decimals: 1 })} above the 52-week low`;
}

/**
 * Deterministic single-stock performance answer from observed daily bars.
 * Never invents a return when the history does not cover the window.
 */
export function renderPerformanceAnswer(context: MarketContext): string {
  return context.quotes.map(quote => {
    if (quote.unavailable || quote.lastClose === undefined || !quote.lastDate) {
      return `I couldn't load daily bars for ${headlineName(quote)}. No performance was invented.`;
    }
    const returns: string[] = [];
    if (quote.ytdReturnPercent !== undefined) returns.push(`YTD ${percentText(quote.ytdReturnPercent)}`);
    if (quote.oneYearReturnPercent !== undefined) returns.push(`1-year ${percentText(quote.oneYearReturnPercent)}`);
    const first = `**${headlineName(quote)}: ${priceText(quote, quote.lastClose)}** last close on ${formatDate(quote.lastDate)}`;
    const performance = returns.length
      ? returns.join(' · ')
      : 'Return unavailable: the daily history is shorter than the requested window.';
    const range = quote.fiftyTwoWeekHigh !== undefined && quote.fiftyTwoWeekLow !== undefined
      ? `52-week range ${priceText(quote, quote.fiftyTwoWeekLow)} – ${priceText(quote, quote.fiftyTwoWeekHigh)}; `
        + [rangeDistance(quote.distanceFromHighPercent, '52-week high'), lowDistance(quote.distanceFromLowPercent)].filter(Boolean).join(' and ') + '.'
      : '';
    return [first, performance, range, `Observed through ${formatDate(quote.lastDate)}.`, barsSourceLine(quote)].filter(Boolean).join('\n');
  }).join('\n\n');
}

