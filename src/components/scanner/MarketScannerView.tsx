import React, { useState, useEffect, useRef } from 'react';
import { StrategyAST, StockTrendData, MarketMoversData } from '../../shared/strategy/types';
import { requestMarketSnapshot, requestScan } from '../../client/api';
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
  ArrowRight,
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
  ChevronLeft,
  ChevronRight,
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

const istClock = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
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
      <span className="font-mono font-bold text-white">{formatLivePrice(quote.ltp)}</span>
      <span className={`font-mono font-bold ${quote.changePercent >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
        {formatLiveChange(quote.changePercent)}
      </span>
      <span className="font-mono text-neutral-400">{liveQuoteTime(quote)}</span>
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

const ScannerLoadingSkeleton: React.FC = () => (
  <div role="status" aria-live="polite" className="rounded-2xl border border-[rgba(236,236,237,0.08)] bg-[#171719] p-4 sm:p-5 space-y-4">
    <div className="h-3 w-64 max-w-full rounded bg-white/[0.07] animate-pulse" />
    <div className="h-3 w-96 max-w-full rounded bg-white/[0.04] animate-pulse" />
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-2">
      {[0, 1].map(column => (
        <div key={column} className="space-y-2.5">
          {[0, 1, 2].map(row => (
            <div key={row} className="h-14 rounded-xl border border-[rgba(236,236,237,0.06)] bg-[#151517] animate-pulse" />
          ))}
        </div>
      ))}
    </div>
    <span className="sr-only">Loading market snapshot…</span>
  </div>
);

interface MarketScannerViewProps {
  strategy: StrategyAST;
  onSelectStockAndBacktest: (symbolId: number, asOf: string) => void;
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
  { id: 'NIFTY_50', label: 'Configured NIFTY 50-labelled pool', shortLabel: 'NIFTY 50', category: 'Benchmark & Sector Indices', description: 'Bounded configured pool; current NIFTY 50 membership and count are unverified', badge: 'NIFTY 50' },
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
  onSelectStockAndBacktest
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
  const [selectedUniverse, setSelectedUniverse] = useState<MarketUniverseType>('NIFTY_50');
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [isCalendarModalOpen, setIsCalendarModalOpen] = useState<boolean>(false);
  const [availableTradingDates, setAvailableTradingDates] = useState<TradingSessionDate[]>([]);
  const [trendFilter, setTrendFilter] = useState<'ALL' | 'BULLISH' | 'OVERSOLD' | 'BREAKOUT' | 'GOLDEN_CROSS'>('ALL');
  const [trendSearchQuery, setTrendSearchQuery] = useState('');
  const [trendPage, setTrendPage] = useState(1);
  const TREND_ITEMS_PER_PAGE = 40;
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
    setTrends([]); setMovers(null); setDataCutoff(''); setMarketEvaluated(0);
    setPriceLabel('Price source not yet reported');
    setCoverageLabel('Coverage not yet reported');setCoverageDetail('Coverage details not yet reported.');setDataEvidence(null);
    try {
      const data = await requestMarketSnapshot({ universe: selectedUniverse, asOf: selectedDate || undefined }, ticket.signal);
      if (!marketOwner.current.owns(ticket, currentContext.current)) return;
      if (data.coverage.succeeded > 0) recordCutoff(data);
      setTrends(data.trends);setDataEvidence(data);
      setMovers(data.coverage.succeeded > 0 ? data.movers || null : null);
      setMarketEvaluated(data.coverage.succeeded);
      setPriceLabel(priceDataLabel(data));
      setCoverageLabel(data.coverage ? `Coverage: ${data.coverage.succeeded} of ${data.coverage.requested} symbols` : 'Coverage not reported; current membership, not full exchange coverage');
      setCoverageDetail(data.coverage ? `${data.coverage.succeeded} of ${data.coverage.requested} symbols evaluated; ${data.coverage.unavailable} unavailable.` : 'Coverage was not reported.');
      if (data.errors.length) setMarketError('Some market data is unavailable for this context. ' + JSON.stringify(data.errors));
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
      const data = await requestScan({ universe: selectedUniverse, strategy, limit: 35, asOf: selectedDate || undefined }, ticket.signal);
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
  const activePending = isStrategyView ? isScanning : isLoadingTrends;
  const initialLoading = !dataEvidence && !activeError;

  const handleUniverseChange = (newUniv: MarketUniverseType) => {
    if (newUniv === selectedUniverse) return;
    marketOwner.current.cancel(); scanOwner.current.cancel();
    setSelectedUniverse(newUniv);
    setTrendPage(1);
  };

  const handleDateChange = (newDate: string) => {
    if (newDate === selectedDate) return;
    marketOwner.current.cancel(); scanOwner.current.cancel();
    setSelectedDate(newDate);
    setTrendPage(1);
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

  const totalTrendPages = Math.max(1, Math.ceil(filteredTrends.length / TREND_ITEMS_PER_PAGE));
  const currentPageSafe = Math.min(trendPage, totalTrendPages);
  const paginatedTrends = filteredTrends.slice(
    (currentPageSafe - 1) * TREND_ITEMS_PER_PAGE,
    currentPageSafe * TREND_ITEMS_PER_PAGE
  );

  // Up to 10 visible cards: top five gainers + top five losers, or ten trend cards.
  const moverQuoteIds = [
    ...(movers?.topGainers ?? []).slice(0, 5).map(stock => stock.id),
    ...(movers?.topLosers ?? []).slice(0, 5).map(stock => stock.id),
  ];
  const trendQuoteIds = paginatedTrends.slice(0, 10).map(trend => trend.id);
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
  const latestOnlyLabel = activeTab === 'option_chain' ? 'Option chain & Greeks'
    : activeTab === 'volume_profile' ? 'Volume profile & VWAP'
      : activeTab === 'gtt_bracket' ? 'GTT bracket & trailing stop'
        : 'Basis & calendar spreads';

  return (
    <div className="w-full max-w-6xl mx-auto p-3 sm:p-5 space-y-4 pb-24">
      {dataEvidence && (
      <div role="status" className="rounded-xl border border-amber-400/20 bg-amber-400/[0.04] p-3 space-y-1 text-xs">
        <p className="line-clamp-2 text-amber-100/90">
          {priceLabel} · {coverageLabel} · {sourceSummary(dataEvidence?.sourceCoverage)}
        </p>
        <details className="text-[11px] text-neutral-400">
          <summary className="cursor-pointer text-amber-200/80">Details</summary>
          <div className="mt-2 space-y-1">
            <p>EOD ranking: {rankingSession}. Live LTPs, where shown, are separate Angel One quotes.</p>
            <p>Derivatives/OI/PCR and related model fields are model-only, not observed derivatives or live quotes. Universe membership is unverified unless explicitly reported; current membership may introduce survivorship bias.</p>
            <p>Coverage detail: {coverageDetail} {sourceSummary(dataEvidence?.sourceCoverage)}.</p>
            {dataEvidence?.observationDates && <p>Observed sessions: {dataEvidence.observationDates.earliest} to {dataEvidence.observationDates.latest}; stale datasets: {dataEvidence.observationDates.staleSymbols}.</p>}
            {dataEvidence?.membership && <p>Membership source: {dataEvidence.membership.source}; retrieved {scannerDateTime(dataEvidence.membership.observedAt)}; {dataEvidence.membership.freshness}.</p>}
          </div>
        </details>
      </div>
      )}
      {scannerError && <div role="alert" className="text-xs text-red-400">{scannerError}</div>}
      {activeError && <div role="alert" className="text-xs text-red-400 space-x-2">
        <span>{isStrategyView ? 'Strategy scan unavailable: ' : 'Market snapshot unavailable: '}{activeError}</span>
        <button type="button" onClick={retryActiveView} disabled={activePending} className="underline">Retry {isStrategyView ? 'strategy scan' : 'market snapshot'}</button>
      </div>}
      {/* Top Header Card */}
      <div className="bg-[#171719] border border-[rgba(236,236,237,0.08)] rounded-2xl p-4 sm:p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
              <Radio className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white tracking-tight flex items-center gap-2 flex-wrap">
                <span>Market scanner</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">
                  EOD research snapshot
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#1e1e21] text-neutral-300 border border-[rgba(236,236,237,0.12)] font-mono flex items-center gap-1">
                  <Calendar className="w-3 h-3 text-amber-400" />
                  <span>Session: {initialLoading ? 'loading…' : dataCutoff || 'Cutoff unavailable'}</span>
                </span>
                {liveQuotes.connected && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/25 font-mono flex items-center gap-1">
                    <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    Live LTP · Angel One
                  </span>
                )}
              </h2>
              <p className="text-xs text-neutral-400">
                End-of-day ranking with live Angel One LTPs where available. Model-only derivatives are labelled separately.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={async (e) => {
                e.preventDefault();
                e.stopPropagation();
                retryActiveView();
              }}
              disabled={activePending}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1e1e21] hover:bg-[#27272a] text-white font-semibold text-xs rounded-xl border border-[rgba(236,236,237,0.12)] shadow-sm active:scale-95 transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${activePending ? 'animate-spin text-amber-400' : ''}`} />
              <span>{activePending ? 'Loading snapshot...' : 'Reload snapshot'}</span>
            </button>
          </div>
        </div>

        {/* One universe picker and one session picker. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-3 bg-[#151517] border border-[rgba(236,236,237,0.08)] rounded-xl text-xs">
          <label className="flex items-center gap-2 min-w-0">
            <Filter aria-hidden="true" className="w-3.5 h-3.5 shrink-0 text-amber-400" />
            <span className="shrink-0 text-neutral-400">Universe</span>
            <select
              aria-label="Market universe"
              value={selectedUniverse}
              onChange={(e) => handleUniverseChange(e.target.value as MarketUniverseType)}
              className="min-w-0 flex-1 rounded-lg border border-[rgba(236,236,237,0.12)] bg-[#171719] px-2.5 py-1.5 font-medium text-white focus:outline-none focus:border-amber-500"
            >
              <optgroup label="Broad and exchanges">
                <option value="ALL">All markets (NSE + BSE)</option>
                <option value="NSE">All NSE stocks</option>
                <option value="BSE">All BSE stocks</option>
              </optgroup>
              <optgroup label="Benchmark indices">
                <option value="NIFTY_50">{officialMembership ? 'NIFTY 50 (official 50-member feed)' : 'NIFTY 50-labelled pool'}</option>
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

          <div className="flex min-w-0 items-center gap-2">
            <label htmlFor="scanner-session" className="shrink-0 text-neutral-400">Session</label>
            <select
              id="scanner-session"
              aria-label="Trading session"
              value={selectedDate}
              onChange={(e) => handleDateChange(e.target.value)}
              className="min-w-0 flex-1 truncate rounded-lg border border-[rgba(236,236,237,0.12)] bg-[#171719] px-2.5 py-1.5 font-medium text-cyan-300 focus:outline-none focus:border-cyan-500"
            >
              <option value="">Latest available cutoff</option>
              {coveredTradingDates.map((item) => (
                <option key={item.date} value={item.date}>{item.label}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setIsCalendarModalOpen(true)}
              aria-label="Open trading session calendar"
              title="Open trading session calendar"
              className="shrink-0 rounded-lg border border-[rgba(236,236,237,0.12)] bg-[#171719] p-1.5 text-cyan-300 hover:bg-[#1e1e21]"
            >
              <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            {selectedDate && selectedDate !== coveredTradingDates[0]?.date && (
              <button
                type="button"
                onClick={() => handleDateChange('')}
                className="shrink-0 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[10px] font-bold text-amber-300 hover:bg-amber-500 hover:text-[#101012]"
                title="Reset to latest available data cutoff"
              >
                Latest
              </button>
            )}
          </div>
        </div>

        {/* Navigation Tabs */}
        <label className="md:hidden block">
          <span className="sr-only">Scanner section</span>
          <select
            aria-label="Scanner section"
            value={activeTab}
            onChange={event => setActiveTab(event.target.value as typeof activeTab)}
            className="w-full rounded-xl border border-[rgba(236,236,237,0.12)] bg-[#151517] px-3 py-2 text-xs font-semibold text-neutral-100 focus:outline-none focus:border-amber-500"
          >
            <option value="movers">Top gainers &amp; losers</option>
            <option value="volume_52w">Volume shockers &amp; 52W radar</option>
            <option value="derivatives_oi">Derivatives OI &amp; PCR</option>
            <option value="option_chain">Option chain &amp; Greeks</option>
            <option value="volume_profile">Volume profile &amp; VWAP</option>
            <option value="gtt_bracket">GTT bracket &amp; trailing SL</option>
            <option value="basis_spreads">Basis &amp; calendar spreads</option>
            <option value="breadth_sectors">Market breadth &amp; heatmap</option>
            <option value="trends">Technical regimes</option>
            <option value="strategy_matches">Strategy matches</option>
          </select>
        </label>
        <div className="hidden md:flex items-center gap-1.5 bg-[#151517] p-1 rounded-xl border border-[rgba(236,236,237,0.08)] text-xs flex-wrap">
          <button
            onClick={() => setActiveTab('movers')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold whitespace-nowrap transition-all ${
              activeTab === 'movers' ? 'bg-amber-500 text-[#101012] shadow-sm' : 'text-neutral-400 hover:text-white'
            }`}
          >
            <Flame className="w-3.5 h-3.5" />
            <span>Top Gainers & Losers</span>
          </button>

          <button
            onClick={() => setActiveTab('volume_52w')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold whitespace-nowrap transition-all ${
              activeTab === 'volume_52w' ? 'bg-amber-500 text-[#101012] shadow-sm' : 'text-neutral-400 hover:text-white'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            <span>Volume Shockers & 52W Radar</span>
          </button>

          <button
            onClick={() => setActiveTab('derivatives_oi')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold whitespace-nowrap transition-all ${
              activeTab === 'derivatives_oi' ? 'bg-amber-500 text-[#101012] shadow-sm' : 'text-neutral-400 hover:text-white'
            }`}
          >
            <Gauge className="w-3.5 h-3.5" />
            <span>Derivatives OI & PCR</span>
          </button>

          <button
            onClick={() => setActiveTab('option_chain')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold whitespace-nowrap transition-all ${
              activeTab === 'option_chain' ? 'bg-cyan-500 text-[#101012] shadow-sm' : 'text-neutral-400 hover:text-white'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Option Chain & Greeks</span>
          </button>

          <button
            onClick={() => setActiveTab('volume_profile')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold whitespace-nowrap transition-all ${
              activeTab === 'volume_profile' ? 'bg-purple-500 text-[#101012] shadow-sm' : 'text-neutral-400 hover:text-white'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Volume Profile & VWAP</span>
          </button>

          <button
            onClick={() => setActiveTab('gtt_bracket')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold whitespace-nowrap transition-all ${
              activeTab === 'gtt_bracket' ? 'bg-amber-500 text-[#101012] shadow-sm' : 'text-neutral-400 hover:text-white'
            }`}
          >
            <Calculator className="w-3.5 h-3.5" />
            <span>GTT Bracket & Trailing SL</span>
          </button>

          <button
            onClick={() => setActiveTab('basis_spreads')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold whitespace-nowrap transition-all ${
              activeTab === 'basis_spreads' ? 'bg-emerald-500 text-[#101012] shadow-sm' : 'text-neutral-400 hover:text-white'
            }`}
          >
            <TrendingUpDown className="w-3.5 h-3.5" />
            <span>Basis & Calendar Spreads</span>
          </button>

          <button
            onClick={() => setActiveTab('breadth_sectors')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold whitespace-nowrap transition-all ${
              activeTab === 'breadth_sectors' ? 'bg-amber-500 text-[#101012] shadow-sm' : 'text-neutral-400 hover:text-white'
            }`}
          >
            <BarChart2 className="w-3.5 h-3.5" />
            <span>Market Breadth & Heatmap</span>
          </button>

          <button
            onClick={() => setActiveTab('trends')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold whitespace-nowrap transition-all ${
              activeTab === 'trends' ? 'bg-amber-500 text-[#101012] shadow-sm' : 'text-neutral-400 hover:text-white'
            }`}
          >
            <Compass className="w-3.5 h-3.5" />
            <span>Technical Regimes</span>
          </button>

          <button
            onClick={() => setActiveTab('strategy_matches')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold whitespace-nowrap transition-all ${
              activeTab === 'strategy_matches' ? 'bg-amber-500 text-[#101012] shadow-sm' : 'text-neutral-400 hover:text-white'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Strategy Matches ({isScanning ? 'pending' : scanError ? 'unavailable' : scanResult && scanResult.succeeded > 0 ? scanResult.matched : 'not evaluated'})</span>
          </button>
        </div>
      </div>

      {initialLoading ? <ScannerLoadingSkeleton /> : (<>
      {/* TAB 1: TOP GAINERS & TOP LOSERS */}
      {activeTab === 'movers' && (
        <div className="space-y-4">
          {/* Universe Header Banner for Gainers & Losers */}
          <div className="bg-[#171719]/80 border border-[rgba(236,236,237,0.08)] rounded-2xl p-3.5 sm:p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 font-bold">
                <Layers className="w-4 h-4" aria-hidden="true" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-extrabold text-white">
                    Top Gainers & Losers Ranking — {currentUniverseConfig.label}
                  </h3>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-[#151517] border border-[rgba(236,236,237,0.08)] text-amber-400 font-mono">
                    {movers ? `${movers.totalFilteredCount} Assets Evaluated` : 'Evaluation pending or unavailable'}
                  </span>
                  <span className={`text-[10px] px-2 py-0.5 rounded border font-mono flex items-center gap-1 ${
                    movers?.isHistorical
                      ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300 font-bold'
                      : 'bg-[#151517] border-[rgba(236,236,237,0.08)] text-neutral-300'
                  }`}>
                    <Calendar className="w-2.5 h-2.5 text-cyan-400" />
                    <span>{movers?.isHistorical ? `Historical Session: ${movers?.formattedDate || movers?.asOfDate}` : `Session: ${movers?.formattedDate || movers?.asOfDate || 'Cutoff unavailable'}`}</span>
                  </span>
                </div>
                <p className="text-[11px] text-neutral-400">{currentUniverseConfig.description}</p>
                <p className="text-[10px] text-neutral-400">Ranking: {rankingSession} EOD. Live LTPs are a separate Angel One overlay and do not change this ranking.</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Top Gainers Column */}
            <div className="bg-[#171719] border border-[rgba(236,236,237,0.08)] rounded-2xl p-4 space-y-3 shadow-sm">
              <div className="flex items-center justify-between pb-2 border-b border-[rgba(236,236,237,0.08)]">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                    <TrendingUp className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">Top Gainers — {currentUniverseConfig.shortLabel}</h3>
                    <p className="text-[10px] text-neutral-400">Top upward momentum and percentage leaders in selected universe</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-[#151517] border border-emerald-500/30 text-emerald-400 font-mono font-bold">
                    <Calendar className="w-3 h-3 text-emerald-400" />
                    <span>{movers?.formattedDate || movers?.asOfDate || coveredTradingDates[0]?.label || 'Latest'}</span>
                  </span>
                </div>
              </div>

              <div className="space-y-2.5">
                {(!movers?.topGainers || movers.topGainers.length === 0) ? (
                  <div className="p-8 text-center text-neutral-400 text-xs border border-dashed border-[rgba(236,236,237,0.08)] rounded-xl">
                    {marketEvaluated > 0 ? 'No gainers in the evaluated subset for this session; full-universe coverage is not established.' : <><span>Gainers unavailable: no evaluated price coverage.</span> <button type="button" onClick={retryActiveView} className="underline text-amber-400">Retry</button></>}
                  </div>
                ) : (
                  movers.topGainers.map((stock, i) => (
                    <div
                      key={`gainer_${stock.id}_${stock.ticker}_${i}`}
                      className="p-3 bg-[#151517] border border-[rgba(236,236,237,0.08)] hover:border-emerald-500/40 rounded-xl space-y-2 transition-all"
                    >
                      <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="text-xs font-mono font-bold text-neutral-500 w-4">{i + 1}</span>
                        <div className="truncate space-y-0.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-extrabold text-sm text-white">{stock.ticker}</span>
                            <span className="text-[10px] text-neutral-400">{stock.sector}</span>
                          </div>
                          <p className="text-[11px] text-neutral-400 truncate">{stock.name}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <div className="text-right">
                          <div className="font-mono font-extrabold text-sm text-white">
                            {scannerPrice(stock.ltp)}
                          </div>
                          <div className="text-xs font-bold text-emerald-400 flex items-center justify-end gap-0.5">
                            <TrendingUp className="w-3 h-3" />
                            <span>{scannerPercent(stock.changePercent)}</span>
                          </div>
                        </div>

                        <button
                          onClick={() => launchBacktest(stock.id, stock.date)}
                          className="px-2.5 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500 text-emerald-400 hover:text-[#101012] text-[11px] font-bold border border-emerald-500/30 transition-all flex items-center gap-1"
                          title="Backtest active strategy on this gainer"
                        >
                          <span>Backtest</span>
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      </div>
                      </div>
                      {liveQuoteFor(stock.id) && <LiveQuoteLine quote={liveQuoteFor(stock.id)!} eodClose={stock.ltp} className="border-t border-white/6 pt-2" />}
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Top Losers Column */}
            <div className="bg-[#171719] border border-[rgba(236,236,237,0.08)] rounded-2xl p-4 space-y-3 shadow-sm">
              <div className="flex items-center justify-between pb-2 border-b border-[rgba(236,236,237,0.08)]">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400">
                    <TrendingDown className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">Top Losers — {currentUniverseConfig.shortLabel}</h3>
                    <p className="text-[10px] text-neutral-400">Deepest pullbacks, dip buy & shorting candidates in selected universe</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-[#151517] border border-rose-500/30 text-rose-400 font-mono font-bold">
                    <Calendar className="w-3 h-3 text-rose-400" />
                    <span>{movers?.formattedDate || movers?.asOfDate || coveredTradingDates[0]?.label || 'Latest'}</span>
                  </span>
                </div>
              </div>

              <div className="space-y-2.5">
                {(!movers?.topLosers || movers.topLosers.length === 0) ? (
                  <div className="p-8 text-center text-neutral-400 text-xs border border-dashed border-[rgba(236,236,237,0.08)] rounded-xl">
                    {marketEvaluated > 0 ? 'No losers in the evaluated subset for this session; full-universe coverage is not established.' : <><span>Losers unavailable: no evaluated price coverage.</span> <button type="button" onClick={retryActiveView} className="underline text-amber-400">Retry</button></>}
                  </div>
                ) : (
                  movers.topLosers.map((stock, i) => (
                    <div
                      key={`loser_${stock.id}_${stock.ticker}_${i}`}
                      className="p-3 bg-[#151517] border border-[rgba(236,236,237,0.08)] hover:border-rose-500/40 rounded-xl space-y-2 transition-all"
                    >
                      <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="text-xs font-mono font-bold text-neutral-500 w-4">{i + 1}</span>
                        <div className="truncate space-y-0.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-extrabold text-sm text-white">{stock.ticker}</span>
                            <span className="text-[10px] text-neutral-400">{stock.sector}</span>
                          </div>
                          <p className="text-[11px] text-neutral-400 truncate">{stock.name}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <div className="text-right">
                          <div className="font-mono font-extrabold text-sm text-white">
                            {scannerPrice(stock.ltp)}
                          </div>
                          <div className="text-xs font-bold text-rose-400 flex items-center justify-end gap-0.5">
                            <TrendingDown className="w-3 h-3" />
                            <span>{scannerPercent(stock.changePercent)}</span>
                          </div>
                        </div>

                        <button
                          onClick={() => launchBacktest(stock.id, stock.date)}
                          className="px-2.5 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500 text-rose-400 hover:text-[#101012] text-[11px] font-bold border border-rose-500/30 transition-all flex items-center gap-1"
                          title="Backtest active strategy on this dip candidate"
                        >
                          <span>Backtest</span>
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      </div>
                      </div>
                      {liveQuoteFor(stock.id) && <LiveQuoteLine quote={liveQuoteFor(stock.id)!} eodClose={stock.ltp} className="border-t border-white/6 pt-2" />}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: VOLUME SHOCKERS & 52-WEEK HIGH/LOW RADAR */}
      {activeTab === 'volume_52w' && (
        <div className="space-y-4">
          {/* Volume Shockers Section */}
          <div className="bg-[#171719] border border-[rgba(236,236,237,0.08)] rounded-2xl p-4 sm:p-5 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-[rgba(236,236,237,0.08)]">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
                  <Zap className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Volume Shockers (Volume Surge Multiplier)</h3>
                  <p className="text-xs text-neutral-400">
                    Stocks with heavy institutional activity trading well above their 20-day average volume
                  </p>
                </div>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20 font-mono">
                Volume Expansion &gt; 1.2x
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {movers?.volumeShockers.map(s => (
                <div
                  key={`vol_${s.id}_${s.ticker}`}
                  className="p-3.5 bg-[#151517] border border-[rgba(236,236,237,0.08)] hover:border-amber-500/40 rounded-xl space-y-2.5 transition-all"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="font-extrabold text-sm text-white">{s.ticker}</span>
                      <p className="text-[11px] text-neutral-400">{s.sector}</p>
                    </div>
                    <div className="text-right">
                      <span className="font-bold text-xs text-white">{scannerPrice(s.ltp)}</span>
                      <div className={`text-[11px] font-bold ${s.changePercent >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {scannerPercent(s.changePercent)}
                      </div>
                    </div>
                  </div>

                  <div className="p-2 bg-[#171719]/80 rounded-lg border border-[rgba(236,236,237,0.08)]/60 flex items-center justify-between text-xs font-mono">
                    <div>
                      <span className="text-neutral-500 block text-[9px]">Volume Surge</span>
                      <span className="font-extrabold text-amber-400">{scannerMultiple(s.volumeRatio)} of 20D avg</span>
                    </div>
                    <div className="text-right">
                      <span className="text-neutral-500 block text-[9px]">Today Volume</span>
                      <span className="text-neutral-300 font-semibold">{(s.volume / 100000).toFixed(1)} Lakhs</span>
                    </div>
                  </div>

                  <button
                    onClick={() => launchBacktest(s.id, s.date)}
                    className="w-full py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500 text-amber-400 hover:text-[#101012] text-xs font-bold border border-amber-500/30 transition-all flex items-center justify-center gap-1"
                  >
                    <span>Backtest {s.ticker}</span>
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* 52-Week High/Low Radar */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-[#171719] border border-[rgba(236,236,237,0.08)] rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-[rgba(236,236,237,0.08)]">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                    <TrendingUp className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">Near 52-Week High (Breakout Proximity)</h3>
                    <p className="text-[10px] text-neutral-400">Within 4.5% of lifetime or yearly resistance</p>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                {movers?.nearFiftyTwoWeekHigh.map(s => (
                  <div key={`high52_${s.id}_${s.ticker}`} className="p-2.5 bg-[#151517] border border-[rgba(236,236,237,0.08)] rounded-xl flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-extrabold text-xs text-white">{s.ticker}</span>
                        <span className="text-[9px] text-cyan-400 font-mono">{scannerPrice(s.ltp)}</span>
                      </div>
                      <span className="text-[10px] text-neutral-400">52W high: {scannerPrice(s.fiftyTwoWeekHigh)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-300 font-bold border border-cyan-500/20">
                        -{scannerNumber(s.distFrom52WHigh)}% away
                      </span>
                      <button
                        onClick={() => launchBacktest(s.id, s.date)}
                        className="p-1 rounded bg-[#1e1e21] hover:bg-[#27272a] text-white"
                        title="Backtest"
                      >
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-[#171719] border border-[rgba(236,236,237,0.08)] rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-[rgba(236,236,237,0.08)]">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400">
                    <TrendingDown className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">Near 52-Week Low (Value Support)</h3>
                    <p className="text-[10px] text-neutral-400">Within 4.5% of yearly major support</p>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                {movers?.nearFiftyTwoWeekLow.map(s => (
                  <div key={`low52_${s.id}_${s.ticker}`} className="p-2.5 bg-[#151517] border border-[rgba(236,236,237,0.08)] rounded-xl flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-extrabold text-xs text-white">{s.ticker}</span>
                        <span className="text-[9px] text-purple-400 font-mono">{scannerPrice(s.ltp)}</span>
                      </div>
                      <span className="text-[10px] text-neutral-400">52W low: {scannerPrice(s.fiftyTwoWeekLow)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-500/10 text-purple-300 font-bold border border-purple-500/20">
                        +{scannerNumber(s.distFrom52WLow)}% off low
                      </span>
                      <button
                        onClick={() => launchBacktest(s.id, s.date)}
                        className="p-1 rounded bg-[#1e1e21] hover:bg-[#27272a] text-white"
                        title="Backtest"
                      >
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
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
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Long Build Up */}
            <div className="bg-[#171719] border border-emerald-500/30 rounded-2xl p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-emerald-400 flex items-center gap-1">
                  <TrendingUp className="w-3.5 h-3.5" /> Long Build-Up
                </span>
                <span className="text-[10px] font-mono text-neutral-400">Price ▲ | OI ▲</span>
              </div>
              <p className="text-[10px] text-neutral-400">Aggressive institutional buying & expanding positions</p>
              <div className="space-y-1.5 pt-1">
                {movers?.derivativesBuildup.longBuildup.slice(0, 4).map(s => (
                  <div
                    key={`long_buildup_${s.id}_${s.ticker}`}
                    onClick={() => launchBacktest(s.id, s.date)}
                    className="p-2 bg-[#151517] rounded-lg border border-[rgba(236,236,237,0.08)] hover:border-emerald-500/40 cursor-pointer flex justify-between text-xs"
                  >
                    <span className="font-bold text-white">{s.ticker}</span>
                    <span className="text-emerald-400 font-mono font-semibold">{scannerPercent(s.changePercent)} (OI {scannerPercent(s.oiChangePercent)})</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Short Covering */}
            <div className="bg-[#171719] border border-cyan-500/30 rounded-2xl p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-cyan-400 flex items-center gap-1">
                  <Zap className="w-3.5 h-3.5" /> Short Covering
                </span>
                <span className="text-[10px] font-mono text-neutral-400">Price ▲ | OI ▼</span>
              </div>
              <p className="text-[10px] text-neutral-400">Bears rushing to buy back & close short contracts</p>
              <div className="space-y-1.5 pt-1">
                {movers?.derivativesBuildup.shortCovering.slice(0, 4).map(s => (
                  <div
                    key={`short_covering_${s.id}_${s.ticker}`}
                    onClick={() => launchBacktest(s.id, s.date)}
                    className="p-2 bg-[#151517] rounded-lg border border-[rgba(236,236,237,0.08)] hover:border-cyan-500/40 cursor-pointer flex justify-between text-xs"
                  >
                    <span className="font-bold text-white">{s.ticker}</span>
                    <span className="text-cyan-400 font-mono font-semibold">{scannerPercent(s.changePercent)} (OI {scannerPercent(s.oiChangePercent)})</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Short Build Up */}
            <div className="bg-[#171719] border border-rose-500/30 rounded-2xl p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-rose-400 flex items-center gap-1">
                  <TrendingDown className="w-3.5 h-3.5" /> Short Build-Up
                </span>
                <span className="text-[10px] font-mono text-neutral-400">Price ▼ | OI ▲</span>
              </div>
              <p className="text-[10px] text-neutral-400">Fresh short positions created with downside momentum</p>
              <div className="space-y-1.5 pt-1">
                {movers?.derivativesBuildup.shortBuildup.slice(0, 4).map(s => (
                  <div
                    key={`short_buildup_${s.id}_${s.ticker}`}
                    onClick={() => launchBacktest(s.id, s.date)}
                    className="p-2 bg-[#151517] rounded-lg border border-[rgba(236,236,237,0.08)] hover:border-rose-500/40 cursor-pointer flex justify-between text-xs"
                  >
                    <span className="font-bold text-white">{s.ticker}</span>
                    <span className="text-rose-400 font-mono font-semibold">{scannerPercent(s.changePercent)} (OI {scannerPercent(s.oiChangePercent)})</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Long Unwinding */}
            <div className="bg-[#171719] border border-amber-500/30 rounded-2xl p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-amber-400 flex items-center gap-1">
                  <TrendingUpDown className="w-3.5 h-3.5" /> Long Unwinding
                </span>
                <span className="text-[10px] font-mono text-neutral-400">Price ▼ | OI ▼</span>
              </div>
              <p className="text-[10px] text-neutral-400">Profit booking by bullish position holders</p>
              <div className="space-y-1.5 pt-1">
                {movers?.derivativesBuildup.longUnwinding.slice(0, 4).map(s => (
                  <div
                    key={`long_unwind_${s.id}_${s.ticker}`}
                    onClick={() => launchBacktest(s.id, s.date)}
                    className="p-2 bg-[#151517] rounded-lg border border-[rgba(236,236,237,0.08)] hover:border-amber-500/40 cursor-pointer flex justify-between text-xs"
                  >
                    <span className="font-bold text-white">{s.ticker}</span>
                    <span className="text-amber-400 font-mono font-semibold">{scannerPercent(s.changePercent)} (OI {scannerPercent(s.oiChangePercent)})</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {modelModeUnavailable && (
        <div role="status" className="rounded-2xl border border-dashed border-[rgba(236,236,237,0.16)] bg-[#171719]/40 p-8 text-center space-y-3">
          <p className="text-sm font-semibold text-neutral-200">The {latestOnlyLabel} view is a fictional demo model</p>
          <p className="mx-auto max-w-xl text-xs leading-5 text-neutral-400">
            This server is running real observed market data, so model-only derivatives are disabled. No observed derivative, synthetic price or live quote is substituted here.
          </p>
          <button
            type="button"
            onClick={() => setActiveTab('movers')}
            className="rounded-lg border border-[rgba(236,236,237,0.16)] bg-[#1e1e21] px-3 py-1.5 text-xs font-semibold text-neutral-200 hover:bg-[#27272a]"
          >
            Back to gainers &amp; losers
          </button>
        </div>
      )}

      {/* TAB: OPTION CHAIN & GREEKS */}
      {activeTab === 'option_chain' && !latestOnlyUnavailable && !modelModeUnavailable && (
        <OptionChainScanner key={contextKey} onSelectStockAndBacktest={symbolId => launchBacktest(symbolId)} />
      )}

      {/* TAB: VOLUME PROFILE & MICROSTRUCTURE VWAP */}
      {activeTab === 'volume_profile' && !latestOnlyUnavailable && !modelModeUnavailable && (
        <VolumeProfileScanner key={contextKey} onSelectStockAndBacktest={symbolId => launchBacktest(symbolId)} />
      )}

      {/* TAB: AUTOMATED GTT BRACKET & TRAILING STOP-LOSS ORDER CALCULATOR */}
      {activeTab === 'gtt_bracket' && !latestOnlyUnavailable && !modelModeUnavailable && (
        <GttBracketCalculator key={contextKey} onSelectStockAndBacktest={symbolId => launchBacktest(symbolId)} />
      )}

      {/* TAB: CASH VS FUTURES BASIS & CALENDAR SPREAD SCANNER */}
      {activeTab === 'basis_spreads' && !latestOnlyUnavailable && !modelModeUnavailable && (
        <BasisSpreadScanner key={contextKey} onSelectStockAndBacktest={symbolId => launchBacktest(symbolId)} />
      )}

      {/* TAB 4: MARKET BREADTH & SECTOR HEATMAP */}
      {activeTab === 'breadth_sectors' && (
        <div className="space-y-4">
          {/* Breadth Overview */}
          {movers && (
            <div className="bg-[#171719] border border-[rgba(236,236,237,0.08)] rounded-2xl p-4 sm:p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white">NSE Market Breadth (Advances vs Declines)</h3>
                <span className="text-xs font-mono font-bold text-neutral-300">
                  ADR: <span className="text-cyan-400">{scannerNumber(movers.marketBreadth.advanceDeclineRatio, 2)}</span> ({scannerNumber(movers.marketBreadth.bullishPercent, 1)}% bullish)
                </span>
              </div>

              {/* Progress Bar */}
              <div className="w-full h-4 bg-[#151517] rounded-full overflow-hidden flex border border-[rgba(236,236,237,0.08)]">
                <div
                  style={{ width: `${movers.marketBreadth.bullishPercent}%` }}
                  className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 flex items-center justify-center text-[10px] font-bold text-[#101012]"
                >
                  {movers.marketBreadth.advances} Advancing
                </div>
                <div
                  style={{ width: `${100 - movers.marketBreadth.bullishPercent}%` }}
                  className="h-full bg-gradient-to-r from-rose-600 to-rose-400 flex items-center justify-center text-[10px] font-bold text-white"
                >
                  {movers.marketBreadth.declines} Declining
                </div>
              </div>
            </div>
          )}

          {/* Sector Heatmap Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {movers?.sectorHeatmap.map(sec => (
              <div
                key={sec.sector}
                className="p-4 bg-[#171719] border border-[rgba(236,236,237,0.08)] rounded-2xl space-y-3 hover:border-[rgba(236,236,237,0.12)] transition-all"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="font-bold text-sm text-white">{sec.sector}</h4>
                    <span className="text-[11px] text-neutral-400">{sec.count} Constituents</span>
                  </div>
                  <div
                    className={`text-sm font-extrabold font-mono px-2.5 py-1 rounded-lg ${
                      sec.avgChangePercent >= 0
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                    }`}
                  >
                    {scannerPercent(sec.avgChangePercent)}
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs text-neutral-400 pt-2 border-t border-[rgba(236,236,237,0.08)]">
                  <span className="text-emerald-400 font-semibold">{sec.advances} Advancing</span>
                  <span className="text-rose-400 font-semibold">{sec.declines} Declining</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 5: TECHNICAL REGIMES */}
      {activeTab === 'trends' && (
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-neutral-400 px-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span>
                Showing <strong className="text-white">{filteredTrends.length}</strong> active {currentUniverseConfig.shortLabel} constituents
              </span>
              {filteredTrends.length > TREND_ITEMS_PER_PAGE && (
                <span className="text-[11px] px-2 py-0.5 rounded-md bg-[#1e1e21] text-amber-300 font-mono">
                  Page {currentPageSafe} of {totalTrendPages} ({paginatedTrends.length} shown)
                </span>
              )}
              <p className="w-full text-[10px] text-neutral-500">
                Technical ranks use the {rankingSession} EOD session. Live LTPs are a separate Angel One overlay.
              </p>
            </div>
            
            {/* Quick Filter Chips */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {(['ALL', 'BULLISH', 'OVERSOLD', 'BREAKOUT', 'GOLDEN_CROSS'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => {
                    setTrendFilter(f);
                    setTrendPage(1);
                  }}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                    trendFilter === f
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      : 'bg-[#151517] text-neutral-400 border border-[rgba(236,236,237,0.08)] hover:text-white'
                  }`}
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

          {/* Quick Search across 2000+ Universe */}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-500" />
            <input
              type="text"
              value={trendSearchQuery}
              onChange={e => {
                setTrendSearchQuery(e.target.value);
                setTrendPage(1);
              }}
              placeholder={`Search across ${trends.length > 0 ? trends.length : '2,000+'} stocks (e.g. RELIANCE, TCS, TATAMOTORS, HDFCBANK, ZOMATO, or sector)...`}
              className="w-full pl-9 pr-24 py-2 bg-[#171719] border border-[rgba(236,236,237,0.08)] rounded-xl text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/30"
            />
            {trendSearchQuery && (
              <button
                onClick={() => {
                  setTrendSearchQuery('');
                  setTrendPage(1);
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-neutral-400 hover:text-white bg-[#1e1e21] px-2 py-0.5 rounded-md"
              >
                Clear
              </button>
            )}
          </div>

          {isLoadingTrends ? (
            <div className="p-16 text-center border border-dashed border-[rgba(236,236,237,0.08)] rounded-2xl bg-[#171719]/30 text-neutral-400 space-y-3">
              <div className="w-8 h-8 border-2 border-amber-400 border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-xs">Loading available price data and evaluating trends; coverage may be partial.</p>
            </div>
          ) : filteredTrends.length === 0 ? (
            <div className="p-12 text-center border border-[rgba(236,236,237,0.08)] rounded-2xl bg-[#171719]/30 text-neutral-400 space-y-2">
              <Search className="w-6 h-6 text-neutral-500 mx-auto" />
              <p className="text-sm font-semibold text-neutral-300">{marketEvaluated > 0 ? `No matching stocks in the evaluated subset for "${trendSearchQuery}"` : 'Trends unavailable: no evaluated price coverage.'}</p>
              {marketEvaluated === 0 && <button type="button" onClick={retryActiveView} className="text-xs underline text-amber-400">Retry market snapshot</button>}
              <p className="text-xs text-neutral-500">{marketEvaluated > 0 ? 'Try searching for a different symbol or clear your filter' : 'Reload the snapshot to retry unavailable data.'}</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {paginatedTrends.map(t => (
                  <div
                    key={`trend_${t.id}_${t.ticker}`}
                    className="p-4 bg-[#171719] border border-[rgba(236,236,237,0.08)] rounded-2xl hover:border-amber-500/40 transition-all space-y-3 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-extrabold text-base text-white">{t.ticker}</span>
                          <span className="text-[10px] text-neutral-400">{t.sector}</span>
                        </div>
                        <p className="text-xs text-neutral-400 mt-0.5">{t.name}</p>
                      </div>

                      <div className="text-right shrink-0">
                        <div className="font-mono font-extrabold text-base text-white">
                          {scannerPrice(t.ltp)}
                        </div>
                        <div
                          className={`text-xs font-bold flex items-center justify-end gap-1 ${
                            t.changePercent >= 0 ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {t.changePercent >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                          <span>{scannerPercent(t.changePercent)}</span>
                        </div>
                      </div>
                    </div>

                    {liveQuoteFor(t.id) && <LiveQuoteLine quote={liveQuoteFor(t.id)!} eodClose={t.ltp} className="border-t border-white/6 pt-2" />}

                    <div className="flex items-center justify-between p-2.5 bg-[#151517] border border-[rgba(236,236,237,0.08)] rounded-xl text-[11px]">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`w-2 h-2 rounded-full ${
                            t.trend === 'STRONG_BULLISH'
                              ? 'bg-emerald-400 animate-pulse'
                              : t.trend === 'BULLISH'
                              ? 'bg-emerald-500'
                              : t.trend === 'OVERSOLD_REVERSAL'
                              ? 'bg-amber-400'
                              : 'bg-rose-400'
                          }`}
                        />
                        <span className="font-semibold text-neutral-200">{t.trendLabel}</span>
                      </div>
                      <span className="font-mono font-bold text-amber-400 text-[10px] uppercase">
                        {t.signalLabel}
                      </span>
                    </div>

                    <div className="grid grid-cols-4 gap-2 text-center text-[10px] font-mono p-2 bg-[#151517]/40 rounded-xl border border-[rgba(236,236,237,0.08)]/60">
                      <div>
                        <span className="text-neutral-500 block text-[9px]">RSI (14)</span>
                        <span className={`font-bold ${t.rsi > 65 ? 'text-emerald-400' : t.rsi < 35 ? 'text-amber-400' : 'text-neutral-300'}`}>
                          {scannerNumber(t.rsi, 1)}
                        </span>
                      </div>
                      <div>
                        <span className="text-neutral-400 block text-[9px]">20 EMA</span>
                        <span className="text-neutral-300 font-semibold">{scannerPrice(t.ema20)}</span>
                      </div>
                      <div>
                        <span className="text-neutral-400 block text-[9px]">50 SMA</span>
                        <span className="text-neutral-300 font-semibold">{scannerPrice(t.sma50)}</span>
                      </div>
                      <div>
                        <span className="text-neutral-400 block text-[9px]">Day High/Low</span>
                        <span className="text-neutral-400">{scannerNumber(t.high)} / {scannerNumber(t.low)}</span>
                      </div>
                    </div>

                    <button
                      onClick={() => launchBacktest(t.id, t.date)}
                      className="w-full py-2 rounded-xl bg-amber-500/10 hover:bg-amber-500 text-amber-400 hover:text-[#101012] font-bold text-xs border border-amber-500/30 flex items-center justify-center gap-1.5 transition-all shadow-sm group"
                    >
                      <span>Backtest active strategy on {t.ticker}</span>
                      <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                    </button>
                  </div>
                ))}
              </div>

              {/* Pagination Controls */}
              {totalTrendPages > 1 && (
                <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-[#171719]/80 border border-[rgba(236,236,237,0.08)] rounded-xl text-xs text-neutral-400">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setTrendPage(p => Math.max(1, p - 1))}
                      disabled={currentPageSafe <= 1}
                      className="px-3 py-1.5 rounded-lg bg-[#1e1e21] hover:bg-[#27272a] disabled:opacity-40 disabled:pointer-events-none text-white font-medium flex items-center gap-1 transition-all"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                      <span>Previous</span>
                    </button>
                    <button
                      onClick={() => setTrendPage(p => Math.min(totalTrendPages, p + 1))}
                      disabled={currentPageSafe >= totalTrendPages}
                      className="px-3 py-1.5 rounded-lg bg-[#1e1e21] hover:bg-[#27272a] disabled:opacity-40 disabled:pointer-events-none text-white font-medium flex items-center gap-1 transition-all"
                    >
                      <span>Next</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-neutral-400">
                      Page <strong className="text-white">{currentPageSafe}</strong> of <strong className="text-white">{totalTrendPages}</strong>
                    </span>
                    <span className="text-neutral-500">•</span>
                    <span className="text-neutral-400">{filteredTrends.length} total matching stocks</span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* TAB 6: STRATEGY SCREENER MATCHES */}
      {activeTab === 'strategy_matches' && (
        <div className="space-y-3">
          {scanResult && !scanError && (
            <div className="flex items-center justify-between text-xs text-neutral-400 px-1">
              <span>
                Evaluated <strong className="text-white">{scanResult.succeeded}</strong> symbols in the requested subset • Found{' '}
                <strong className="text-emerald-400">{scanResult.succeeded > 0 ? scanResult.matched : 'unavailable'}</strong> matching trigger setups. Unavailable: {scanResult.unavailable}; failed: {scanResult.failed}.
              </span>
              <span className="text-[11px] font-mono text-neutral-500">Source: {(SOURCE_LABELS[scanResult.dataSource] ?? scanResult.dataSource.toLowerCase().replace(/_/g, ' '))} · not live</span>
            </div>
          )}

          {isScanning ? (
            <div className="p-16 text-center border border-dashed border-[rgba(236,236,237,0.08)] rounded-2xl bg-[#171719]/30 text-neutral-400 space-y-3">
              <div className="w-8 h-8 border-2 border-amber-400 border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-xs">Evaluating technical rules against universe...</p>
            </div>
          ) : !scanError && scanResult && scanResult.matches.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {scanResult.matches.map((m, idx) => (
                <div
                  key={`scan_${m.symbolId}_${m.ticker}_${idx}`}
                  className="p-4 bg-[#171719] border border-[rgba(236,236,237,0.08)] rounded-2xl hover:border-amber-500/40 transition-all space-y-3 shadow-sm"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-extrabold text-base text-white">{m.ticker}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#1e1e21] text-neutral-400 font-medium">
                          {m.sector}
                        </span>
                      </div>
                      <p className="text-xs text-neutral-400 mt-0.5">{m.name}</p>
                    </div>

                    <div className="text-right">
                      <div className="font-mono font-bold text-base text-white">{scannerPrice(m.lastClose)}</div>
                      <div className={`text-xs font-semibold ${m.changePercent >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {scannerPercent(m.changePercent)}
                      </div>
                    </div>
                  </div>

                  <div className="p-2.5 bg-[#151517]/70 border border-[rgba(236,236,237,0.08)] rounded-xl space-y-1.5 text-[11px]">
                    <span className="text-[10px] font-bold text-emerald-400 flex items-center gap-1 uppercase tracking-wider">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Entry Rule Verified:
                    </span>
                    {m.matchedRules.map((r, idx) => (
                      <div key={idx} className="flex justify-between text-neutral-300">
                        <span className="font-mono text-neutral-400">{r.rule}</span>
                        <span className="font-mono font-semibold text-emerald-400">
                          Actual: {scannerNumber(r.actualLeft)} vs {scannerNumber(r.actualRight)}
                        </span>
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={() => launchBacktest(m.symbolId, m.lastDate)}
                    className="w-full py-2.5 rounded-xl bg-amber-500/10 hover:bg-amber-500 text-amber-400 hover:text-[#101012] font-bold text-xs border border-amber-500/30 flex items-center justify-center gap-1.5 transition-all shadow-sm group"
                  >
                    <span>Load & Run Backtest on {m.ticker}</span>
                    <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-12 text-center border border-dashed border-[rgba(236,236,237,0.08)] rounded-2xl bg-[#171719]/30 text-neutral-500 text-xs space-y-2">
              <p>{scanError ? 'Strategy scan failed. Results are unavailable; retry the scan.' : scanResult && scanResult.succeeded > 0 && scanResult.matched === 0 ? `No matches in the ${scanResult.succeeded} evaluated symbols. This does not establish no matches across the full universe.` : 'Strategy results unavailable: no evaluated coverage was reported.'}</p>
              {!scanError && <button type="button" onClick={() => void runScan()} className="underline text-amber-400">Retry strategy scan</button>}
              <button
                onClick={() => setActiveTab('movers')}
                className="px-3 py-1.5 rounded-lg bg-[#1e1e21] text-amber-400 font-semibold text-xs border border-[rgba(236,236,237,0.12)] hover:bg-[#27272a]"
              >
                Switch to Top Gainers / Losers View
              </button>
            </div>
          )}
        </div>
      )}

      </>)}

      {/* Interactive Full Calendar Modal */}
      <TradingCalendarModal
        isOpen={isCalendarModalOpen}
        onClose={() => setIsCalendarModalOpen(false)}
        selectedDate={selectedDate || dataCutoff}
        onSelectDate={(date) => handleDateChange(date)}
        availableDates={coveredTradingDates}
        activeUniverseLabel={currentUniverseConfig.label}
        totalAssetsCount={trends.length}
      />
    </div>
  );
};
