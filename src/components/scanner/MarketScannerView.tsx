import React, { useState, useEffect } from 'react';
import { StrategyAST, UniverseScanResponse, StockTrendData, MarketMoversData } from '../../shared/strategy/types';
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

interface MarketScannerViewProps {
  strategy: StrategyAST;
  onSelectStockAndBacktest: (symbolId: number) => void;
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
  icon: string;
}

export const UNIVERSE_LIST: UniverseConfig[] = [
  { id: 'ALL', label: 'All Markets (NSE + BSE — 2,088 Assets)', shortLabel: 'All (NSE+BSE)', category: 'All', description: 'Complete universe across all 2,088 NSE and BSE equities and benchmark indices', badge: 'NSE + BSE', icon: '🌐' },
  { id: 'NSE', label: 'All NSE Stocks (2,050 Listed Equities)', shortLabel: 'All NSE (2050+)', category: 'Exchange', description: 'Complete universe across all 2,050+ National Stock Exchange (NSE) listed equities', badge: 'NSE 2000+', icon: '📈' },
  { id: 'BSE', label: 'All BSE Stocks (SENSEX & Large-Caps)', shortLabel: 'All BSE', category: 'Exchange', description: 'Bombay Stock Exchange (BSE) listed equities', badge: 'BSE', icon: '🏛️' },
  { id: 'NIFTY_50', label: 'NIFTY 50 Bluechips', shortLabel: 'NIFTY 50', category: 'Benchmark & Sector Indices', description: 'Top 50 large-cap bluechip stocks of India', badge: 'NIFTY 50', icon: '💎' },
  { id: 'BANK_NIFTY', label: 'Bank NIFTY', shortLabel: 'Bank Nifty', category: 'Benchmark & Sector Indices', description: 'Leading private and PSU banking giants', badge: 'BANK', icon: '🏦' },
  { id: 'NIFTY_IT', label: 'NIFTY IT', shortLabel: 'NIFTY IT', category: 'Benchmark & Sector Indices', description: 'Top technology & software exporters', badge: 'IT', icon: '💻' },
  { id: 'NIFTY_AUTO', label: 'NIFTY Auto', shortLabel: 'NIFTY Auto', category: 'Benchmark & Sector Indices', description: 'Leading automotive, 2-wheeler, EV & commercial vehicle OEMs', badge: 'AUTO', icon: '🚗' },
  { id: 'NIFTY_PHARMA', label: 'NIFTY Pharma', shortLabel: 'NIFTY Pharma', category: 'Benchmark & Sector Indices', description: 'Top pharmaceutical & healthcare leaders', badge: 'PHARMA', icon: '💊' },
  { id: 'NIFTY_METAL', label: 'NIFTY Metal', shortLabel: 'NIFTY Metal', category: 'Benchmark & Sector Indices', description: 'Steel, aluminium, mining & base metal companies', badge: 'METAL', icon: '⛏️' },
  { id: 'NIFTY_FMCG', label: 'NIFTY FMCG', shortLabel: 'NIFTY FMCG', category: 'Benchmark & Sector Indices', description: 'Fast-moving consumer goods & household staples', badge: 'FMCG', icon: '🛒' },
  { id: 'BSE_SENSEX', label: 'BSE SENSEX 30', shortLabel: 'BSE Sensex', category: 'Benchmark & Sector Indices', description: 'BSE flagship 30 well-established companies', badge: 'SENSEX', icon: '🏢' },
  { id: 'POPULAR_INDICES', label: 'Popular Indices', shortLabel: 'Major Indices', category: 'Benchmark & Sector Indices', description: 'All major benchmark & sectoral market indices (^NSEI, ^NSEBANK, ^BSESN, etc.)', badge: 'INDICES', icon: '📊' }
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
  const [selectedUniverse, setSelectedUniverse] = useState<MarketUniverseType>('ALL');
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [isCalendarModalOpen, setIsCalendarModalOpen] = useState<boolean>(false);
  const [availableTradingDates, setAvailableTradingDates] = useState<TradingSessionDate[]>([]);
  const [trendFilter, setTrendFilter] = useState<'ALL' | 'BULLISH' | 'OVERSOLD' | 'BREAKOUT' | 'GOLDEN_CROSS'>('ALL');
  const [trendSearchQuery, setTrendSearchQuery] = useState('');
  const [trendPage, setTrendPage] = useState(1);
  const TREND_ITEMS_PER_PAGE = 40;
  const [isScanning, setIsScanning] = useState(false);
  const [isLoadingTrends, setIsLoadingTrends] = useState(false);
  const [scanResult, setScanResult] = useState<UniverseScanResponse | null>(null);
  const [trends, setTrends] = useState<StockTrendData[]>([]);
  const [movers, setMovers] = useState<MarketMoversData | null>(null);

  // Active universe metadata
  const currentUniverseConfig = UNIVERSE_LIST.find(u => u.id === selectedUniverse) || UNIVERSE_LIST[0];

  // Fetch available trading session dates on mount
  useEffect(() => {
    fetch('/api/market/dates')
      .then(r => r.json())
      .then(data => {
        if (data && data.success && Array.isArray(data.dates)) {
          setAvailableTradingDates(data.dates);
        }
      })
      .catch(() => {});
  }, []);

  // Fetch actual stock prices and quantitative market trends & movers for selected universe & date
  const fetchMarketData = async (
    forceSync: boolean = false,
    univ: MarketUniverseType = selectedUniverse,
    date: string = selectedDate
  ) => {
    setIsLoadingTrends(true);
    try {
      if (forceSync) {
        await fetch('/api/market/refresh', { method: 'POST' }).catch(() => {});
      }
      const dateParam = date ? `&date=${encodeURIComponent(date)}` : '';
      const [trendsRes, moversRes] = await Promise.all([
        fetch(`/api/market/trends?universe=${encodeURIComponent(univ)}${dateParam}`)
          .then(async r => {
            if (!r.ok) return { success: false, error: `HTTP ${r.status}` };
            return r.json().catch(() => ({ success: false, error: 'Malformed response' }));
          })
          .catch(err => ({ success: false, error: err?.message || 'Network error' })),
        fetch(`/api/market/movers?universe=${encodeURIComponent(univ)}${dateParam}`)
          .then(async r => {
            if (!r.ok) return { success: false, error: `HTTP ${r.status}` };
            return r.json().catch(() => ({ success: false, error: 'Malformed response' }));
          })
          .catch(err => ({ success: false, error: err?.message || 'Network error' }))
      ]);

      if (trendsRes && trendsRes.success && Array.isArray(trendsRes.trends)) {
        setTrends(trendsRes.trends);
      }
      if (moversRes && moversRes.success) {
        setMovers(moversRes);
        if (moversRes.availableTradingSessions && moversRes.availableTradingSessions.length > 0) {
          setAvailableTradingDates(moversRes.availableTradingSessions);
        }
      }
    } catch (e) {
      console.error('Failed to load market scanner data:', e);
    } finally {
      setIsLoadingTrends(false);
    }
  };

  // Run strategy rule screener
  const runScan = async (univ: MarketUniverseType = selectedUniverse) => {
    setIsScanning(true);
    try {
      const scanUniv = univ;
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          universe: scanUniv,
          strategyJson: strategy,
          limit: 35
        })
      });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (data && data.success) {
          setScanResult(data);
        }
      }
    } catch (e) {
      console.error('Scan failed:', e);
    } finally {
      setIsScanning(false);
    }
  };

  useEffect(() => {
    fetchMarketData(false, selectedUniverse, selectedDate);
    runScan(selectedUniverse);
  }, [selectedUniverse, selectedDate]);

  const handleUniverseChange = (newUniv: MarketUniverseType) => {
    setSelectedUniverse(newUniv);
    setTrendPage(1);
  };

  const handleDateChange = (newDate: string) => {
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

  return (
    <div className="w-full max-w-6xl mx-auto p-3 sm:p-5 space-y-4 pb-24">
      {/* Top Header Card */}
      <div className="bg-[#161619] border border-[rgba(236,236,237,0.08)] rounded-2xl p-4 sm:p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
              <Radio className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white tracking-tight flex items-center gap-2 flex-wrap">
                <span>NSE & BSE Market Scanner & Institutional Intelligence</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">
                  SmartAPI Synchronized
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#1d1d21] text-neutral-300 border border-[rgba(236,236,237,0.12)] font-mono flex items-center gap-1">
                  <Calendar className="w-3 h-3 text-amber-400" />
                  <span>Session: {movers?.formattedDate || movers?.asOfDate || availableTradingDates[0]?.label || 'Latest Live Session'}</span>
                </span>
              </h2>
              <p className="text-xs text-neutral-400">
                Live Top Gainers/Losers across NSE, BSE, Nifty 50, Bank Nifty, Sectoral Indexes, 52W Radars, and Derivatives Telemetry
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={async (e) => {
                e.preventDefault();
                e.stopPropagation();
                await fetchMarketData(true, selectedUniverse, selectedDate);
                await runScan(selectedUniverse);
              }}
              disabled={isScanning || isLoadingTrends}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1d1d21] hover:bg-[#27272a] text-white font-semibold text-xs rounded-xl border border-[rgba(236,236,237,0.12)] shadow-sm active:scale-95 transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isScanning || isLoadingTrends ? 'animate-spin text-amber-400' : ''}`} />
              <span>{isScanning || isLoadingTrends ? 'Syncing Live Feed...' : 'Sync Live Market'}</span>
            </button>
          </div>
        </div>

        {/* Global Universe & Trading Session Date Filter Bar */}
        <div className="p-3 bg-[#141417] border border-[rgba(236,236,237,0.08)] rounded-xl space-y-3">
          {/* Row 1: Universe Selection */}
          <div className="flex items-center justify-between gap-2 flex-wrap text-xs">
            <div className="flex items-center gap-1.5 text-neutral-300 font-semibold">
              <Filter className="w-3.5 h-3.5 text-amber-400" />
              <span>Market Universe / Index:</span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 font-mono border border-amber-500/20">
                {currentUniverseConfig.label} ({movers?.totalFilteredCount || trends.length} Assets)
              </span>
            </div>
            
            {/* Quick dropdown for all 12 options */}
            <select
              value={selectedUniverse}
              onChange={(e) => handleUniverseChange(e.target.value as MarketUniverseType)}
              className="bg-[#161619] border border-[rgba(236,236,237,0.12)] text-white text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-amber-500 font-medium"
            >
              <optgroup label="Broad & Exchanges">
                <option value="ALL">🌐 All Markets (NSE + BSE)</option>
                <option value="NSE">📈 All NSE Stocks</option>
                <option value="BSE">🏛️ All BSE Stocks</option>
              </optgroup>
              <optgroup label="Popular Benchmark Indices">
                <option value="NIFTY_50">💎 NIFTY 50 Bluechips</option>
                <option value="BANK_NIFTY">🏦 Bank NIFTY</option>
                <option value="BSE_SENSEX">🏢 BSE SENSEX 30</option>
                <option value="POPULAR_INDICES">📊 Popular Indices Feed</option>
              </optgroup>
              <optgroup label="Sectoral Indices">
                <option value="NIFTY_IT">💻 NIFTY IT</option>
                <option value="NIFTY_AUTO">🚗 NIFTY Auto</option>
                <option value="NIFTY_PHARMA">💊 NIFTY Pharma</option>
                <option value="NIFTY_METAL">⛏️ NIFTY Metal</option>
                <option value="NIFTY_FMCG">🛒 NIFTY FMCG</option>
              </optgroup>
            </select>
          </div>

          {/* Rapid Universe Pill Switchers */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar text-xs">
            {UNIVERSE_LIST.map((u) => {
              const isActive = selectedUniverse === u.id;
              return (
                <button
                  key={u.id}
                  onClick={() => handleUniverseChange(u.id)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                    isActive
                      ? 'bg-amber-500 text-[#0c0c0e] shadow-sm font-bold scale-[1.02]'
                      : 'bg-[#161619] text-neutral-400 hover:text-white hover:bg-[#1d1d21] border border-[rgba(236,236,237,0.08)]'
                  }`}
                  title={u.description}
                >
                  <span>{u.icon}</span>
                  <span>{u.shortLabel}</span>
                </button>
              );
            })}
          </div>

          {/* Row 2: Date / Session Filter Field & Interactive Calendar */}
          <div className="pt-2 border-t border-[rgba(236,236,237,0.08)] flex items-center justify-between gap-3 flex-wrap text-xs">
            <div className="flex items-center gap-2 flex-wrap">
              {/* Interactive Calendar Trigger Button */}
              <button
                type="button"
                onClick={() => setIsCalendarModalOpen(true)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gradient-to-r from-cyan-500/20 to-blue-500/20 hover:from-cyan-500/30 hover:to-blue-500/30 border border-cyan-500/40 text-cyan-300 hover:text-cyan-200 font-bold transition-all shadow-sm group"
                title="Open full interactive trading session calendar"
              >
                <Calendar className="w-4 h-4 text-cyan-400 group-hover:scale-110 transition-transform" />
                <span>Choose Any Date (Calendar View)</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-cyan-500/30 text-white font-mono">
                  {selectedDate || availableTradingDates[0]?.date || 'Latest Session'}
                </span>
              </button>

              {/* Date Session Dropdown */}
              <select
                value={selectedDate || availableTradingDates[0]?.date || ''}
                onChange={(e) => handleDateChange(e.target.value)}
                className="bg-[#161619] border border-[rgba(236,236,237,0.12)] text-cyan-300 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-cyan-500 font-medium max-w-[200px] truncate"
              >
                {availableTradingDates.map((item) => (
                  <option key={item.date} value={item.date}>
                    {item.label}
                  </option>
                ))}
              </select>

              {/* Direct HTML5 Date Picker Input */}
              <div className="flex items-center gap-1.5 bg-[#161619] border border-[rgba(236,236,237,0.12)] rounded-lg px-2 py-1">
                <span className="text-[10px] text-neutral-400 font-medium hidden sm:inline">Custom Date:</span>
                <input
                  type="date"
                  value={selectedDate || availableTradingDates[0]?.date || ''}
                  max={availableTradingDates[0]?.date || undefined}
                  min={availableTradingDates[availableTradingDates.length - 1]?.date || '2024-01-01'}
                  onChange={(e) => handleDateChange(e.target.value)}
                  className="bg-transparent text-white text-xs focus:outline-none font-mono cursor-pointer"
                />
              </div>

              {/* Quick Reset to Latest Session */}
              {selectedDate && selectedDate !== availableTradingDates[0]?.date && (
                <button
                  onClick={() => handleDateChange('')}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-300 hover:bg-amber-500 hover:text-[#0c0c0e] border border-amber-500/30 text-xs font-bold transition-all"
                  title="Reset to current/latest live market session"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Reset to Latest</span>
                </button>
              )}
            </div>

            {/* Quick Session Date Pills */}
            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar text-[11px]">
              <span className="text-neutral-500 text-[10px] uppercase font-bold mr-1">Recent Sessions:</span>
              {availableTradingDates.slice(0, 5).map((item) => {
                const isSelected = (!selectedDate && item.isLatest) || selectedDate === item.date;
                return (
                  <button
                    key={item.date}
                    onClick={() => handleDateChange(item.isLatest ? '' : item.date)}
                    className={`px-2 py-0.5 rounded-md font-mono transition-all whitespace-nowrap ${
                      isSelected
                        ? 'bg-cyan-500 text-[#0c0c0e] font-bold shadow-sm'
                        : 'bg-[#161619] text-neutral-400 hover:text-neutral-200 border border-[rgba(236,236,237,0.08)]'
                    }`}
                  >
                    {item.date.slice(5)} {item.isLatest ? '(Latest)' : ''}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-1.5 bg-[#141417] p-1 rounded-xl border border-[rgba(236,236,237,0.08)] text-xs overflow-x-auto no-scrollbar">
          <button
            onClick={() => setActiveTab('movers')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold whitespace-nowrap transition-all ${
              activeTab === 'movers' ? 'bg-amber-500 text-[#0c0c0e] shadow-sm' : 'text-neutral-400 hover:text-white'
            }`}
          >
            <Flame className="w-3.5 h-3.5" />
            <span>Top Gainers & Losers</span>
          </button>

          <button
            onClick={() => setActiveTab('volume_52w')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold whitespace-nowrap transition-all ${
              activeTab === 'volume_52w' ? 'bg-amber-500 text-[#0c0c0e] shadow-sm' : 'text-neutral-400 hover:text-white'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            <span>Volume Shockers & 52W Radar</span>
          </button>

          <button
            onClick={() => setActiveTab('derivatives_oi')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold whitespace-nowrap transition-all ${
              activeTab === 'derivatives_oi' ? 'bg-amber-500 text-[#0c0c0e] shadow-sm' : 'text-neutral-400 hover:text-white'
            }`}
          >
            <Gauge className="w-3.5 h-3.5" />
            <span>Derivatives OI & PCR</span>
          </button>

          <button
            onClick={() => setActiveTab('option_chain')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold whitespace-nowrap transition-all ${
              activeTab === 'option_chain' ? 'bg-cyan-500 text-[#0c0c0e] shadow-sm' : 'text-neutral-400 hover:text-white'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Option Chain & Greeks</span>
          </button>

          <button
            onClick={() => setActiveTab('volume_profile')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold whitespace-nowrap transition-all ${
              activeTab === 'volume_profile' ? 'bg-purple-500 text-[#0c0c0e] shadow-sm' : 'text-neutral-400 hover:text-white'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Volume Profile & VWAP</span>
          </button>

          <button
            onClick={() => setActiveTab('gtt_bracket')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold whitespace-nowrap transition-all ${
              activeTab === 'gtt_bracket' ? 'bg-amber-500 text-[#0c0c0e] shadow-sm' : 'text-neutral-400 hover:text-white'
            }`}
          >
            <Calculator className="w-3.5 h-3.5" />
            <span>GTT Bracket & Trailing SL</span>
          </button>

          <button
            onClick={() => setActiveTab('basis_spreads')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold whitespace-nowrap transition-all ${
              activeTab === 'basis_spreads' ? 'bg-emerald-500 text-[#0c0c0e] shadow-sm' : 'text-neutral-400 hover:text-white'
            }`}
          >
            <TrendingUpDown className="w-3.5 h-3.5" />
            <span>Basis & Calendar Spreads</span>
          </button>

          <button
            onClick={() => setActiveTab('breadth_sectors')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold whitespace-nowrap transition-all ${
              activeTab === 'breadth_sectors' ? 'bg-amber-500 text-[#0c0c0e] shadow-sm' : 'text-neutral-400 hover:text-white'
            }`}
          >
            <BarChart2 className="w-3.5 h-3.5" />
            <span>Market Breadth & Heatmap</span>
          </button>

          <button
            onClick={() => setActiveTab('trends')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold whitespace-nowrap transition-all ${
              activeTab === 'trends' ? 'bg-amber-500 text-[#0c0c0e] shadow-sm' : 'text-neutral-400 hover:text-white'
            }`}
          >
            <Compass className="w-3.5 h-3.5" />
            <span>Technical Regimes</span>
          </button>

          <button
            onClick={() => setActiveTab('strategy_matches')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold whitespace-nowrap transition-all ${
              activeTab === 'strategy_matches' ? 'bg-amber-500 text-[#0c0c0e] shadow-sm' : 'text-neutral-400 hover:text-white'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Strategy Matches ({scanResult?.matched || 0})</span>
          </button>
        </div>
      </div>

      {/* TAB 1: TOP GAINERS & TOP LOSERS */}
      {activeTab === 'movers' && (
        <div className="space-y-4">
          {/* Universe Header Banner for Gainers & Losers */}
          <div className="bg-[#161619]/80 border border-[rgba(236,236,237,0.08)] rounded-2xl p-3.5 sm:p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 font-bold">
                {currentUniverseConfig.icon}
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-extrabold text-white">
                    Top Gainers & Losers Ranking — {currentUniverseConfig.label}
                  </h3>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-[#141417] border border-[rgba(236,236,237,0.08)] text-amber-400 font-mono">
                    {movers?.totalFilteredCount || 0} Assets Evaluated
                  </span>
                  <span className={`text-[10px] px-2 py-0.5 rounded border font-mono flex items-center gap-1 ${
                    movers?.isHistorical
                      ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300 font-bold'
                      : 'bg-[#141417] border-[rgba(236,236,237,0.08)] text-neutral-300'
                  }`}>
                    <Calendar className="w-2.5 h-2.5 text-cyan-400" />
                    <span>{movers?.isHistorical ? `Historical Session: ${movers?.formattedDate || movers?.asOfDate}` : `Session: ${movers?.formattedDate || movers?.asOfDate || '14 Aug 2026'}`}</span>
                  </span>
                </div>
                <p className="text-[11px] text-neutral-400">{currentUniverseConfig.description}</p>
              </div>
            </div>

            {/* Quick Universe Filter Buttons */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs text-neutral-400 font-medium mr-1">Switch Universe:</span>
              {[
                { id: 'ALL', label: 'All' },
                { id: 'NSE', label: 'NSE' },
                { id: 'BSE', label: 'BSE' },
                { id: 'NIFTY_50', label: 'Nifty 50' },
                { id: 'BANK_NIFTY', label: 'Bank Nifty' },
                { id: 'NIFTY_IT', label: 'IT' },
                { id: 'BSE_SENSEX', label: 'Sensex' },
                { id: 'POPULAR_INDICES', label: 'Indices' }
              ].map((btn) => (
                <button
                  key={btn.id}
                  onClick={() => handleUniverseChange(btn.id as MarketUniverseType)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                    selectedUniverse === btn.id
                      ? 'bg-amber-500 text-[#0c0c0e] font-bold shadow-sm'
                      : 'bg-[#141417] text-neutral-400 hover:text-white border border-[rgba(236,236,237,0.08)]'
                  }`}
                >
                  {btn.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Top Gainers Column */}
            <div className="bg-[#161619] border border-emerald-500/30 rounded-2xl p-4 space-y-3 shadow-sm">
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
                  <span className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-[#141417] border border-emerald-500/30 text-emerald-400 font-mono font-bold">
                    <Calendar className="w-3 h-3 text-emerald-400" />
                    <span>{movers?.formattedDate || movers?.asOfDate || availableTradingDates[0]?.label || 'Latest'}</span>
                  </span>
                </div>
              </div>

              <div className="space-y-2.5">
                {(!movers?.topGainers || movers.topGainers.length === 0) ? (
                  <div className="p-8 text-center text-neutral-400 text-xs border border-dashed border-[rgba(236,236,237,0.08)] rounded-xl">
                    No gainers found in the selected universe for this session.
                  </div>
                ) : (
                  movers.topGainers.map((stock, i) => (
                    <div
                      key={`gainer_${stock.id}_${stock.ticker}_${i}`}
                      className="p-3 bg-[#141417] border border-[rgba(236,236,237,0.08)] hover:border-emerald-500/40 rounded-xl flex items-center justify-between gap-3 transition-all"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="text-xs font-mono font-bold text-neutral-500 w-4">{i + 1}</span>
                        <div className="truncate space-y-0.5">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-extrabold text-sm text-white">{stock.ticker}</span>
                            
                            {/* Exchange Badge (NSE / BSE) */}
                            <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded border ${
                              stock.exchange === 'BSE' 
                                ? 'bg-sky-500/10 text-sky-400 border-sky-500/30' 
                                : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                            }`}>
                              {stock.exchange || 'NSE'}
                            </span>

                            <span className="text-[9px] px-1.5 py-0.2 rounded bg-[#1d1d21] text-neutral-300">
                              {stock.sector}
                            </span>
                            
                            {/* Trade Date Badge */}
                            {(stock.formattedDate || stock.date) && (
                              <span className="text-[9px] px-1.5 py-0.2 rounded bg-[#161619] border border-[rgba(236,236,237,0.08)] text-emerald-400/90 font-mono flex items-center gap-0.5">
                                <Calendar className="w-2.5 h-2.5 text-emerald-500" />
                                <span>{stock.formattedDate || stock.date}</span>
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-neutral-400 truncate">{stock.name}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <div className="text-right">
                          <div className="font-mono font-extrabold text-sm text-white">
                            ₹{stock.ltp.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </div>
                          <div className="text-xs font-bold text-emerald-400 flex items-center justify-end gap-0.5">
                            <TrendingUp className="w-3 h-3" />
                            <span>+{stock.changePercent}%</span>
                          </div>
                        </div>

                        <button
                          onClick={() => onSelectStockAndBacktest(stock.id)}
                          className="px-2.5 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500 text-emerald-400 hover:text-[#0c0c0e] text-[11px] font-bold border border-emerald-500/30 transition-all flex items-center gap-1"
                          title="Backtest active strategy on this gainer"
                        >
                          <span>Backtest</span>
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Top Losers Column */}
            <div className="bg-[#161619] border border-rose-500/30 rounded-2xl p-4 space-y-3 shadow-sm">
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
                  <span className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-[#141417] border border-rose-500/30 text-rose-400 font-mono font-bold">
                    <Calendar className="w-3 h-3 text-rose-400" />
                    <span>{movers?.formattedDate || movers?.asOfDate || availableTradingDates[0]?.label || 'Latest'}</span>
                  </span>
                </div>
              </div>

              <div className="space-y-2.5">
                {(!movers?.topLosers || movers.topLosers.length === 0) ? (
                  <div className="p-8 text-center text-neutral-400 text-xs border border-dashed border-[rgba(236,236,237,0.08)] rounded-xl">
                    No losers found in the selected universe for this session.
                  </div>
                ) : (
                  movers.topLosers.map((stock, i) => (
                    <div
                      key={`loser_${stock.id}_${stock.ticker}_${i}`}
                      className="p-3 bg-[#141417] border border-[rgba(236,236,237,0.08)] hover:border-rose-500/40 rounded-xl flex items-center justify-between gap-3 transition-all"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="text-xs font-mono font-bold text-neutral-500 w-4">{i + 1}</span>
                        <div className="truncate space-y-0.5">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-extrabold text-sm text-white">{stock.ticker}</span>
                            
                            {/* Exchange Badge (NSE / BSE) */}
                            <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded border ${
                              stock.exchange === 'BSE' 
                                ? 'bg-sky-500/10 text-sky-400 border-sky-500/30' 
                                : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                            }`}>
                              {stock.exchange || 'NSE'}
                            </span>

                            <span className="text-[9px] px-1.5 py-0.2 rounded bg-[#1d1d21] text-neutral-300">
                              {stock.sector}
                            </span>

                            {/* Trade Date Badge */}
                            {(stock.formattedDate || stock.date) && (
                              <span className="text-[9px] px-1.5 py-0.2 rounded bg-[#161619] border border-[rgba(236,236,237,0.08)] text-rose-400/90 font-mono flex items-center gap-0.5">
                                <Calendar className="w-2.5 h-2.5 text-rose-500" />
                                <span>{stock.formattedDate || stock.date}</span>
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-neutral-400 truncate">{stock.name}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <div className="text-right">
                          <div className="font-mono font-extrabold text-sm text-white">
                            ₹{stock.ltp.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </div>
                          <div className="text-xs font-bold text-rose-400 flex items-center justify-end gap-0.5">
                            <TrendingDown className="w-3 h-3" />
                            <span>{stock.changePercent}%</span>
                          </div>
                        </div>

                        <button
                          onClick={() => onSelectStockAndBacktest(stock.id)}
                          className="px-2.5 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500 text-rose-400 hover:text-[#0c0c0e] text-[11px] font-bold border border-rose-500/30 transition-all flex items-center gap-1"
                          title="Backtest active strategy on this dip candidate"
                        >
                          <span>Backtest</span>
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      </div>
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
          <div className="bg-[#161619] border border-[rgba(236,236,237,0.08)] rounded-2xl p-4 sm:p-5 space-y-3">
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
                  className="p-3.5 bg-[#141417] border border-[rgba(236,236,237,0.08)] hover:border-amber-500/40 rounded-xl space-y-2.5 transition-all"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="font-extrabold text-sm text-white">{s.ticker}</span>
                      <p className="text-[11px] text-neutral-400">{s.sector}</p>
                    </div>
                    <div className="text-right">
                      <span className="font-bold text-xs text-white">₹{s.ltp.toFixed(2)}</span>
                      <div className={`text-[11px] font-bold ${s.changePercent >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {s.changePercent >= 0 ? '+' : ''}{s.changePercent}%
                      </div>
                    </div>
                  </div>

                  <div className="p-2 bg-[#161619]/80 rounded-lg border border-[rgba(236,236,237,0.08)]/60 flex items-center justify-between text-xs font-mono">
                    <div>
                      <span className="text-neutral-500 block text-[9px]">Volume Surge</span>
                      <span className="font-extrabold text-amber-400">{s.volumeRatio}x of 20D Avg</span>
                    </div>
                    <div className="text-right">
                      <span className="text-neutral-500 block text-[9px]">Today Volume</span>
                      <span className="text-neutral-300 font-semibold">{(s.volume / 100000).toFixed(1)} Lakhs</span>
                    </div>
                  </div>

                  <button
                    onClick={() => onSelectStockAndBacktest(s.id)}
                    className="w-full py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500 text-amber-400 hover:text-[#0c0c0e] text-xs font-bold border border-amber-500/30 transition-all flex items-center justify-center gap-1"
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
            <div className="bg-[#161619] border border-[rgba(236,236,237,0.08)] rounded-2xl p-4 space-y-3">
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
                  <div key={`high52_${s.id}_${s.ticker}`} className="p-2.5 bg-[#141417] border border-[rgba(236,236,237,0.08)] rounded-xl flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-extrabold text-xs text-white">{s.ticker}</span>
                        <span className="text-[9px] text-cyan-400 font-mono">₹{s.ltp}</span>
                      </div>
                      <span className="text-[10px] text-neutral-400">52W High: ₹{s.fiftyTwoWeekHigh}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-300 font-bold border border-cyan-500/20">
                        -{s.distFrom52WHigh}% away
                      </span>
                      <button
                        onClick={() => onSelectStockAndBacktest(s.id)}
                        className="p-1 rounded bg-[#1d1d21] hover:bg-[#27272a] text-white"
                        title="Backtest"
                      >
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-[#161619] border border-[rgba(236,236,237,0.08)] rounded-2xl p-4 space-y-3">
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
                  <div key={`low52_${s.id}_${s.ticker}`} className="p-2.5 bg-[#141417] border border-[rgba(236,236,237,0.08)] rounded-xl flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-extrabold text-xs text-white">{s.ticker}</span>
                        <span className="text-[9px] text-purple-400 font-mono">₹{s.ltp}</span>
                      </div>
                      <span className="text-[10px] text-neutral-400">52W Low: ₹{s.fiftyTwoWeekLow}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-500/10 text-purple-300 font-bold border border-purple-500/20">
                        +{s.distFrom52WLow}% off low
                      </span>
                      <button
                        onClick={() => onSelectStockAndBacktest(s.id)}
                        className="p-1 rounded bg-[#1d1d21] hover:bg-[#27272a] text-white"
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

      {/* TAB 3: DERIVATIVES OPEN INTEREST & PCR SENTIMENT */}
      {activeTab === 'derivatives_oi' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Long Build Up */}
            <div className="bg-[#161619] border border-emerald-500/30 rounded-2xl p-3.5 space-y-2">
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
                    onClick={() => onSelectStockAndBacktest(s.id)}
                    className="p-2 bg-[#141417] rounded-lg border border-[rgba(236,236,237,0.08)] hover:border-emerald-500/40 cursor-pointer flex justify-between text-xs"
                  >
                    <span className="font-bold text-white">{s.ticker}</span>
                    <span className="text-emerald-400 font-mono font-semibold">+{s.changePercent}% (OI +{s.oiChangePercent}%)</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Short Covering */}
            <div className="bg-[#161619] border border-cyan-500/30 rounded-2xl p-3.5 space-y-2">
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
                    onClick={() => onSelectStockAndBacktest(s.id)}
                    className="p-2 bg-[#141417] rounded-lg border border-[rgba(236,236,237,0.08)] hover:border-cyan-500/40 cursor-pointer flex justify-between text-xs"
                  >
                    <span className="font-bold text-white">{s.ticker}</span>
                    <span className="text-cyan-400 font-mono font-semibold">+{s.changePercent}% (OI {s.oiChangePercent}%)</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Short Build Up */}
            <div className="bg-[#161619] border border-rose-500/30 rounded-2xl p-3.5 space-y-2">
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
                    onClick={() => onSelectStockAndBacktest(s.id)}
                    className="p-2 bg-[#141417] rounded-lg border border-[rgba(236,236,237,0.08)] hover:border-rose-500/40 cursor-pointer flex justify-between text-xs"
                  >
                    <span className="font-bold text-white">{s.ticker}</span>
                    <span className="text-rose-400 font-mono font-semibold">{s.changePercent}% (OI +{s.oiChangePercent}%)</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Long Unwinding */}
            <div className="bg-[#161619] border border-amber-500/30 rounded-2xl p-3.5 space-y-2">
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
                    onClick={() => onSelectStockAndBacktest(s.id)}
                    className="p-2 bg-[#141417] rounded-lg border border-[rgba(236,236,237,0.08)] hover:border-amber-500/40 cursor-pointer flex justify-between text-xs"
                  >
                    <span className="font-bold text-white">{s.ticker}</span>
                    <span className="text-amber-400 font-mono font-semibold">{s.changePercent}% (OI {s.oiChangePercent}%)</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB: OPTION CHAIN & GREEKS */}
      {activeTab === 'option_chain' && (
        <OptionChainScanner onSelectStockAndBacktest={onSelectStockAndBacktest} />
      )}

      {/* TAB: VOLUME PROFILE & MICROSTRUCTURE VWAP */}
      {activeTab === 'volume_profile' && (
        <VolumeProfileScanner onSelectStockAndBacktest={onSelectStockAndBacktest} />
      )}

      {/* TAB: AUTOMATED GTT BRACKET & TRAILING STOP-LOSS ORDER CALCULATOR */}
      {activeTab === 'gtt_bracket' && (
        <GttBracketCalculator onSelectStockAndBacktest={onSelectStockAndBacktest} />
      )}

      {/* TAB: CASH VS FUTURES BASIS & CALENDAR SPREAD SCANNER */}
      {activeTab === 'basis_spreads' && (
        <BasisSpreadScanner onSelectStockAndBacktest={onSelectStockAndBacktest} />
      )}

      {/* TAB 4: MARKET BREADTH & SECTOR HEATMAP */}
      {activeTab === 'breadth_sectors' && (
        <div className="space-y-4">
          {/* Breadth Overview */}
          {movers && (
            <div className="bg-[#161619] border border-[rgba(236,236,237,0.08)] rounded-2xl p-4 sm:p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white">NSE Market Breadth (Advances vs Declines)</h3>
                <span className="text-xs font-mono font-bold text-neutral-300">
                  ADR: <span className="text-cyan-400">{movers.marketBreadth.advanceDeclineRatio}</span> ({movers.marketBreadth.bullishPercent}% Bullish)
                </span>
              </div>

              {/* Progress Bar */}
              <div className="w-full h-4 bg-[#141417] rounded-full overflow-hidden flex border border-[rgba(236,236,237,0.08)]">
                <div
                  style={{ width: `${movers.marketBreadth.bullishPercent}%` }}
                  className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 flex items-center justify-center text-[10px] font-bold text-[#0c0c0e]"
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
                className="p-4 bg-[#161619] border border-[rgba(236,236,237,0.08)] rounded-2xl space-y-3 hover:border-[rgba(236,236,237,0.12)] transition-all"
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
                    {sec.avgChangePercent >= 0 ? '+' : ''}{sec.avgChangePercent}%
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
                <span className="text-[11px] px-2 py-0.5 rounded-md bg-[#1d1d21] text-amber-300 font-mono">
                  Page {currentPageSafe} of {totalTrendPages} ({paginatedTrends.length} shown)
                </span>
              )}
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
                      : 'bg-[#141417] text-neutral-400 border border-[rgba(236,236,237,0.08)] hover:text-white'
                  }`}
                >
                  {f === 'ALL' && 'All Regimes'}
                  {f === 'BULLISH' && '🔥 Strong Bullish'}
                  {f === 'OVERSOLD' && '⚡ RSI < 40 Dip'}
                  {f === 'BREAKOUT' && '🚀 Breakout'}
                  {f === 'GOLDEN_CROSS' && '✨ Golden Cross'}
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
              className="w-full pl-9 pr-24 py-2 bg-[#161619] border border-[rgba(236,236,237,0.08)] rounded-xl text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/30"
            />
            {trendSearchQuery && (
              <button
                onClick={() => {
                  setTrendSearchQuery('');
                  setTrendPage(1);
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-neutral-400 hover:text-white bg-[#1d1d21] px-2 py-0.5 rounded-md"
              >
                Clear
              </button>
            )}
          </div>

          {isLoadingTrends ? (
            <div className="p-16 text-center border border-dashed border-[rgba(236,236,237,0.08)] rounded-2xl bg-[#161619]/30 text-neutral-400 space-y-3">
              <div className="w-8 h-8 border-2 border-amber-400 border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-xs">Fetching real-time stock prices and evaluating technical trends across 2,000+ symbols...</p>
            </div>
          ) : filteredTrends.length === 0 ? (
            <div className="p-12 text-center border border-[rgba(236,236,237,0.08)] rounded-2xl bg-[#161619]/30 text-neutral-400 space-y-2">
              <Search className="w-6 h-6 text-neutral-500 mx-auto" />
              <p className="text-sm font-semibold text-neutral-300">No matching stocks found for "{trendSearchQuery}"</p>
              <p className="text-xs text-neutral-500">Try searching for a different symbol or clear your filter</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {paginatedTrends.map(t => (
                  <div
                    key={`trend_${t.id}_${t.ticker}`}
                    className="p-4 bg-[#161619] border border-[rgba(236,236,237,0.08)] rounded-2xl hover:border-amber-500/40 transition-all space-y-3 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-extrabold text-base text-white">{t.ticker}</span>
                          <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded border ${
                            t.exchange === 'BSE' 
                              ? 'bg-sky-500/10 text-sky-400 border-sky-500/30' 
                              : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                          }`}>
                            {t.exchange || 'NSE'}
                          </span>
                          <span className="text-[10px] px-2 py-0.5 rounded bg-[#1d1d21] text-neutral-300 font-medium">
                            {t.sector}
                          </span>
                          {(t.formattedDate || t.date) && (
                            <span className="text-[10px] px-2 py-0.5 rounded bg-[#141417] border border-[rgba(236,236,237,0.08)] text-neutral-400 font-mono flex items-center gap-1">
                              <Calendar className="w-2.5 h-2.5 text-neutral-500" />
                              {t.formattedDate || t.date}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-neutral-400 mt-0.5">{t.name}</p>
                      </div>

                      <div className="text-right shrink-0">
                        <div className="font-mono font-extrabold text-base text-white">
                          ₹{t.ltp.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </div>
                        <div
                          className={`text-xs font-bold flex items-center justify-end gap-1 ${
                            t.changePercent >= 0 ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {t.changePercent >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                          <span>{t.changePercent >= 0 ? '+' : ''}{t.changePercent}%</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between p-2.5 bg-[#141417] border border-[rgba(236,236,237,0.08)] rounded-xl text-[11px]">
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

                    <div className="grid grid-cols-4 gap-2 text-center text-[10px] font-mono p-2 bg-[#141417]/40 rounded-xl border border-[rgba(236,236,237,0.08)]/60">
                      <div>
                        <span className="text-neutral-500 block text-[9px]">RSI (14)</span>
                        <span className={`font-bold ${t.rsi > 65 ? 'text-emerald-400' : t.rsi < 35 ? 'text-amber-400' : 'text-neutral-300'}`}>
                          {t.rsi}
                        </span>
                      </div>
                      <div>
                        <span className="text-neutral-500 block text-[9px]">20 EMA</span>
                        <span className="text-neutral-300 font-semibold">₹{t.ema20}</span>
                      </div>
                      <div>
                        <span className="text-neutral-500 block text-[9px]">50 SMA</span>
                        <span className="text-neutral-300 font-semibold">₹{t.sma50}</span>
                      </div>
                      <div>
                        <span className="text-neutral-500 block text-[9px]">Day High/Low</span>
                        <span className="text-neutral-400">{t.high} / {t.low}</span>
                      </div>
                    </div>

                    <button
                      onClick={() => onSelectStockAndBacktest(t.id)}
                      className="w-full py-2 rounded-xl bg-amber-500/10 hover:bg-amber-500 text-amber-400 hover:text-[#0c0c0e] font-bold text-xs border border-amber-500/30 flex items-center justify-center gap-1.5 transition-all shadow-sm group"
                    >
                      <span>⚡ Backtest Active Strategy on {t.ticker}</span>
                      <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                    </button>
                  </div>
                ))}
              </div>

              {/* Pagination Controls */}
              {totalTrendPages > 1 && (
                <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-[#161619]/80 border border-[rgba(236,236,237,0.08)] rounded-xl text-xs text-neutral-400">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setTrendPage(p => Math.max(1, p - 1))}
                      disabled={currentPageSafe <= 1}
                      className="px-3 py-1.5 rounded-lg bg-[#1d1d21] hover:bg-[#27272a] disabled:opacity-40 disabled:pointer-events-none text-white font-medium flex items-center gap-1 transition-all"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                      <span>Previous</span>
                    </button>
                    <button
                      onClick={() => setTrendPage(p => Math.min(totalTrendPages, p + 1))}
                      disabled={currentPageSafe >= totalTrendPages}
                      className="px-3 py-1.5 rounded-lg bg-[#1d1d21] hover:bg-[#27272a] disabled:opacity-40 disabled:pointer-events-none text-white font-medium flex items-center gap-1 transition-all"
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
          {scanResult && (
            <div className="flex items-center justify-between text-xs text-neutral-400 px-1">
              <span>
                Scanned <strong className="text-white">{scanResult.scanned}</strong> stocks • Found{' '}
                <strong className="text-emerald-400">{scanResult.matched}</strong> matching trigger setups
              </span>
              <span className="text-[11px] font-mono text-neutral-500">Live Feed: {scanResult.dataSource}</span>
            </div>
          )}

          {isScanning ? (
            <div className="p-16 text-center border border-dashed border-[rgba(236,236,237,0.08)] rounded-2xl bg-[#161619]/30 text-neutral-400 space-y-3">
              <div className="w-8 h-8 border-2 border-amber-400 border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-xs">Evaluating technical rules against universe...</p>
            </div>
          ) : scanResult && scanResult.matches.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {scanResult.matches.map((m, idx) => (
                <div
                  key={`scan_${m.symbolId}_${m.ticker}_${idx}`}
                  className="p-4 bg-[#161619] border border-[rgba(236,236,237,0.08)] rounded-2xl hover:border-amber-500/40 transition-all space-y-3 shadow-sm"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-extrabold text-base text-white">{m.ticker}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#1d1d21] text-neutral-400 font-medium">
                          {m.sector}
                        </span>
                      </div>
                      <p className="text-xs text-neutral-400 mt-0.5">{m.name}</p>
                    </div>

                    <div className="text-right">
                      <div className="font-mono font-bold text-base text-white">₹{m.lastClose.toFixed(2)}</div>
                      <div className={`text-xs font-semibold ${m.changePercent >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {m.changePercent >= 0 ? '+' : ''}{m.changePercent}%
                      </div>
                    </div>
                  </div>

                  <div className="p-2.5 bg-[#141417]/70 border border-[rgba(236,236,237,0.08)] rounded-xl space-y-1.5 text-[11px]">
                    <span className="text-[10px] font-bold text-emerald-400 flex items-center gap-1 uppercase tracking-wider">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Entry Rule Verified:
                    </span>
                    {m.matchedRules.map((r, idx) => (
                      <div key={idx} className="flex justify-between text-neutral-300">
                        <span className="font-mono text-neutral-400">{r.rule}</span>
                        <span className="font-mono font-semibold text-emerald-400">
                          Actual: {r.actualLeft} vs {r.actualRight}
                        </span>
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={() => onSelectStockAndBacktest(m.symbolId)}
                    className="w-full py-2.5 rounded-xl bg-amber-500/10 hover:bg-amber-500 text-amber-400 hover:text-[#0c0c0e] font-bold text-xs border border-amber-500/30 flex items-center justify-center gap-1.5 transition-all shadow-sm group"
                  >
                    <span>Load & Run Backtest on {m.ticker}</span>
                    <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-12 text-center border border-dashed border-[rgba(236,236,237,0.08)] rounded-2xl bg-[#161619]/30 text-neutral-500 text-xs space-y-2">
              <p>No stocks currently trigger the active strategy entry conditions.</p>
              <button
                onClick={() => setActiveTab('movers')}
                className="px-3 py-1.5 rounded-lg bg-[#1d1d21] text-amber-400 font-semibold text-xs border border-[rgba(236,236,237,0.12)] hover:bg-[#27272a]"
              >
                Switch to Top Gainers / Losers View
              </button>
            </div>
          )}
        </div>
      )}

      {/* Interactive Full Calendar Modal */}
      <TradingCalendarModal
        isOpen={isCalendarModalOpen}
        onClose={() => setIsCalendarModalOpen(false)}
        selectedDate={selectedDate || availableTradingDates[0]?.date || '2026-08-14'}
        onSelectDate={(date) => handleDateChange(date)}
        availableDates={availableTradingDates}
        activeUniverseLabel={currentUniverseConfig.label}
        totalAssetsCount={trends.length || 2088}
      />
    </div>
  );
};
