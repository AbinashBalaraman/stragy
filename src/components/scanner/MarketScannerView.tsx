import React, { useState, useEffect, useRef } from 'react';
import { StrategyAST, StockTrendData, MarketMoversData, type RuleNode, type SymbolMeta } from '../../shared/strategy/types';
import { plainRule } from '../../client/plainRules';
import { PrefillNote } from '../common/PrefillNote';
import { DataTable, type DataColumn } from '../common/DataTable';
import type { ScannerPrefill } from '../../shared/contracts/featureRegistry';
import { requestMarketSnapshot, requestScan, type ResearchJobProgress } from '../../client/api';
import { marketLoadingMessage } from './marketLoading';
import { useLiveQuotes, formatLivePrice, formatLiveChange, liveQuoteTime, liveQuoteTimeTitle, type LiveQuote } from '../../client/liveQuotes';
import { actualDataCutoff, scannerContextKey, ScannerRequestOwner } from './scannerRequestContext';
import { OptionChainScanner } from './OptionChainScanner';
import { VolumeProfileScanner } from './VolumeProfileScanner';
import { GttBracketCalculator } from './GttBracketCalculator';
import { BasisSpreadScanner } from './BasisSpreadScanner';
import { TradingCalendarModal, TradingSessionDate } from './TradingCalendarModal';
import {
  Radio,
  Search,
  CheckCircle2,
  TrendingUp,
  TrendingDown,
  Zap,
  Activity,
  Flame,
  Filter,
  BarChart2,
  RefreshCw,
  Gauge,
  Layers,
  ShieldAlert,
  Clock,
  Sparkles,
  Info,
  ChevronDown,
  TrendingUpDown,
  Compass,
  FileCode2,
  Server,
  Calculator,
  Calendar
} from 'lucide-react';

/** Price provenance is separate from model-only derivatives and universe membership. */
function priceDataLabel(data: unknown): string {
  if (!data || typeof data !== 'object') return 'Price source not yet reported';
  const result = data as { mode?: string; provenance?: { mode?: string } | { mode?: string }[]; matches?: { provenance?: { mode?: string } }[]; sourceCoverage?: Record<string, number>; dataSource?: string; coverage?: { succeeded?: number }; succeeded?: number };
  if ((result.coverage?.succeeded ?? result.succeeded) === 0) return 'Price data unavailable: no evaluated coverage';
  const modes = new Set<string>();
  if (result.mode) modes.add(result.mode);
  const provenance = Array.isArray(result.provenance) ? result.provenance : result.provenance ? [result.provenance] : [];
  for (const item of [...provenance, ...(result.matches || []).map(match => match.provenance)]) if (item?.mode) modes.add(item.mode);
  for (const [source, count] of Object.entries(result.sourceCoverage || {})) if (count > 0 && (source === 'real' || source === 'demo')) modes.add(source);
  if (modes.has('real') && modes.has('demo')) return 'Mixed observed and demo OHLCV · not live';
  if (modes.has('demo')) return 'Demo OHLCV · not observed market prices';
  if (modes.has('real')) return 'Observed OHLCV · not a live tick feed';
  if (/demo/i.test(result.dataSource || '')) return 'Demo OHLCV · not observed market prices';
  return 'Price source not reported; observed coverage unverified';
}

const SOURCE_LABELS: Record<string, string> = {
  YAHOO_PUBLIC_CHART: 'Yahoo public chart',
  PROVENANCE_PER_SYMBOL: 'per-symbol provenance',
  ANGEL_SMARTAPI: 'Angel One SmartAPI',
  DEMO_MODEL: 'Demo model',
  DETERMINISTIC_DEMO_V1: 'Deterministic demo model',
};

/** Human-readable source coverage. Raw JSON never reaches the banner. */
function sourceSummary(coverage?: Record<string, number>): string {
  const entries = Object.entries(coverage ?? {}).filter(([, count]) => count > 0);
  if (!entries.length) return 'Source: not reported';
  const labels = entries.map(([source, count]) => (SOURCE_LABELS[source] ?? source.toLowerCase().replace(/_/g, ' ')) + ' (' + count + ')');
  return (entries.length === 1 ? 'Source: ' : 'Sources: ') + labels.join(', ');
}

/** Compact volume or a plain value for evidence lines. */
function compactEvidence(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'unavailable';
  const absolute = Math.abs(value);
  if (absolute >= 1e7) return (value / 1e7).toLocaleString('en-IN', { maximumFractionDigits: 2 }) + ' Cr';
  if (absolute >= 1e5) return (value / 1e5).toLocaleString('en-IN', { maximumFractionDigits: 2 }) + ' L';
  return scannerNumber(value);
}

/** Price rules show ₹, volume rules compact, oscillators plain. */
function evidenceFormatter(rule: RuleNode | undefined, indicators: StrategyAST['indicators']) {
  const right = rule?.rightIndicator ? indicators.find(indicator => indicator.id === rule.rightIndicator) : undefined;
  const volume = rule?.leftIndicator === 'volume' || rule?.rightIndicator === 'volume' || right?.type === 'VOLUME_SMA';
  const priceSeries = new Set(['close', 'open', 'high', 'low']);
  const price = !volume && !!rule && (priceSeries.has(rule.leftIndicator) || (!!right && ['SUPERTREND', 'EMA', 'SMA', 'ATR', 'BBANDS'].includes(right.type)));
  return (value: number | null | undefined): string => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'unavailable';
    if (volume) return compactEvidence(value);
    if (price) return '₹' + value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return scannerNumber(value);
  };
}

/** "Angel One daily bars", "Yahoo public daily bars" — never a raw source code. */
function scanSourceLine(result: { sourceCoverage?: Record<string, number>; dataSource?: string }): string {
  const entries = Object.entries(result.sourceCoverage ?? {}).filter(([, count]) => count > 0);
  const source = entries[0]?.[0] ?? result.dataSource ?? '';
  if (/angel/i.test(source)) return 'Angel One daily bars';
  if (/yahoo/i.test(source)) return 'Yahoo public daily bars';
  if (/demo/i.test(source)) return 'Demo daily bars';
  return 'Daily bars';
}

/** "2026-11-16" -> "16 Nov 2026". */
function fullDay(iso: string | null | undefined): string {
  if (!iso) return 'session unavailable';
  const date = new Date(iso + 'T00:00:00Z');
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
    : iso;
}

/** "2026-11-16" -> "16 Nov"; never an ambiguous MM-DD. */
function shortDay(iso: string | null | undefined): string {
  if (!iso) return 'the latest session';
  const formatted = iso.match(/^(\d{1,2}) ([A-Za-z]{3}) (\d{4})$/);
  if (formatted) return formatted[1].padStart(2, '0') + ' ' + formatted[2];
  const date = new Date(iso + 'T00:00:00Z');
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' })
    : iso;
}

const istClock = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
};

/** Row-level quote meta: the full line when it adds numbers, a time-only tag when it repeats the EOD close. */
/** A row only repeats the live overlay when it differs from the EOD close the row already shows. */
const QuoteMeta: React.FC<{ quote: LiveQuote; eodClose?: number; className?: string }> = ({ quote, eodClose, className = '' }) => {
  const sameAsClose = typeof eodClose === 'number' && Math.abs(quote.ltp - eodClose) < 0.005;
  if (sameAsClose) return null;
  return <LiveQuoteLine quote={quote} eodClose={eodClose} className={className} />;
};

const LiveQuoteLine: React.FC<{ quote: LiveQuote; eodClose?: number; className?: string }> = ({ quote, eodClose, className = '' }) => {
  const sameAsClose = typeof eodClose === 'number' && Math.abs(quote.ltp - eodClose) < 0.005;
  const clock = istClock(quote.exchangeTimestamp ?? quote.fetchedAt);
  const afterClose = clock !== null && clock >= '15:30';
  const closeFeed = sameAsClose || afterClose;
  return (
    <div className={'flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] ' + className} title={liveQuoteTimeTitle(quote)}>
      <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-semibold ${closeFeed ? 'border-sky-400/25 bg-sky-400/10 text-sky-200' : 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300'}`}>
        <span aria-hidden="true" className={`h-1 w-1 rounded-full ${closeFeed ? 'bg-sky-400' : 'bg-emerald-400'}`} />
        {closeFeed ? 'Close (live feed)' : 'Live'}
      </span>
      <span className="st-tnum font-semibold text-white">{formatLivePrice(quote.ltp)}</span>
      <span className={`st-tnum font-semibold ${quote.changePercent >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
        {formatLiveChange(quote.changePercent)}
      </span>
      <span className="st-tnum text-[var(--text-3)]">{liveQuoteTime(quote)}</span>
    </div>
  );
};

const scannerNumber = (value: number | null | undefined, digits = 2): string =>
  typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits })
    : 'Unavailable';
const scannerPrice = (value: number | null | undefined): string => {
  const text = scannerNumber(value, 2);
  return text === 'Unavailable' ? text : '₹' + text;
};
const scannerPercent = (value: number | null | undefined, digits = 2): string =>
  typeof value === 'number' && Number.isFinite(value) ? (value > 0 ? '+' : '') + value.toFixed(digits) + '%' : 'Unavailable';
const scannerMultiple = (value: number | null | undefined, digits = 1): string =>
  typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) + 'x' : 'Unavailable';
const scannerDateTime = (value: string | null | undefined): string => {
  if (!value) return 'time unavailable';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'time unavailable';
  return date.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) + ' IST';
};

const ScannerLoadingState: React.FC<{ message: string }> = ({ message }) => (
  <div role="status" aria-live="polite" className="rounded-[var(--r-card)] border border-[var(--line)] bg-[var(--surface-1)] px-4 py-10 text-center">
    <p className="text-sm text-[var(--text-1)]">{message}</p>
    <p className="mt-1 text-xs text-[var(--text-3)]">No partial rankings are shown while prices load.</p>
  </div>
);

interface MarketScannerViewProps {
  strategy: StrategyAST;
  /** Local instrument catalog, used to name an unpriced symbol by ticker. */
  symbols?: SymbolMeta[];
  onSelectStockAndBacktest: (symbolId: number, asOf: string) => void;
  /** A validated setup handed over by chat or another feature. */
  prefill?: ScannerPrefill | null;
  onPrefillDismiss?: () => void;
  /** Remembered universe from user preferences. */
  initialUniverse?: MarketUniverseType;
  onUniverseChange?: (universe: MarketUniverseType) => void;
}

export type MarketUniverseType =
  | 'ALL'
  | 'NSE'
  | 'BSE'
  | 'NIFTY_50'
  | 'BANK_NIFTY'
  | 'NIFTY_IT'
  | 'NIFTY_AUTO'
  | 'NIFTY_PHARMA'
  | 'NIFTY_METAL'
  | 'NIFTY_FMCG'
  | 'BSE_SENSEX'
  | 'POPULAR_INDICES';

interface UniverseConfig {
  id: MarketUniverseType;
  label: string;
  shortLabel: string;
  category: 'Exchange' | 'Benchmark & Sector Indices' | 'All';
  description: string;
  badge: string;
}

export const UNIVERSE_LIST: UniverseConfig[] = [
  { id: 'ALL', label: 'All configured markets (NSE + BSE)', shortLabel: 'All (NSE+BSE)', category: 'All', description: 'Configured NSE/BSE universe; current membership and partial data coverage', badge: 'NSE + BSE' },
  { id: 'NSE', label: 'Configured NSE Stocks', shortLabel: 'NSE universe', category: 'Exchange', description: 'Configured National Stock Exchange equities; partial coverage', badge: 'NSE' },
  { id: 'BSE', label: 'All BSE Stocks (SENSEX & Large-Caps)', shortLabel: 'All BSE', category: 'Exchange', description: 'Bombay Stock Exchange (BSE) listed equities', badge: 'BSE' },
  { id: 'NIFTY_50', label: 'Configured NIFTY 50-labelled pool', shortLabel: 'Nifty 50', category: 'Benchmark & Sector Indices', description: 'Bounded configured pool; current NIFTY 50 membership and count are unverified', badge: 'NIFTY 50' },
  { id: 'BANK_NIFTY', label: 'Bank NIFTY', shortLabel: 'Bank Nifty', category: 'Benchmark & Sector Indices', description: 'Leading private and PSU banking giants', badge: 'BANK' },
  { id: 'NIFTY_IT', label: 'NIFTY IT', shortLabel: 'NIFTY IT', category: 'Benchmark & Sector Indices', description: 'Top technology & software exporters', badge: 'IT' },
  { id: 'NIFTY_AUTO', label: 'NIFTY Auto', shortLabel: 'NIFTY Auto', category: 'Benchmark & Sector Indices', description: 'Leading automotive, 2-wheeler, EV & commercial vehicle OEMs', badge: 'AUTO' },
  { id: 'NIFTY_PHARMA', label: 'NIFTY Pharma', shortLabel: 'NIFTY Pharma', category: 'Benchmark & Sector Indices', description: 'Top pharmaceutical & healthcare leaders', badge: 'PHARMA' },
  { id: 'NIFTY_METAL', label: 'NIFTY Metal', shortLabel: 'NIFTY Metal', category: 'Benchmark & Sector Indices', description: 'Steel, aluminium, mining & base metal companies', badge: 'METAL' },
  { id: 'NIFTY_FMCG', label: 'NIFTY FMCG', shortLabel: 'NIFTY FMCG', category: 'Benchmark & Sector Indices', description: 'Fast-moving consumer goods & household staples', badge: 'FMCG' },
  { id: 'BSE_SENSEX', label: 'BSE SENSEX 30', shortLabel: 'BSE Sensex', category: 'Benchmark & Sector Indices', description: 'BSE flagship 30 well-established companies', badge: 'SENSEX' },
  { id: 'POPULAR_INDICES', label: 'Popular Indices', shortLabel: 'Major Indices', category: 'Benchmark & Sector Indices', description: 'All major benchmark & sectoral market indices (^NSEI, ^NSEBANK, ^BSESN, etc.)', badge: 'INDICES' }
];

export const MarketScannerView: React.FC<MarketScannerViewProps> = ({
  strategy,
  symbols = [],
  onSelectStockAndBacktest,
  prefill: incomingPrefill,
  onPrefillDismiss,
  initialUniverse,
  onUniverseChange
}) => {
  const [activeTab, setActiveTab] = useState<
    | 'movers'
    | 'volume_52w'
    | 'derivatives_oi'
    | 'option_chain'
    | 'volume_profile'
    | 'gtt_bracket'
    | 'basis_spreads'
    | 'breadth_sectors'
    | 'trends'
    | 'strategy_matches'
  >('movers');
  const [selectedUniverse, setSelectedUniverse] = useState<MarketUniverseType>(() =>
    initialUniverse && UNIVERSE_LIST.some(item => item.id === initialUniverse) ? initialUniverse : 'NIFTY_50');
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [isCalendarModalOpen, setIsCalendarModalOpen] = useState<boolean>(false);
  const [moreTabsOpen, setMoreTabsOpen] = useState(false);
  const [scanLimit, setScanLimit] = useState(35);
  const [scanSlow, setScanSlow] = useState(false);
  const [marketSlow, setMarketSlow] = useState(false);
  const [prefill, setPrefill] = useState<ScannerPrefill | null>(null);
  const appliedPrefill = useRef<ScannerPrefill | null>(null);
  const [availableTradingDates, setAvailableTradingDates] = useState<TradingSessionDate[]>([]);
  const [trendFilter, setTrendFilter] = useState<'ALL' | 'BULLISH' | 'OVERSOLD' | 'BREAKOUT' | 'GOLDEN_CROSS'>('ALL');
  const [trendSearchQuery, setTrendSearchQuery] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [isLoadingTrends, setIsLoadingTrends] = useState(false);
  const [scanResult, setScanResult] = useState<Awaited<ReturnType<typeof requestScan>> | null>(null);
  const [trends, setTrends] = useState<StockTrendData[]>([]);
  const [movers, setMovers] = useState<MarketMoversData | null>(null);

  const marketOwner = useRef(new ScannerRequestOwner());
  const scanOwner = useRef(new ScannerRequestOwner());
  const isStrategyView = activeTab === 'strategy_matches';
  // Displaying an observed cutoff must not change the requested context.
  const contextKey = isStrategyView
    ? scannerContextKey(strategy, selectedUniverse, selectedDate)
    : JSON.stringify(['market', selectedUniverse, selectedDate]);
  const currentContext = useRef(contextKey);
  currentContext.current = contextKey;
  const [dataCutoff, setDataCutoff] = useState('');
  const [latestDataCutoff, setLatestDataCutoff] = useState('');
  const [scannerError, setScannerError] = useState('');
  const [marketError, setMarketError] = useState('');
  const [marketProgress, setMarketProgress] = useState<ResearchJobProgress | null>(null);
  const [marketCoverage, setMarketCoverage] = useState<{ requested: number; succeeded: number; unavailable: number } | null>(null);
  const [marketUnavailable, setMarketUnavailable] = useState<Array<{ symbolId: number; ticker?: string }>>([]);
  const [scanError, setScanError] = useState('');
  const [coverageLabel, setCoverageLabel] = useState('Coverage not yet reported');
  const [coverageDetail, setCoverageDetail] = useState('Coverage details not yet reported.');
  const [dataEvidence,setDataEvidence] = useState<{mode?:'real'|'demo';membership?:Awaited<ReturnType<typeof requestMarketSnapshot>>['membership'];observationDates?:Awaited<ReturnType<typeof requestMarketSnapshot>>['observationDates'];sourceCoverage?:Record<string,number>}|null>(null);
  const [priceLabel, setPriceLabel] = useState('Price source not yet reported');
  const [marketEvaluated, setMarketEvaluated] = useState(0);
  const launchBacktest = (symbolId: number, observedDate?: string) => {
    if (contextKey !== currentContext.current) return;
    const cutoff = observedDate || dataCutoff;
    if (!cutoff) { setScannerError('Data cutoff unavailable. Reload the scanner.'); return; }
    onSelectStockAndBacktest(symbolId, selectedDate && selectedDate < cutoff ? selectedDate : cutoff);
  };

  const coveredTradingDates = availableTradingDates.filter(session => !latestDataCutoff || session.date <= latestDataCutoff).map(session => ({...session, label: session.date, fullLabel: session.date + ' (calendar session; price coverage may be partial)', isLatest: session.date === latestDataCutoff}));

  // Active universe metadata
  const baseUniverseConfig = UNIVERSE_LIST.find(u => u.id === selectedUniverse) || UNIVERSE_LIST[0];
  const officialMembership = dataEvidence?.mode === 'real' && dataEvidence.membership?.source === 'https://nsearchives.nseindia.com/content/indices/ind_nifty50list.csv';
  const currentUniverseConfig = selectedUniverse === 'NIFTY_50' && officialMembership ? {...baseUniverseConfig,label:'NIFTY 50 (official constituent feed)',description:'Official NSE constituent feed retrieved '+scannerDateTime(dataEvidence?.membership?.observedAt)+'. Historical research uses current constituents and has survivorship bias.'} : baseUniverseConfig;

  // Fetch available trading session dates on mount
  useEffect(() => {
    const abort = new AbortController();
    fetch('/api/market/dates', { signal: abort.signal })
      .then(r => r.json())
      .then(data => {
        if (data && data.success && Array.isArray(data.dates)) {
          setAvailableTradingDates(data.dates);
        }
      })
      .catch(() => {});
    return () => abort.abort();
  }, []);

  const recordCutoff = (data: unknown) => {
    const cutoff = actualDataCutoff(data);
    if (cutoff) {
      setDataCutoff(cutoff);
      if (!selectedDate) setLatestDataCutoff(cutoff);
    }
  };

  const fetchMarketData = async () => {
    const ticket = marketOwner.current.begin(contextKey);
    setIsLoadingTrends(true);
    setMarketError(''); setScannerError('');
    setMarketProgress(null);
    setMarketCoverage(null); setMarketUnavailable([]);
    setTrends([]); setMovers(null); setDataCutoff(''); setMarketEvaluated(0);
    setPriceLabel('Price source not yet reported');
    setCoverageLabel('Coverage not yet reported');setCoverageDetail('Coverage details not yet reported.');setDataEvidence(null);
    try {
      const data = await requestMarketSnapshot({ universe: selectedUniverse, asOf: selectedDate || undefined }, ticket.signal, setMarketProgress);
      if (!marketOwner.current.owns(ticket, currentContext.current)) return;
      if (data.coverage.succeeded > 0) recordCutoff(data);
      setTrends(data.trends);setDataEvidence(data);
      setMovers(data.coverage.succeeded > 0 ? data.movers || null : null);
      setMarketEvaluated(data.coverage.succeeded);
      setPriceLabel(priceDataLabel(data));
      setCoverageLabel(data.coverage ? `Coverage: ${data.coverage.succeeded} of ${data.coverage.requested} symbols` : 'Coverage not reported; current membership, not full exchange coverage');
      setCoverageDetail(data.coverage ? `${data.coverage.succeeded} of ${data.coverage.requested} symbols evaluated; ${data.coverage.unavailable} unavailable.` : 'Coverage was not reported.');
      setMarketCoverage(data.coverage ?? null);
      setMarketUnavailable(data.errors.map(error => ({ symbolId: error.symbolId, ...(error.ticker ? { ticker: error.ticker } : {}) })));
      if (data.movers?.availableTradingSessions?.length) setAvailableTradingDates(data.movers.availableTradingSessions);
    } catch (e) {
      if (marketOwner.current.owns(ticket, currentContext.current)) setMarketError(e instanceof Error ? e.message : 'Market data unavailable');
    } finally {
      if (marketOwner.current.owns(ticket, currentContext.current)) setIsLoadingTrends(false);
    }
  };

  const runScan = async () => {
    const ticket = scanOwner.current.begin(contextKey);
    setIsScanning(true);
    setScanError(''); setScannerError(''); setScanResult(null); setDataCutoff('');
    setPriceLabel('Price source not yet reported');
    setCoverageLabel('Coverage not yet reported');setCoverageDetail('Coverage details not yet reported.');setDataEvidence(null);
    try {
      const data = await requestScan({ universe: selectedUniverse, strategy, limit: scanLimit, asOf: selectedDate || undefined }, ticket.signal);
      if (!scanOwner.current.owns(ticket, currentContext.current)) return;
      setScanResult(data);setDataEvidence(data);
      setPriceLabel(priceDataLabel(data));
      if (data.succeeded > 0) recordCutoff(data);
      setCoverageLabel(`Coverage: ${data.succeeded} of ${data.requested} symbols`);
      setCoverageDetail(`${data.succeeded} of ${data.requested} evaluated; ${data.unavailable} unavailable; ${data.failed} failed.`);
    } catch (e) {
      if (scanOwner.current.owns(ticket, currentContext.current)) setScanError(e instanceof Error ? e.message : 'Scan unavailable');
    } finally {
      if (scanOwner.current.owns(ticket, currentContext.current)) setIsScanning(false);
    }
  };

  // A cold Angel scan is rate-limited; say so after 30s instead of looking stuck.
  useEffect(() => {
    if (!isScanning) { setScanSlow(false); return; }
    const timer = setTimeout(() => setScanSlow(true), 30_000);
    return () => clearTimeout(timer);
  }, [isScanning]);

  // The market snapshot can also take longer than ten seconds on a cold cache.
  useEffect(() => {
    if (!isLoadingTrends) { setMarketSlow(false); return; }
    const timer = setTimeout(() => setMarketSlow(true), 10_000);
    return () => clearTimeout(timer);
  }, [isLoadingTrends]);

  // A chat hand-off fills the universe, cutoff and scan size, then opens the matches.
  useEffect(() => {
    if (!incomingPrefill || appliedPrefill.current === incomingPrefill) return;
    appliedPrefill.current = incomingPrefill;
    setPrefill(incomingPrefill);
    if (UNIVERSE_LIST.some(item => item.id === incomingPrefill.universe)) setSelectedUniverse(incomingPrefill.universe as MarketUniverseType);
    setScanLimit(incomingPrefill.limit);
    setActiveTab('strategy_matches');
  }, [incomingPrefill]);

  // Apply the hand-off cutoff once the session list can confirm it is an observed date.
  useEffect(() => {
    if (!prefill) return;
    if (!prefill.asOf) { setSelectedDate(''); return; }
    if (!availableTradingDates.length) return;
    setSelectedDate(availableTradingDates.some(item => item.date === prefill.asOf) ? prefill.asOf : '');
  }, [prefill, availableTradingDates]);

  useEffect(() => {
    setTrends([]); setMovers(null); setScanResult(null); setDataCutoff(''); setMarketEvaluated(0);
    setPriceLabel('Price source not yet reported');
    setScannerError(''); setMarketError(''); setScanError('');
    setIsScanning(false); setIsLoadingTrends(false);
    setCoverageLabel('Coverage not yet reported');setCoverageDetail('Coverage details not yet reported.');setDataEvidence(null);
    if (isStrategyView) void runScan();
    else void fetchMarketData();
    return () => { marketOwner.current.cancel(); scanOwner.current.cancel(); };
  }, [contextKey]);

  const retryActiveView = () => { if (isStrategyView) void runScan(); else void fetchMarketData(); };
  const activeError = isStrategyView ? scanError : marketError;
  const unavailableNames = marketUnavailable.map(error => error.ticker || symbols.find(item => item.id === error.symbolId)?.ticker || `symbol ${error.symbolId}`);
  const activePending = isStrategyView ? isScanning : isLoadingTrends;
  const initialLoading = !dataEvidence && !activeError;

  const handleUniverseChange = (newUniv: MarketUniverseType) => {
    if (newUniv === selectedUniverse) return;
    marketOwner.current.cancel(); scanOwner.current.cancel();
    setSelectedUniverse(newUniv);
    onUniverseChange?.(newUniv);
  };

  const handleDateChange = (newDate: string) => {
    if (newDate === selectedDate) return;
    marketOwner.current.cancel(); scanOwner.current.cancel();
    setSelectedDate(newDate);
  };

  // Filter trends based on active filter chip and search query
  const filteredTrends = trends.filter(t => {
    if (trendSearchQuery.trim()) {
      const q = trendSearchQuery.toLowerCase().trim();
      const match =
        t.ticker.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q) ||
        t.sector.toLowerCase().includes(q);
      if (!match) return false;
    }
    if (trendFilter === 'BULLISH') return t.trend === 'STRONG_BULLISH' || t.trend === 'BULLISH';
    if (trendFilter === 'OVERSOLD') return t.trend === 'OVERSOLD_REVERSAL' || t.rsi < 40;
    if (trendFilter === 'BREAKOUT') return t.signal === 'BUY_BREAKOUT';
    if (trendFilter === 'GOLDEN_CROSS') return t.signal === 'GOLDEN_CROSS';
    return true;
  });

  const trendColumns: DataColumn<StockTrendData>[] = [
    {
      key: 'symbol',
      header: 'Symbol',
      className: 'max-sm:max-w-[190px]',
      render: t => (
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm font-medium text-[var(--text-1)]">{t.ticker}</span>
            <span className="text-[11px] text-[var(--text-3)]">{t.sector}</span>
          </div>
          <p className="max-sm:hidden truncate text-[11px] text-[var(--text-3)]">{t.name}</p>
          <p className="line-clamp-2 text-[11px] text-[var(--text-3)] sm:hidden">{t.trendLabel}</p>
        </div>
      ),
    },
    { key: 'close', header: 'Close ₹', align: 'right', render: t => scannerPrice(t.ltp) },
    {
      key: 'change',
      header: 'Change',
      align: 'right',
      hideOnMobile: true,
      render: t => <span className={t.changePercent >= 0 ? 'text-[var(--up)]' : 'text-[var(--down)]'}>{scannerPercent(t.changePercent)}</span>,
    },
    {
      key: 'live',
      header: 'Live',
      align: 'right',
      hideOnMobile: true,
      render: t => {
        const quote = liveQuoteFor(t.id);
        return quote
          ? <span className="text-[var(--text-2)]" title={liveQuoteTimeTitle(quote)}>{formatLivePrice(quote.ltp)}</span>
          : <span className="text-[var(--text-3)]">—</span>;
      },
    },
    { key: 'regime', header: 'Regime', hideOnMobile: true, render: t => <span className="text-[var(--text-2)]">{t.trendLabel}</span> },
    { key: 'rsi', header: 'RSI', align: 'right', hideOnMobile: true, render: t => scannerNumber(t.rsi, 1) },
    {
      key: 'action',
      header: 'Action',
      align: 'right',
      render: t => (
        <button
          type="button"
          onClick={() => launchBacktest(t.id, t.date)}
          className="inline-flex min-h-9 items-center rounded-[var(--r-btn)] border border-[var(--line)] px-2.5 py-1 text-xs text-[var(--text-2)] transition-colors hover:border-[var(--line-strong)] hover:text-[var(--text-1)]"
          aria-label={'Backtest ' + t.ticker}
        >
          Backtest
        </button>
      ),
    },
  ];

  // Up to 10 visible cards: top five gainers + top five losers, or ten trend cards.
  const moverQuoteIds = [
    ...(movers?.topGainers ?? []).slice(0, 5).map(stock => stock.id),
    ...(movers?.topLosers ?? []).slice(0, 5).map(stock => stock.id),
  ];
  const trendQuoteIds = filteredTrends.slice(0, 10).map(trend => trend.id);
  const hasLiveOverlay = activeTab === 'movers' || activeTab === 'trends';
  const liveQuoteIds = activeTab === 'movers' ? moverQuoteIds : activeTab === 'trends' ? trendQuoteIds : [];
  const liveQuotes = useLiveQuotes(Array.from(new Set(liveQuoteIds)).slice(0, 10), {
    enabled: !isStrategyView && (activeTab === 'movers' || activeTab === 'trends'),
  });
  const liveQuoteFor = (symbolId: number) => liveQuotes.quotes.find(quote => quote.symbolId === symbolId);
  const rankingSession = movers?.formattedDate || movers?.asOfDate || dataCutoff || 'latest observed session';
  const latestOnlyView = ['option_chain', 'volume_profile', 'gtt_bracket', 'basis_spreads'].includes(activeTab);
  const latestSessionSelected = !selectedDate || (!!latestDataCutoff && selectedDate === latestDataCutoff);
  const latestOnlyUnavailable = latestOnlyView && !latestSessionSelected;
  const modelModeUnavailable = latestOnlyView && !latestOnlyUnavailable && dataEvidence?.mode === 'real';
  const modelOnlyTabs = ['option_chain', 'volume_profile', 'gtt_bracket', 'basis_spreads'];
  const modelOnlyTab = modelOnlyTabs.includes(activeTab);
  const modelPending = modelOnlyTab && !dataEvidence;
  const latestOnlyLabel = activeTab === 'option_chain' ? 'Option chain & Greeks'
    : activeTab === 'volume_profile' ? 'Volume profile & VWAP'
      : activeTab === 'gtt_bracket' ? 'GTT bracket & trailing stop'
        : 'Basis & calendar spreads';

  return (
    <div className="w-full max-w-6xl mx-auto p-3 sm:p-5 space-y-4 pb-24">
      {scannerError && <div role="alert" className="rounded-xl border border-rose-400/25 bg-rose-400/[0.04] px-3 py-2 text-xs text-rose-200">{scannerError}</div>}
      {activeError && <div role="alert" className="flex flex-wrap items-center gap-2 rounded-xl border border-rose-400/25 bg-rose-400/[0.04] px-3 py-2 text-xs text-rose-200">
        <span>{isStrategyView ? 'Strategy scan unavailable: ' : 'Market snapshot unavailable: '}{activeError}</span>
        <button type="button" onClick={retryActiveView} disabled={activePending} className="underline underline-offset-2 hover:text-rose-100">Retry {isStrategyView ? 'strategy scan' : 'market snapshot'}</button>
      </div>}

      {/* One quiet provenance line; everything else lives under Data details. */}
      <section aria-label="Market scanner header" className="space-y-4 rounded-2xl border border-white/10 bg-[#141416] p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-tight text-neutral-100">Market scanner</h2>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-400">
              <span className="text-neutral-200">{currentUniverseConfig.shortLabel}</span>
              <span aria-hidden="true">·</span>
              <span>{initialLoading ? 'end-of-day loading…' : 'end-of-day ' + (movers?.formattedDate || fullDay(movers?.asOfDate || dataCutoff))}</span>
              {hasLiveOverlay && (
                <>
                  <span aria-hidden="true">·</span>
                  {liveQuotes.connected ? (
                    <span className="flex items-center gap-1.5 text-emerald-300/90">
                      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      live prices from Angel One
                    </span>
                  ) : liveQuotes.loading || initialLoading ? (
                    <span className="text-neutral-500">checking live prices…</span>
                  ) : (
                    <span className="text-neutral-500">live prices unavailable</span>
                  )}
                </>
              )}
            </p>
            {dataEvidence && marketCoverage && marketUnavailable.length > 0 && (
              <p className="mt-1 text-[11px] leading-5 text-[var(--text-3)]">
                {marketCoverage.succeeded} of {marketCoverage.requested} stocks priced
                {' · '}
                {unavailableNames.length <= 3 ? unavailableNames.join(', ') + ' unavailable' : `${unavailableNames.length} unavailable`}
              </p>
            )}
            {dataEvidence && marketCoverage && marketUnavailable.length > 3 && (
              <details className="mt-1 text-[11px] leading-5 text-[var(--text-3)]">
                <summary className="w-fit cursor-pointer hover:text-[var(--text-2)]">Which symbols</summary>
                <p className="mt-1">{unavailableNames.join(', ')}</p>
              </details>
            )}
            {dataEvidence && (
              <details className="mt-2 text-[11px] leading-5 text-neutral-500">
                <summary className="cursor-pointer hover:text-neutral-300">Data details</summary>
                <div className="mt-1.5 max-w-3xl space-y-1 text-neutral-400">
                  <p>{priceLabel} · {coverageLabel} · {sourceSummary(dataEvidence?.sourceCoverage)}</p>
                  <p>Date: {dataCutoff ? fullDay(dataCutoff) : 'Date unavailable'}</p>
                  <p>Ranks use the {rankingSession} end-of-day session; live LTPs are a separate Angel One overlay.</p>
                  <p>Universe: {currentUniverseConfig.label}</p>
                  <p>{currentUniverseConfig.description}</p>
                  <p>Derivatives/OI/PCR and related model fields are model-only, not observed derivatives or live quotes. Universe membership is unverified unless explicitly reported; current membership may introduce survivorship bias.</p>
                  <p>Coverage detail: {coverageDetail} {sourceSummary(dataEvidence?.sourceCoverage)}.</p>
                  {dataEvidence?.observationDates && <p>Observed sessions: {dataEvidence.observationDates.earliest} to {dataEvidence.observationDates.latest}; stale datasets: {dataEvidence.observationDates.staleSymbols}.</p>}
                  {dataEvidence?.membership && <p>Membership source: {dataEvidence.membership.source}; retrieved {scannerDateTime(dataEvidence.membership.observedAt)}; {dataEvidence.membership.freshness}.</p>}
                </div>
              </details>
            )}
          </div>
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              retryActiveView();
            }}
            disabled={activePending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-neutral-200 transition-colors hover:border-[#a8c7fa]/40 hover:bg-white/[0.04] disabled:opacity-50"
          >
            <RefreshCw className={'h-3.5 w-3.5 ' + (activePending ? 'animate-spin' : '')} aria-hidden="true" />
            {activePending ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        {/* One universe picker and one session picker. */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="flex min-w-0 items-center gap-2 text-xs text-neutral-400">
            <Filter className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="shrink-0">Universe</span>
            <select
              aria-label="Market universe"
              value={selectedUniverse}
              onChange={(e) => handleUniverseChange(e.target.value as MarketUniverseType)}
              className="min-w-0 flex-1 rounded-lg border border-white/12 bg-[#101012] px-2.5 py-1.5 text-xs text-neutral-100 focus:outline-none focus:border-[#a8c7fa]/60"
            >
              <optgroup label="Broad and exchanges">
                <option value="ALL">All markets (NSE + BSE)</option>
                <option value="NSE">All NSE stocks</option>
                <option value="BSE">All BSE stocks</option>
              </optgroup>
              <optgroup label="Benchmark indices">
                <option value="NIFTY_50">Nifty 50</option>
                <option value="BANK_NIFTY">Bank NIFTY</option>
                <option value="BSE_SENSEX">BSE SENSEX 30</option>
                <option value="POPULAR_INDICES">Popular indices</option>
              </optgroup>
              <optgroup label="Sectoral indices">
                <option value="NIFTY_IT">NIFTY IT</option>
                <option value="NIFTY_AUTO">NIFTY Auto</option>
                <option value="NIFTY_PHARMA">NIFTY Pharma</option>
                <option value="NIFTY_METAL">NIFTY Metal</option>
                <option value="NIFTY_FMCG">NIFTY FMCG</option>
              </optgroup>
            </select>
          </label>

          <div className="flex min-w-0 items-center gap-2 text-xs text-neutral-400">
            <label htmlFor="scanner-session" className="shrink-0">Date</label>
            <select
              id="scanner-session"
              aria-label="Trading date"
              value={selectedDate}
              onChange={(e) => handleDateChange(e.target.value)}
              className="min-w-0 flex-1 truncate rounded-lg border border-white/12 bg-[#101012] px-2.5 py-1.5 text-xs text-neutral-100 focus:outline-none focus:border-[#a8c7fa]/60"
            >
              <option value="">Latest close</option>
              {coveredTradingDates.map((item) => (
                <option key={item.date} value={item.date}>{item.label}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setIsCalendarModalOpen(true)}
              aria-label="Open trading session calendar"
              title="Open trading session calendar"
              className="shrink-0 rounded-lg border border-white/12 bg-[#101012] p-1.5 text-neutral-300 hover:bg-white/5"
            >
              <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            {selectedDate && selectedDate !== coveredTradingDates[0]?.date && (
              <button
                type="button"
                onClick={() => handleDateChange('')}
                className="shrink-0 rounded-lg border border-white/12 px-2 py-1.5 text-[10px] font-medium text-neutral-300 hover:bg-white/5"
                title="Reset to latest available data cutoff"
              >
                Latest
              </button>
            )}
          </div>
        </div>

        {/* Core sections first; the specialists live under More. */}
        <label className="md:hidden block">
          <span className="sr-only">Scanner section</span>
          <select
            aria-label="Scanner section"
            value={activeTab}
            onChange={event => setActiveTab(event.target.value as typeof activeTab)}
            className="w-full rounded-lg border border-white/12 bg-[#101012] px-3 py-2 text-xs text-neutral-100 focus:outline-none focus:border-[#a8c7fa]/60"
          >
            <option value="movers">Top gainers &amp; losers</option>
            <option value="strategy_matches">Strategy matches</option>
            <option value="trends">Technical regimes</option>
            <option value="volume_52w">Volume shockers &amp; 52W radar</option>
            <option value="derivatives_oi">Derivatives OI &amp; PCR</option>
            <option value="option_chain">Option chain &amp; Greeks</option>
            <option value="volume_profile">Volume profile &amp; VWAP</option>
            <option value="gtt_bracket">GTT bracket &amp; trailing SL</option>
            <option value="basis_spreads">Basis &amp; calendar spreads</option>
            <option value="breadth_sectors">Market breadth &amp; heatmap</option>
          </select>
        </label>
        <div className="relative hidden md:block">
          <div className="flex flex-wrap items-center gap-1 rounded-lg border border-white/8 bg-[#101012] p-1 text-xs">
            {([
              ['movers', 'Top gainers & losers', false],
              ['strategy_matches', 'Strategy matches', false],
              ['trends', 'Technical regimes', false],
              ['volume_52w', 'Volume shockers', false],
            ] as const).map(([tab, label, demo]) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                aria-current={activeTab === tab ? 'page' : undefined}
                className={'whitespace-nowrap rounded-md px-3 py-1.5 text-xs transition-colors ' + (activeTab === tab ? 'bg-white/[0.08] font-medium text-neutral-100' : 'text-neutral-400 hover:bg-white/[0.04] hover:text-neutral-200')}
              >
                {label}
              </button>
            ))}
            <div className="relative">
              <button
                type="button"
                onClick={() => setMoreTabsOpen(open => !open)}
                aria-expanded={moreTabsOpen}
                aria-controls="scanner-more-sections"
                className={'flex items-center gap-1 whitespace-nowrap rounded-md px-3 py-1.5 text-xs transition-colors ' + (['derivatives_oi', 'option_chain', 'volume_profile', 'gtt_bracket', 'basis_spreads', 'breadth_sectors'].includes(activeTab) ? 'bg-white/[0.08] font-medium text-neutral-100' : 'text-neutral-400 hover:bg-white/[0.04] hover:text-neutral-200')}
              >
                More
                <ChevronDown className={'h-3 w-3 transition-transform ' + (moreTabsOpen ? 'rotate-180' : '')} aria-hidden="true" />
              </button>
              {moreTabsOpen && (
                <div id="scanner-more-sections" role="group" aria-label="More scanner sections" className="absolute left-0 top-full z-20 mt-1 w-72 rounded-lg border border-white/12 bg-[#171719] p-1 shadow-xl shadow-black/50">
                  {([
                    ['derivatives_oi', 'Derivatives OI & PCR'],
                    ['option_chain', 'Option chain & Greeks'],
                    ['volume_profile', 'Volume profile & VWAP'],
                    ['gtt_bracket', 'GTT bracket & trailing SL'],
                    ['basis_spreads', 'Basis & calendar spreads'],
                    ['breadth_sectors', 'Market breadth & heatmap'],
                  ] as const).map(([tab, label]) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => { setActiveTab(tab); setMoreTabsOpen(false); }}
                      className={'flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs transition-colors ' + (activeTab === tab ? 'bg-white/[0.06] text-neutral-100' : 'text-neutral-300 hover:bg-white/[0.04]')}
                    >
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {((isScanning && scanSlow) || (isLoadingTrends && marketSlow)) && (
        <p role="status" className="st-meta rounded-[var(--r-inner)] bg-[var(--surface-2)] px-3 py-2 text-[var(--text-3)]">
          {isScanning && scanSlow ? 'Still scanning · Angel One allows 2 requests a second' : 'Still loading market data · this can take up to a minute'}
        </p>
      )}

      {prefill && (
        <PrefillNote
          assumptions={prefill.assumptions}
          onDismiss={() => { setPrefill(null); onPrefillDismiss?.(); }}
        />
      )}

      {initialLoading && !modelOnlyTab ? <ScannerLoadingState message={marketLoadingMessage(marketProgress, currentUniverseConfig.shortLabel)} /> : (<>
      {/* TAB 1: TOP GAINERS & TOP LOSERS */}
      {activeTab === 'movers' && (
        <section aria-label="Top gainers and losers" className="space-y-3">
          <p className="px-1 text-[11px] leading-5 text-neutral-500">
            {movers ? `${movers.totalFilteredCount} stocks ranked on ${shortDay(movers.asOfDate)} close` : 'Evaluation pending or unavailable.'}
          </p>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {[
              { key: 'gainer', title: 'Top gainers', subtitle: 'Top percentage leaders', rows: movers?.topGainers, positive: true, empty: 'Gainers unavailable: no evaluated price coverage.', noRows: 'No gainers in the evaluated subset for this session; full-universe coverage is not established.' },
              { key: 'loser', title: 'Top losers', subtitle: 'Deepest percentage declines', rows: movers?.topLosers, positive: false, empty: 'Losers unavailable: no evaluated price coverage.', noRows: 'No losers in the evaluated subset for this session; full-universe coverage is not established.' },
            ].map(column => (
              <div key={column.key} className="overflow-hidden rounded-xl border border-white/8 bg-[#171719]">
                <div className="flex items-baseline justify-between gap-2 border-b border-white/8 px-4 py-3">
                  <div className="min-w-0">
                    <h3 className="text-sm font-medium text-[var(--text-1)]">{column.title} — {currentUniverseConfig.shortLabel}</h3>
                    <p className="mt-0.5 text-[11px] text-neutral-500">{column.subtitle}</p>
                  </div>
                  <span className="st-meta st-tnum shrink-0 text-[var(--text-3)]">{movers?.formattedDate || movers?.asOfDate || coveredTradingDates[0]?.label || 'Latest'}</span>
                </div>
                {!column.rows || column.rows.length === 0 ? (
                  <div className="px-4 py-8 text-center text-xs text-neutral-400">
                    {marketEvaluated > 0 ? column.noRows : <><span>{column.empty}</span> <button type="button" onClick={retryActiveView} className="underline hover:text-neutral-200">Retry</button></>}
                  </div>
                ) : (
                  <ol className="divide-y divide-white/6">
                    {column.rows.map((stock, i) => {
                      const quote = liveQuoteFor(stock.id);
                      return (
                        <li key={column.key + '_' + stock.id + '_' + stock.ticker + '_' + i} className="flex items-start gap-3 px-4 py-3">
                          <span className="st-tnum w-4 shrink-0 pt-0.5 text-[11px] text-[var(--text-3)]">{i + 1}</span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-baseline gap-x-2">
                              <span className="text-sm font-medium text-neutral-100">{stock.ticker}</span>
                              <span className="truncate text-[11px] text-neutral-500">{stock.sector}</span>
                            </div>
                            <p className="truncate text-[11px] text-neutral-500">{stock.name}</p>
                            {quote && <QuoteMeta quote={quote} eodClose={stock.ltp} className="mt-1" />}
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            <div className="st-tnum text-xs text-[var(--text-1)]">{scannerPrice(stock.ltp)}</div>
                            <div className={'st-tnum text-[11px] ' + (column.positive ? 'text-[var(--up)]' : 'text-[var(--down)]')}>{scannerPercent(stock.changePercent)}</div>
                            <button
                              type="button"
                              onClick={() => launchBacktest(stock.id, stock.date)}
                              className="rounded-lg border border-white/12 px-2 py-0.5 text-[11px] text-neutral-300 transition-colors hover:border-[#a8c7fa]/40 hover:bg-white/[0.04]"
                              title={'Backtest the active strategy on ' + stock.ticker}
                            >
                              Backtest
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* TAB 2: VOLUME SHOCKERS & 52-WEEK HIGH/LOW RADAR */}
      {activeTab === 'volume_52w' && (
        <section aria-label="Volume shockers and 52-week radar" className="space-y-3">
          <div className="overflow-hidden rounded-xl border border-white/8 bg-[#171719]">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-white/8 px-4 py-3">
              <div>
                <h3 className="text-sm font-medium text-neutral-100">Volume shockers</h3>
                <p className="mt-0.5 text-[11px] text-neutral-500">Trading above 1.2× their 20-day average volume</p>
              </div>
              <span className="st-meta st-tnum text-[var(--text-3)]">{movers?.volumeShockers.length ?? 0} stocks</span>
            </div>
            {!movers?.volumeShockers.length ? (
              <p className="px-4 py-8 text-center text-xs text-neutral-400">
                {marketEvaluated > 0 ? 'No volume shockers in the evaluated subset.' : 'Volume shockers unavailable: no evaluated price coverage.'}
              </p>
            ) : (
              <ol className="divide-y divide-white/6">
                {movers.volumeShockers.map(s => (
                  <li key={'vol_' + s.id + '_' + s.ticker} className="flex items-start gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-sm font-medium text-neutral-100">{s.ticker}</span>
                        <span className="truncate text-[11px] text-neutral-500">{s.sector}</span>
                      </div>
                      <p className="text-[11px] text-neutral-500">{scannerMultiple(s.volumeRatio)} of its 20-day average · {(s.volume / 100000).toFixed(1)} L traded</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <div className="st-tnum text-xs text-[var(--text-1)]">{scannerPrice(s.ltp)}</div>
                      <div className={'st-tnum text-[11px] ' + (s.changePercent >= 0 ? 'text-[var(--up)]' : 'text-[var(--down)]')}>{scannerPercent(s.changePercent)}</div>
                      <button
                        type="button"
                        onClick={() => launchBacktest(s.id, s.date)}
                        className="rounded-lg border border-white/12 px-2 py-0.5 text-[11px] text-neutral-300 transition-colors hover:border-[#a8c7fa]/40 hover:bg-white/[0.04]"
                      >
                        Backtest
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {[
              { key: 'high', title: 'Near 52-week high', caption: 'Within 4.5% of the yearly high', rows: movers?.nearFiftyTwoWeekHigh, low: false, empty: 'No stocks near a 52-week high in the evaluated subset.' },
              { key: 'low', title: 'Near 52-week low', caption: 'Within 4.5% of the yearly low', rows: movers?.nearFiftyTwoWeekLow, low: true, empty: 'No stocks near a 52-week low in the evaluated subset.' },
            ].map(panel => (
              <div key={panel.key} className="overflow-hidden rounded-xl border border-white/8 bg-[#171719]">
                <div className="border-b border-white/8 px-4 py-3">
                  <h3 className="text-sm font-medium text-neutral-100">{panel.title}</h3>
                  <p className="mt-0.5 text-[11px] text-neutral-500">{panel.caption}</p>
                </div>
                {!panel.rows || panel.rows.length === 0 ? (
                  <p className="px-4 py-8 text-center text-xs text-neutral-400">{marketEvaluated > 0 ? panel.empty : 'Unavailable: no evaluated price coverage.'}</p>
                ) : (
                  <ol className="divide-y divide-white/6">
                    {panel.rows.map(s => {
                      const distance = panel.low ? s.distFrom52WLow : s.distFrom52WHigh;
                      const reference = panel.low ? s.fiftyTwoWeekLow : s.fiftyTwoWeekHigh;
                      return (
                        <li key={panel.key + '_' + s.id + '_' + s.ticker} className="flex items-center gap-3 px-4 py-2.5">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-baseline gap-x-2">
                              <span className="text-sm font-medium text-neutral-100">{s.ticker}</span>
                              <span className="truncate text-[11px] text-neutral-500">{s.sector}</span>
                            </div>
                            <p className="st-meta st-tnum text-[var(--text-3)]">
                              {panel.low ? '52W low' : '52W high'} {scannerPrice(reference)} · {scannerNumber(distance)}% {panel.low ? 'off the low' : 'below the high'}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="st-tnum text-xs text-[var(--text-1)]">{scannerPrice(s.ltp)}</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => launchBacktest(s.id, s.date)}
                            className="shrink-0 rounded-lg border border-white/12 px-2 py-0.5 text-[11px] text-neutral-300 transition-colors hover:border-[#a8c7fa]/40 hover:bg-white/[0.04]"
                          >
                            Backtest
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {latestOnlyUnavailable && (
        <div role="status" className="rounded-2xl border border-dashed border-[rgba(236,236,237,0.16)] bg-[#171719]/40 p-8 text-center space-y-3">
          <p className="text-sm font-semibold text-neutral-200">The {latestOnlyLabel} view uses the latest model reference</p>
          <p className="mx-auto max-w-xl text-xs leading-5 text-neutral-400">
            These model-only fields are not tied to a historical EOD session. Switch to the latest available cutoff to open the modelled view. Nothing here is an observed derivative, trade or quote.
          </p>
          <button
            type="button"
            onClick={() => handleDateChange('')}
            className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-500 hover:text-[#101012]"
          >
            Use latest session
          </button>
        </div>
      )}
      {/* TAB 3: DERIVATIVES OPEN INTEREST & PCR SENTIMENT */}
      {activeTab === 'derivatives_oi' && (
        <section aria-label="Derivatives open interest" className="space-y-3">
          <div className="rounded-xl border border-white/8 bg-[#171719] p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-medium text-neutral-100">Open interest by price action</h3>
              <span className="text-[11px] text-[var(--text-3)]">Sample model data, not observed derivatives</span>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {[
                { key: 'long', title: 'Long build-up', reading: 'Price up · OI up', rows: movers?.derivativesBuildup.longBuildup, positive: true },
                { key: 'cover', title: 'Short covering', reading: 'Price up · OI down', rows: movers?.derivativesBuildup.shortCovering, positive: true },
                { key: 'short', title: 'Short build-up', reading: 'Price down · OI up', rows: movers?.derivativesBuildup.shortBuildup, positive: false },
                { key: 'unwind', title: 'Long unwinding', reading: 'Price down · OI down', rows: movers?.derivativesBuildup.longUnwinding, positive: false },
              ].map(group => (
                <div key={group.key} className="min-w-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h4 className="text-xs font-medium text-neutral-200">{group.title}</h4>
                    <span className="st-tnum text-[10px] text-[var(--text-3)]">{group.reading}</span>
                  </div>
                  {!group.rows || group.rows.length === 0 ? (
                    <p className="py-3 text-center text-[11px] text-neutral-500">No names in this group for the evaluated subset.</p>
                  ) : (
                    <ul className="mt-1 divide-y divide-white/6">
                      {group.rows.slice(0, 4).map(s => (
                        <li key={group.key + '_' + s.id + '_' + s.ticker} className="flex items-center justify-between gap-2 py-1.5 text-[11px]">
                          <button
                            type="button"
                            onClick={() => launchBacktest(s.id, s.date)}
                            className="st-tnum text-[var(--text-1)] underline-offset-2 hover:underline"
                            title={'Backtest the active strategy on ' + s.ticker}
                          >
                            {s.ticker}
                          </button>
                          <span className="text-right">
                            <span className={group.positive ? 'text-emerald-300' : 'text-rose-300'}>{scannerPercent(s.changePercent)}</span>
                            <span className="text-neutral-500"> · OI {scannerPercent(s.oiChangePercent)}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {(modelModeUnavailable || modelPending) && (
        <div role="status" className="space-y-3 rounded-[var(--r-card)] border border-dashed border-[var(--line-strong)] px-4 py-10 text-center">
          <p className="text-sm font-medium text-[var(--text-1)]">
            {activeTab === 'option_chain' ? "Option chain isn't available" : `The ${latestOnlyLabel} view is a fictional demo model`}
          </p>
          <p className="mx-auto max-w-xl text-xs leading-5 text-[var(--text-3)]">
            {activeTab === 'option_chain'
              ? "Stragy only shows real observed data, and there's no real option-chain feed yet."
              : dataEvidence?.mode === 'real'
                ? 'This server is running real observed market data, so model-only derivatives are disabled. No observed derivative, synthetic price or live quote is substituted here.'
                : 'Model-only fields are demo values, not observed derivatives. Nothing here is live or an observed quote.'}
          </p>
          <button
            type="button"
            onClick={() => setActiveTab('movers')}
            className="rounded-[var(--r-btn)] border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--text-2)] transition-colors hover:border-[var(--line-strong)] hover:text-[var(--text-1)]"
          >
            Back to gainers &amp; losers
          </button>
        </div>
      )}

      {/* TAB: OPTION CHAIN & GREEKS */}
      {activeTab === 'option_chain' && !latestOnlyUnavailable && !modelModeUnavailable && !modelPending && (
        <OptionChainScanner key={contextKey} onSelectStockAndBacktest={symbolId => launchBacktest(symbolId)} />
      )}

      {/* TAB: VOLUME PROFILE & MICROSTRUCTURE VWAP */}
      {activeTab === 'volume_profile' && !latestOnlyUnavailable && !modelModeUnavailable && !modelPending && (
        <VolumeProfileScanner key={contextKey} onSelectStockAndBacktest={symbolId => launchBacktest(symbolId)} />
      )}

      {/* TAB: AUTOMATED GTT BRACKET & TRAILING STOP-LOSS ORDER CALCULATOR */}
      {activeTab === 'gtt_bracket' && !latestOnlyUnavailable && !modelModeUnavailable && !modelPending && (
        <GttBracketCalculator key={contextKey} onSelectStockAndBacktest={symbolId => launchBacktest(symbolId)} />
      )}

      {/* TAB: CASH VS FUTURES BASIS & CALENDAR SPREAD SCANNER */}
      {activeTab === 'basis_spreads' && !latestOnlyUnavailable && !modelModeUnavailable && !modelPending && (
        <BasisSpreadScanner key={contextKey} onSelectStockAndBacktest={symbolId => launchBacktest(symbolId)} />
      )}

      {/* TAB 4: MARKET BREADTH & SECTOR HEATMAP */}
      {activeTab === 'breadth_sectors' && (
        <section aria-label="Market breadth and sectors" className="space-y-3">
          <div className="rounded-xl border border-white/8 bg-[#171719] p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-medium text-neutral-100">Market breadth</h3>
              <span className="st-meta st-tnum text-[var(--text-3)]">
                {movers ? `${scannerNumber(movers.marketBreadth.advanceDeclineRatio, 2)} advance/decline · ${scannerNumber(movers.marketBreadth.bullishPercent, 1)}% bullish` : 'Not reported'}
              </span>
            </div>
            {movers ? (
              <>
                <div className="mt-3 flex h-2 w-full overflow-hidden rounded-full bg-[#101012]" role="img" aria-label={`${movers.marketBreadth.advances} advancing, ${movers.marketBreadth.declines} declining, ${movers.marketBreadth.unchanged} unchanged`}>
                  <div style={{ width: `${movers.marketBreadth.bullishPercent}%` }} className="h-full bg-emerald-400/80" />
                  <div style={{ width: `${100 - movers.marketBreadth.bullishPercent}%` }} className="h-full bg-rose-400/70" />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
                  <span className="text-emerald-300">{movers.marketBreadth.advances} advancing</span>
                  <span className="text-rose-300">{movers.marketBreadth.declines} declining</span>
                  <span className="text-neutral-500">{movers.marketBreadth.unchanged} unchanged</span>
                </div>
              </>
            ) : (
              <p className="mt-3 text-[11px] text-neutral-500">Breadth is unavailable for this context; nothing is inferred.</p>
            )}
          </div>

          <div className="overflow-hidden rounded-xl border border-white/8 bg-[#171719]">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-white/8 px-4 py-3">
              <h3 className="text-sm font-medium text-neutral-100">Sectors</h3>
              <span className="st-meta st-tnum text-[var(--text-3)]">{movers?.sectorHeatmap.length ?? 0} groups</span>
            </div>
            {!movers?.sectorHeatmap.length ? (
              <p className="px-4 py-8 text-center text-xs text-neutral-400">Sector breadth unavailable: no evaluated price coverage.</p>
            ) : (
              <ul className="divide-y divide-white/6">
                {movers.sectorHeatmap.map(sec => (
                  <li key={sec.sector} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-neutral-100">{sec.sector}</p>
                      <p className="text-[11px] text-neutral-500">{sec.count} constituents · {sec.advances} advancing · {sec.declines} declining</p>
                    </div>
                    <span className={'st-tnum text-xs ' + (sec.avgChangePercent >= 0 ? 'text-[var(--up)]' : 'text-[var(--down)]')}>
                      {scannerPercent(sec.avgChangePercent)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      {/* TAB 5: TECHNICAL REGIMES */}
      {activeTab === 'trends' && (
        <section aria-label="Technical regimes" className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
            <div>
              <h3 className="st-title font-semibold text-[var(--text-1)]">Technical regimes</h3>
              <p className="st-meta mt-1 text-[var(--text-3)]">
                {filteredTrends.length} {filteredTrends.length === 1 ? 'stock' : 'stocks'} · {shortDay(rankingSession)} close. Live prices shown separately.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {(['ALL', 'BULLISH', 'OVERSOLD', 'BREAKOUT', 'GOLDEN_CROSS'] as const).map(f => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setTrendFilter(f)}
                  aria-pressed={trendFilter === f}
                  className={'rounded-md border px-2 py-1 text-[11px] transition-colors ' + (trendFilter === f ? 'border-[#a8c7fa]/40 bg-white/[0.06] text-neutral-100' : 'border-white/10 text-neutral-400 hover:bg-white/[0.03] hover:text-neutral-200')}
                >
                  {f === 'ALL' && 'All regimes'}
                  {f === 'BULLISH' && 'Strong bullish'}
                  {f === 'OVERSOLD' && 'RSI below 40'}
                  {f === 'BREAKOUT' && 'Breakout'}
                  {f === 'GOLDEN_CROSS' && 'Golden cross'}
                </button>
              ))}
            </div>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-500" aria-hidden="true" />
            <input
              type="text"
              value={trendSearchQuery}
              onChange={e => setTrendSearchQuery(e.target.value)}
              placeholder={`Search ${trends.length > 0 ? trends.length : 'the'} evaluated symbols (ticker, name or sector)`}
              aria-label="Search technical regimes"
              className="w-full rounded-lg border border-white/12 bg-[#171719] py-2 pl-9 pr-16 text-xs text-neutral-100 placeholder:text-neutral-500 focus:border-[#a8c7fa]/60 focus:outline-none"
            />
            {trendSearchQuery && (
              <button
                type="button"
                onClick={() => setTrendSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-[11px] text-neutral-400 hover:bg-white/5 hover:text-neutral-200"
              >
                Clear
              </button>
            )}
          </div>

          {isLoadingTrends ? (
            <div role="status" className="rounded-xl border border-white/8 bg-[#171719] px-4 py-10 text-center text-xs text-neutral-400">
              Loading available price data and evaluating regimes; coverage may be partial.
            </div>
          ) : filteredTrends.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/12 px-4 py-10 text-center text-xs text-neutral-400">
              <p className="text-sm text-neutral-300">{marketEvaluated > 0 ? `No matching stocks in the evaluated subset for "${trendSearchQuery}"` : 'Trends unavailable: no evaluated price coverage.'}</p>
              {marketEvaluated === 0 ? (
                <button type="button" onClick={retryActiveView} className="mt-2 underline hover:text-neutral-200">Retry market snapshot</button>
              ) : (
                <p className="mt-1 text-[11px]">Try a different ticker, or clear the filter.</p>
              )}
            </div>
          ) : (
            <>
              <DataTable
                caption="Technical regimes"
                columns={trendColumns}
                rows={filteredTrends}
                rowKey={t => 'trend_' + t.id + '_' + t.ticker}
                initialLimit={20}
                fitMobile
                empty="No matching stocks in the evaluated subset."
              />
            </>
          )}
        </section>
      )}

      {/* TAB 6: STRATEGY SCREENER MATCHES */}
      {activeTab === 'strategy_matches' && (
        <section aria-label="Strategy matches" className="space-y-3">
          <div className="space-y-2 px-1">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="st-title font-semibold text-[var(--text-1)]">Scanning {currentUniverseConfig.shortLabel} with “{strategy.name}”</h3>
              <span className="st-meta text-[var(--text-3)]">{initialLoading ? 'Loading session…' : shortDay(scanResult?.asOf || dataCutoff) + ' close'}</span>
            </div>
            <p className="st-meta leading-5 text-[var(--text-3)]">
              {initialLoading ? 'Loading the latest close…' : `Stocks where every entry rule is true on the ${shortDay(scanResult?.asOf || dataCutoff)} close.`}
            </p>
            {(strategy.rules?.entry ?? []).length > 0 ? (
              <ul className="space-y-1">
                {(strategy.rules?.entry ?? []).map((rule, index) => (
                  <li key={index} className="st-table-text leading-5 text-[var(--text-2)]">{plainRule(rule, strategy.indicators)}</li>
                ))}
              </ul>
            ) : (
              <p className="st-meta text-[var(--text-3)]">No entry conditions are defined in this strategy.</p>
            )}
            {(strategy.rules?.exit ?? []).length > 0 && (
              <p className="st-meta leading-5 text-[var(--text-3)]">
                Exit: <span className="text-[var(--text-2)]">{(strategy.rules?.exit ?? []).map(rule => plainRule(rule, strategy.indicators)).join(' · ')}</span>
              </p>
            )}
          </div>

          {scanResult && !scanError && (
            <p className="st-meta px-1 leading-5 text-[var(--text-3)]">
              Evaluated {scanResult.succeeded} symbols · found <span className="text-[var(--text-1)]">{scanResult.succeeded > 0 ? scanResult.matched : 'unavailable'}</span> matches · {scanResult.unavailable} unavailable · {scanResult.failed} failed
              {' · '}{scanSourceLine(scanResult)} · {shortDay(scanResult.asOf || dataCutoff)} close
            </p>
          )}

          {isScanning ? (
            <div role="status" className="rounded-[var(--r-card)] border border-[var(--line)] bg-[var(--surface-1)] px-4 py-10 text-center st-meta text-[var(--text-3)]">
              <p>Evaluating the entry conditions against {currentUniverseConfig.shortLabel}. Coverage may be partial.</p>
            </div>
          ) : !scanError && scanResult && scanResult.matches.length > 0 ? (
            <ul className="divide-y divide-[var(--line)] border-t border-[var(--line)]">
              {scanResult.matches.map((m, idx) => {
                const evidence = m.matchedRules.slice(0, 3).map((r, ruleIndex) => {
                  const entryRule = r.ruleIndex !== undefined ? strategy.rules?.entry?.[r.ruleIndex] : undefined;
                  const format = evidenceFormatter(entryRule, strategy.indicators ?? []);
                  return (
                    <li key={ruleIndex} className="flex flex-wrap gap-x-2 text-xs leading-5 text-[var(--text-2)]">
                      <span aria-hidden="true" className="text-[var(--up)]">✓</span>
                      <span>{entryRule ? plainRule(entryRule, strategy.indicators ?? []) : r.rule}</span>
                      <span className="st-tnum text-[var(--text-3)]">· {format(r.actualLeft)} vs {format(r.actualRight)}</span>
                    </li>
                  );
                });
                return (
                  <li key={'scan_' + m.symbolId + '_' + m.ticker + '_' + idx} className="space-y-2 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <span className="text-sm font-medium text-[var(--text-1)]">{m.ticker}</span>
                          <span className="st-meta text-[var(--text-3)]">{m.sector}</span>
                        </div>
                        <p className="st-meta truncate text-[var(--text-3)]">{m.name}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="st-tnum text-xs text-[var(--text-1)]">{scannerPrice(m.lastClose)}</div>
                        <div className={'st-tnum text-[11px] ' + (m.changePercent >= 0 ? 'text-[var(--up)]' : 'text-[var(--down)]')}>{scannerPercent(m.changePercent)}</div>
                      </div>
                    </div>
                    <ul className="space-y-0.5">
                      {evidence}
                      {m.matchedRules.length > 3 && <li className="st-meta text-[var(--text-3)]">and {m.matchedRules.length - 3} more conditions</li>}
                    </ul>
                    <button
                      type="button"
                      onClick={() => launchBacktest(m.symbolId, m.lastDate)}
                      className="inline-flex min-h-9 items-center rounded-[var(--r-btn)] border border-[var(--line)] px-2.5 py-1 text-xs text-[var(--text-2)] transition-colors hover:border-[var(--line-strong)] hover:text-[var(--text-1)]"
                      title={'Run the active strategy on ' + m.ticker + ' now'}
                    >
                      Backtest {m.ticker}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="rounded-[var(--r-card)] border border-dashed border-[var(--line-strong)] px-4 py-10 text-center st-meta text-[var(--text-3)]">
              <p>{scanError ? 'Strategy scan failed. Results are unavailable; retry the scan.' : scanResult && scanResult.succeeded > 0 && scanResult.matched === 0 ? `No matches in the ${scanResult.succeeded} evaluated symbols. This does not establish no matches across the full universe.` : 'Strategy results unavailable: no evaluated coverage was reported.'}</p>
              {!scanError && <button type="button" onClick={() => void runScan()} className="mt-2 underline hover:text-[var(--text-1)]">Retry strategy scan</button>}
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => setActiveTab('movers')}
                  className="rounded-[var(--r-btn)] border border-[var(--line)] px-3 py-1.5 text-[11px] text-[var(--text-2)] hover:border-[var(--line-strong)]"
                >
                  Back to top gainers & losers
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      </>)}

      {/* Interactive Full Calendar Modal */}
      <TradingCalendarModal
        isOpen={isCalendarModalOpen}
        onClose={() => setIsCalendarModalOpen(false)}
        selectedDate={selectedDate || dataCutoff}
        onSelectDate={(date) => handleDateChange(date)}
        availableDates={coveredTradingDates}
        activeUniverseLabel={currentUniverseConfig.shortLabel}
        totalAssetsCount={trends.length}
      />
    </div>
  );
};
