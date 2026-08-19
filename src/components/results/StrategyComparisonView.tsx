import React, { useState, useMemo } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  AreaChart,
  Area
} from 'recharts';
import { BacktestResponse, StrategyAST } from '../../shared/strategy/types';
import { runBacktest } from '../../server/backtest/engine';
import { repairStrategyAST } from '../../shared/strategy/schema';
import { STRATEGY_TEMPLATES } from '../../shared/strategy/templates';
import {
  Layers,
  TrendingUp,
  Award,
  ShieldCheck,
  Zap,
  Play,
  RefreshCw,
  Plus,
  Trash2,
  Check,
  ArrowUpRight,
  ChevronRight,
  Sliders,
  Sparkles,
  Info,
  Scale,
  DollarSign
} from 'lucide-react';

export interface StrategyComparisonViewProps {
  currentResult?: BacktestResponse;
  activeResult?: BacktestResponse;
  comparisonResults: BacktestResponse[];
  onApplyStrategy: (strategy: StrategyAST) => void;
  onUpdateComparisonList?: (results: BacktestResponse[]) => void;
  onSelectActiveResult?: (result: BacktestResponse) => void;
  onRunBacktest?: () => void;
}

const PALETTE = [
  '#00ffa3', // Mint (Primary)
  '#38bdf8', // Sky
  '#f59e0b', // Amber
  '#a855f7', // Purple
  '#f43f5e', // Rose
  '#06b6d4', // Cyan
  '#ec4899', // Pink
];

const fmtNum = (v?: number, decimals: number = 2): string => {
  if (v === undefined || v === null || isNaN(v)) return '0.00';
  return v.toFixed(decimals);
};

const fmtPct = (v?: number, decimals: number = 1): string => {
  if (v === undefined || v === null || isNaN(v)) return '0.0%';
  return `${v.toFixed(decimals)}%`;
};

const fmtInr = (v?: number): string => {
  if (v === undefined || v === null || isNaN(v)) return '0';
  return Math.round(v).toLocaleString('en-IN');
};

export const StrategyComparisonView: React.FC<StrategyComparisonViewProps> = ({
  currentResult,
  activeResult,
  comparisonResults = [],
  onApplyStrategy,
  onUpdateComparisonList,
  onSelectActiveResult
}) => {
  const effectiveCurrent = activeResult || currentResult;
  const [isRunningBatch, setIsRunningBatch] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [visibleSeries, setVisibleSeries] = useState<Record<string, boolean>>({});
  const [chartMetric, setChartMetric] = useState<'equity' | 'drawdown'>('equity');
  const [sortKey, setSortKey] = useState<'sharpeRatio' | 'totalReturnPercent' | 'netPnl' | 'winRate' | 'maxDrawdownPercent'>('sharpeRatio');
  const [sortAsc, setSortAsc] = useState(false);

  // Consolidate current result with comparison results (deduplicating by strategy id or backtestId)
  const allResults = useMemo(() => {
    const map = new Map<string, BacktestResponse>();
    if (effectiveCurrent && effectiveCurrent.strategy) {
      map.set(effectiveCurrent.strategy.id || 'current_active', effectiveCurrent);
    }
    const safeComparisons = Array.isArray(comparisonResults) ? comparisonResults : [];
    for (const res of safeComparisons) {
      if (!res || !res.strategy) continue;
      const key = res.strategy.id || res.backtestId || `strat_${Math.random()}`;
      if (!map.has(key)) {
        map.set(key, res);
      }
    }
    return Array.from(map.values());
  }, [effectiveCurrent, comparisonResults]);

  // Find Top Performer by Sharpe Ratio
  const topPerformer = useMemo(() => {
    if (allResults.length === 0) return null;
    return [...allResults].sort((a, b) => (b.metrics?.sharpeRatio || 0) - (a.metrics?.sharpeRatio || 0))[0];
  }, [allResults]);

  // Find Highest Return Winner
  const highestReturn = useMemo(() => {
    if (allResults.length === 0) return null;
    return [...allResults].sort((a, b) => (b.metrics?.totalReturnPercent || 0) - (a.metrics?.totalReturnPercent || 0))[0];
  }, [allResults]);

  // Find Lowest Drawdown Strategy
  const lowestDrawdown = useMemo(() => {
    if (allResults.length === 0) return null;
    return [...allResults].sort((a, b) => (a.metrics?.maxDrawdownPercent || 0) - (b.metrics?.maxDrawdownPercent || 0))[0];
  }, [allResults]);

  // Sorted Results for the Table
  const sortedResults = useMemo(() => {
    return [...allResults].sort((a, b) => {
      const valA = a.metrics?.[sortKey] ?? 0;
      const valB = b.metrics?.[sortKey] ?? 0;
      return sortAsc ? valA - valB : valB - valA;
    });
  }, [allResults, sortKey, sortAsc]);

  // Build Unified Equity Multi-Curve Series aligned by Date
  const multiEquityData = useMemo(() => {
    if (allResults.length === 0) return [];

    // Map each date to all strategies' values
    const dateMap = new Map<string, any>();

    allResults.forEach((res, index) => {
      const stratKey = `strat_${index}`;
      const ddKey = `dd_${index}`;
      const curve = res.equityCurve || [];

      curve.forEach(pt => {
        if (!pt || !pt.date) return;
        if (!dateMap.has(pt.date)) {
          dateMap.set(pt.date, {
            date: pt.date,
            timestamp: pt.timestamp || 0,
            benchmark: pt.benchmarkEquity || 100000
          });
        }
        const row = dateMap.get(pt.date);
        row[stratKey] = pt.equity ?? 100000;
        row[ddKey] = Math.abs(pt.drawdownPercent || 0);
      });
    });

    return Array.from(dateMap.values()).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  }, [allResults]);

  // Handle Preset Sweeps
  const handleRunPresetSweep = async (presetType: 'stoploss' | 'indicators' | 'trailing' | 'templates') => {
    if (!currentResult || !currentResult.strategy) return;
    setIsRunningBatch(true);
    setSelectedPreset(presetType);

    const baseStrat = currentResult.strategy;
    const baseSymbolId = currentResult.symbol?.id || 1;
    const variations: StrategyAST[] = [];

    if (presetType === 'stoploss') {
      const slValues = [1.5, 2.5, 3.5, 5.0];
      for (const sl of slValues) {
        variations.push(
          repairStrategyAST({
            ...baseStrat,
            id: `sweep_sl_${sl}`,
            name: `${baseStrat.name || 'Strategy'} (SL ${sl}%)`,
            risk: {
              ...baseStrat.risk,
              stopLoss: { type: 'percent', value: sl },
              takeProfit: { type: 'percent', value: 12.0 },
              trailingStop: { type: 'percent', value: 2.0 }
            }
          })
        );
      }
    } else if (presetType === 'trailing') {
      const trailConfigs = [
        { name: 'No Trailing (Fixed 12% TP)', trail: null, tp: 12.0 },
        { name: 'Tight Dynamic Trail (1.5%)', trail: { type: 'percent' as const, value: 1.5 }, tp: 15.0 },
        { name: 'Moderate Dynamic Trail (2.5%)', trail: { type: 'percent' as const, value: 2.5 }, tp: 18.0 },
        { name: 'Wide Trend Surfer (3.5%)', trail: { type: 'percent' as const, value: 3.5 }, tp: 22.0 }
      ];
      for (const tc of trailConfigs) {
        variations.push(
          repairStrategyAST({
            ...baseStrat,
            id: `sweep_trail_${tc.trail?.value || 0}`,
            name: `${baseStrat.name || 'Strategy'} - ${tc.name}`,
            risk: {
              ...baseStrat.risk,
              takeProfit: { type: 'percent', value: tc.tp },
              trailingStop: tc.trail
            }
          })
        );
      }
    } else if (presetType === 'indicators') {
      // 1. Supertrend (10, 3)
      variations.push(
        repairStrategyAST({
          ...baseStrat,
          id: 'comp_supertrend',
          name: 'Supertrend (10, 3) Trend Breakout',
          indicators: [
            { id: 'st1', type: 'SUPERTREND', params: { period: 10, multiplier: 3 } },
            { id: 'vol20', type: 'VOLUME_SMA', params: { period: 20 } }
          ],
          rules: {
            entry: [
              { id: 'e1', leftIndicator: 'close', operator: 'gt', rightIndicator: 'st1' },
              { id: 'e2', leftIndicator: 'volume', operator: 'gt', rightIndicator: 'vol20' }
            ],
            exit: [{ id: 'x1', leftIndicator: 'close', operator: 'lt', rightIndicator: 'st1' }]
          }
        })
      );

      // 2. Golden Cross (50/200 SMA)
      variations.push(
        repairStrategyAST({
          ...baseStrat,
          id: 'comp_golden_cross',
          name: 'Golden Cross (50/200 SMA) + Vol',
          indicators: [
            { id: 'sma50', type: 'SMA', params: { period: 50 } },
            { id: 'sma200', type: 'SMA', params: { period: 200 } },
            { id: 'vol20', type: 'VOLUME_SMA', params: { period: 20 } }
          ],
          rules: {
            entry: [
              { id: 'e1', leftIndicator: 'sma50', operator: 'gt', rightIndicator: 'sma200' },
              { id: 'e2', leftIndicator: 'close', operator: 'gt', rightIndicator: 'sma200' },
              { id: 'e3', leftIndicator: 'volume', operator: 'gt', rightIndicator: 'vol20' }
            ],
            exit: [{ id: 'x1', leftIndicator: 'sma50', operator: 'lt', rightIndicator: 'sma200' }]
          }
        })
      );

      // 3. RSI 200 EMA Mean Reversion
      variations.push(
        repairStrategyAST({
          ...baseStrat,
          id: 'comp_rsi_pullback',
          name: 'RSI Oversold in 200 EMA Uptrend',
          indicators: [
            { id: 'rsi14', type: 'RSI', params: { period: 14 } },
            { id: 'ema200', type: 'EMA', params: { period: 200 } }
          ],
          rules: {
            entry: [
              { id: 'e1', leftIndicator: 'close', operator: 'gt', rightIndicator: 'ema200' },
              { id: 'e2', leftIndicator: 'rsi14', operator: 'lt', rightValue: 40 }
            ],
            exit: [{ id: 'x1', leftIndicator: 'rsi14', operator: 'gt', rightValue: 70 }]
          }
        })
      );
    } else if (presetType === 'templates') {
      for (const t of STRATEGY_TEMPLATES.slice(0, 4)) {
        variations.push(
          repairStrategyAST({
            ...t.strategy,
            id: `comp_template_${t.id}`,
            name: t.name,
            universe: { symbolId: baseSymbolId, timeframe: '1D' }
          })
        );
      }
    }

    // Execute backtests for all variations in parallel
    const newResults: BacktestResponse[] = [currentResult];
    for (const v of variations) {
      try {
        const sim = runBacktest(v);
        newResults.push(sim);
      } catch (err) {
        console.warn('Variation backtest error:', err);
      }
    }

    onUpdateComparisonList(newResults);
    setIsRunningBatch(false);
  };

  // Re-run all currently active variations
  const handleReRunAll = async () => {
    setIsRunningBatch(true);
    const updated: BacktestResponse[] = [];
    for (const r of allResults) {
      if (!r || !r.strategy) continue;
      try {
        const fresh = runBacktest(r.strategy);
        updated.push(fresh);
      } catch (e) {
        updated.push(r);
      }
    }
    onUpdateComparisonList(updated);
    setIsRunningBatch(false);
  };

  // Remove a variation from the comparison list
  const handleRemove = (idToRemove: string) => {
    const safeComparisons = Array.isArray(comparisonResults) ? comparisonResults : [];
    const filtered = safeComparisons.filter(
      r => r?.strategy && (r.strategy.id || r.backtestId) !== idToRemove
    );
    onUpdateComparisonList(filtered);
  };

  const handleToggleSeries = (idx: number) => {
    setVisibleSeries(prev => ({
      ...prev,
      [idx]: prev[idx] !== undefined ? !prev[idx] : false
    }));
  };

  if (!currentResult) {
    return (
      <div className="p-8 bg-[#161619]/90 border border-[#1d1d21] rounded-2xl text-center text-neutral-400 text-xs">
        No active simulation loaded for comparison.
      </div>
    );
  }

  const symbolName = currentResult.symbol?.name || 'Asset';
  const symbolTicker = currentResult.symbol?.ticker || 'NSE';

  return (
    <div className="space-y-5">
      {/* Top Banner & Quick Sweep Toolbar */}
      <div className="p-4 sm:p-5 bg-[#161619]/90 border border-[#1d1d21] rounded-2xl shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="p-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
                <Layers className="w-4 h-4" />
              </div>
              <h3 className="text-base sm:text-lg font-extrabold text-white tracking-tight">
                Multi-Strategy Comparison Matrix
              </h3>
              <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded-full bg-[#1d1d21] border border-[rgba(236,236,237,0.12)] text-neutral-300">
                {allResults.length} Variations Loaded
              </span>
            </div>
            <p className="text-xs text-neutral-400">
              Run and compare institutional quantitative strategy variations side-by-side on {symbolName} ({symbolTicker}) with unified equity overlays and tax breakdowns.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <button
              type="button"
              onClick={handleReRunAll}
              disabled={isRunningBatch}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1d1d21] hover:bg-[rgba(236,236,237,0.12)] text-white font-semibold text-xs rounded-xl border border-[rgba(236,236,237,0.12)] shadow-sm active:scale-95 transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRunningBatch ? 'animate-spin text-cyan-400' : ''}`} />
              <span>{isRunningBatch ? 'Simulating All...' : 'Re-Run All Variations'}</span>
            </button>
          </div>
        </div>

        {/* Quick Multi-Sweep Action Presets */}
        <div className="pt-2 border-t border-[#1d1d21]/80 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-neutral-400 flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            <span>Instant Parallel Sweeps:</span>
          </span>

          <button
            type="button"
            onClick={() => handleRunPresetSweep('stoploss')}
            disabled={isRunningBatch}
            className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-all ${
              selectedPreset === 'stoploss'
                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                : 'bg-[#0c0c0e]/80 hover:bg-[#1d1d21] text-neutral-300 border-[#1d1d21]'
            }`}
          >
            🛡️ Stop-Loss Sweep (1.5% - 5%)
          </button>

          <button
            type="button"
            onClick={() => handleRunPresetSweep('trailing')}
            disabled={isRunningBatch}
            className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-all ${
              selectedPreset === 'trailing'
                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                : 'bg-[#0c0c0e]/80 hover:bg-[#1d1d21] text-neutral-300 border-[#1d1d21]'
            }`}
          >
            📈 Trailing Stop Matrix (0% - 3.5%)
          </button>

          <button
            type="button"
            onClick={() => handleRunPresetSweep('indicators')}
            disabled={isRunningBatch}
            className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-all ${
              selectedPreset === 'indicators'
                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                : 'bg-[#0c0c0e]/80 hover:bg-[#1d1d21] text-neutral-300 border-[#1d1d21]'
            }`}
          >
            ⚡ Supertrend vs Golden Cross vs RSI
          </button>

          <button
            type="button"
            onClick={() => handleRunPresetSweep('templates')}
            disabled={isRunningBatch}
            className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-all ${
              selectedPreset === 'templates'
                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                : 'bg-[#0c0c0e]/80 hover:bg-[#1d1d21] text-neutral-300 border-[#1d1d21]'
            }`}
          >
            🏛️ Institutional Archetypes
          </button>
        </div>
      </div>

      {/* Podium / Highlight Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
        {/* Card 1: Top Sharpe Ratio Winner */}
        {topPerformer && (
          <div className="p-4 bg-gradient-to-br from-emerald-950/40 via-[#161619] to-[#161619] border border-emerald-500/30 rounded-2xl shadow-sm relative overflow-hidden">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                <Award className="w-3.5 h-3.5 text-emerald-400" />
                <span>Best Risk-Adjusted Return</span>
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold">
                Sharpe: {fmtNum(topPerformer.metrics?.sharpeRatio)}
              </span>
            </div>
            <h4 className="font-bold text-sm text-white mt-2 truncate">
              {topPerformer.strategy?.name || 'Top Strategy'}
            </h4>
            <div className="mt-2.5 flex items-center justify-between text-xs pt-2 border-t border-[#1d1d21]">
              <span className="text-neutral-400">Net Return:</span>
              <span className="font-bold font-mono text-emerald-400">
                +{(topPerformer.metrics?.totalReturnPercent ?? 0) >= 0 ? '+' : ''}{fmtPct(topPerformer.metrics?.totalReturnPercent)} (₹{fmtInr(topPerformer.metrics?.netPnl)})
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between text-xs">
              <span className="text-neutral-400">Profit Factor / Win Rate:</span>
              <span className="font-mono text-neutral-200">
                {fmtNum(topPerformer.metrics?.profitFactor)} • {fmtPct(topPerformer.metrics?.winRate)}
              </span>
            </div>
            <button
              type="button"
              onClick={() => topPerformer.strategy && onApplyStrategy(topPerformer.strategy)}
              className="w-full mt-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-[#0c0c0e] font-bold text-xs rounded-xl shadow-md transition-all flex items-center justify-center gap-1 active:scale-95"
            >
              <span>Apply Winner to Workspace</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Card 2: Highest Return */}
        {highestReturn && (
          <div className="p-4 bg-gradient-to-br from-cyan-950/40 via-[#161619] to-[#161619] border border-cyan-500/30 rounded-2xl shadow-sm relative overflow-hidden">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-cyan-400 flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-cyan-400" />
                <span>Highest Absolute Net P&L</span>
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-bold">
                +{fmtPct(highestReturn.metrics?.totalReturnPercent)}
              </span>
            </div>
            <h4 className="font-bold text-sm text-white mt-2 truncate">
              {highestReturn.strategy?.name || 'High Return Strategy'}
            </h4>
            <div className="mt-2.5 flex items-center justify-between text-xs pt-2 border-t border-[#1d1d21]">
              <span className="text-neutral-400">Total Net P&L:</span>
              <span className="font-bold font-mono text-cyan-400">
                ₹{fmtInr(highestReturn.metrics?.netPnl)}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between text-xs">
              <span className="text-neutral-400">CAGR / Trades:</span>
              <span className="font-mono text-neutral-200">
                {fmtPct(highestReturn.metrics?.cagr)} • {highestReturn.metrics?.totalTrades ?? 0} Trades
              </span>
            </div>
            <button
              type="button"
              onClick={() => highestReturn.strategy && onApplyStrategy(highestReturn.strategy)}
              className="w-full mt-3 py-1.5 bg-[#1d1d21] hover:bg-[rgba(236,236,237,0.12)] text-cyan-400 font-bold text-xs rounded-xl border border-[rgba(236,236,237,0.12)] transition-all flex items-center justify-center gap-1 active:scale-95"
            >
              <span>Load Setup</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Card 3: Safest / Lowest Drawdown */}
        {lowestDrawdown && (
          <div className="p-4 bg-gradient-to-br from-amber-950/30 via-[#161619] to-[#161619] border border-amber-500/30 rounded-2xl shadow-sm relative overflow-hidden">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
                <span>Lowest Max Drawdown</span>
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold">
                Max DD: -{fmtPct(lowestDrawdown.metrics?.maxDrawdownPercent)}
              </span>
            </div>
            <h4 className="font-bold text-sm text-white mt-2 truncate">
              {lowestDrawdown.strategy?.name || 'Safe Strategy'}
            </h4>
            <div className="mt-2.5 flex items-center justify-between text-xs pt-2 border-t border-[#1d1d21]">
              <span className="text-neutral-400">Calmar Ratio:</span>
              <span className="font-bold font-mono text-amber-400">
                {fmtNum(lowestDrawdown.metrics?.calmarRatio)}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between text-xs">
              <span className="text-neutral-400">Stop Loss / Trailing:</span>
              <span className="font-mono text-neutral-200">
                SL {lowestDrawdown.strategy?.risk?.stopLoss?.value ?? 2}% • Trail {lowestDrawdown.strategy?.risk?.trailingStop?.value || 0}%
              </span>
            </div>
            <button
              type="button"
              onClick={() => lowestDrawdown.strategy && onApplyStrategy(lowestDrawdown.strategy)}
              className="w-full mt-3 py-1.5 bg-[#1d1d21] hover:bg-[rgba(236,236,237,0.12)] text-amber-400 font-bold text-xs rounded-xl border border-[rgba(236,236,237,0.12)] transition-all flex items-center justify-center gap-1 active:scale-95"
            >
              <span>Load Setup</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Multi-Equity Curve Overlay Chart */}
      <div className="p-4 sm:p-5 bg-[#161619]/90 border border-[#1d1d21] rounded-2xl shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#1d1d21]/80 pb-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-sm sm:text-base text-white">
                Multi-Strategy Comparative Overlay
              </h3>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-[#1d1d21] text-neutral-300">
                {multiEquityData.length} Trading Bars
              </span>
            </div>
            <p className="text-[11px] text-neutral-400 mt-0.5">
              Side-by-side growth trajectory of ₹1,00,000 initial capital across all variations.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-[#0c0c0e] p-1 rounded-xl border border-[#1d1d21] text-xs font-semibold text-neutral-400">
              <button
                type="button"
                onClick={() => setChartMetric('equity')}
                className={`px-2.5 py-1 rounded-lg transition-all ${
                  chartMetric === 'equity' ? 'bg-cyan-500 text-[#0c0c0e] font-bold' : 'hover:text-neutral-200'
                }`}
              >
                Portfolio Equity
              </button>
              <button
                type="button"
                onClick={() => setChartMetric('drawdown')}
                className={`px-2.5 py-1 rounded-lg transition-all ${
                  chartMetric === 'drawdown' ? 'bg-cyan-500 text-[#0c0c0e] font-bold' : 'hover:text-neutral-200'
                }`}
              >
                Drawdown %
              </button>
            </div>
          </div>
        </div>

        {/* Legend / Series Toggles */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {allResults.map((res, idx) => {
            const color = PALETTE[idx % PALETTE.length];
            const isVis = visibleSeries[idx] !== false;
            const isWinner = topPerformer && (topPerformer.strategy?.id === res.strategy?.id);

            return (
              <button
                key={res.strategy?.id || idx}
                type="button"
                onClick={() => handleToggleSeries(idx)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${
                  isVis ? 'bg-[#0c0c0e] border-[rgba(236,236,237,0.12)] text-neutral-200' : 'bg-[#0c0c0e]/40 border-[#1d1d21]/40 text-neutral-500 line-through'
                }`}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: color, opacity: isVis ? 1 : 0.3 }}
                />
                <span className="truncate max-w-[140px]">{res.strategy?.name || `Strategy ${idx + 1}`}</span>
                {isWinner && (
                  <span className="text-[9px] px-1 rounded bg-emerald-500/20 text-emerald-400 font-bold uppercase">
                    Winner
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Chart Canvas */}
        <div className="h-72 sm:h-80 lg:h-96 w-full">
          <ResponsiveContainer width="100%" height="100%">
            {chartMetric === 'equity' ? (
              <LineChart data={multiEquityData} margin={{ top: 10, right: 15, left: -15, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" opacity={0.6} />
                <XAxis
                  dataKey="date"
                  stroke="#64748b"
                  fontSize={10}
                  tickFormatter={val => (typeof val === 'string' && val.length > 5 ? val.slice(5) : val || '')}
                  minTickGap={30}
                />
                <YAxis
                  stroke="#64748b"
                  fontSize={10}
                  tickFormatter={val => `₹${((val || 0) / 1000).toFixed(0)}k`}
                  domain={['auto', 'auto']}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderColor: '#334155',
                    borderRadius: '0.75rem',
                    fontSize: '0.75rem',
                    color: '#f8fafc',
                    boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)'
                  }}
                  formatter={(val: any, name: string) => {
                    const idxMatch = (name || '').match(/strat_(\d+)/);
                    if (idxMatch) {
                      const idx = parseInt(idxMatch[1], 10);
                      const sName = allResults[idx]?.strategy?.name || `Strategy ${idx + 1}`;
                      return [`₹${Number(val || 0).toLocaleString('en-IN')}`, sName];
                    }
                    if (name === 'benchmark') {
                      return [`₹${Number(val || 0).toLocaleString('en-IN')}`, 'NIFTY 50 Benchmark'];
                    }
                    return [val, name];
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="benchmark"
                  stroke="#475569"
                  strokeDasharray="4 4"
                  strokeWidth={1.5}
                  dot={false}
                  name="benchmark"
                />
                {allResults.map((res, idx) => {
                  const isVis = visibleSeries[idx] !== false;
                  if (!isVis) return null;
                  const color = PALETTE[idx % PALETTE.length];
                  return (
                    <Line
                      key={res.strategy?.id || idx}
                      type="monotone"
                      dataKey={`strat_${idx}`}
                      stroke={color}
                      strokeWidth={idx === 0 || res === topPerformer ? 2.5 : 1.8}
                      dot={false}
                      name={`strat_${idx}`}
                    />
                  );
                })}
              </LineChart>
            ) : (
              <AreaChart data={multiEquityData} margin={{ top: 10, right: 15, left: -15, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" opacity={0.6} />
                <XAxis
                  dataKey="date"
                  stroke="#64748b"
                  fontSize={10}
                  tickFormatter={val => (typeof val === 'string' && val.length > 5 ? val.slice(5) : val || '')}
                  minTickGap={30}
                />
                <YAxis
                  stroke="#64748b"
                  fontSize={10}
                  tickFormatter={val => `-${val}%`}
                  domain={[0, 'auto']}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderColor: '#334155',
                    borderRadius: '0.75rem',
                    fontSize: '0.75rem',
                    color: '#f8fafc'
                  }}
                  formatter={(val: any, name: string) => {
                    const idxMatch = (name || '').match(/dd_(\d+)/);
                    if (idxMatch) {
                      const idx = parseInt(idxMatch[1], 10);
                      const sName = allResults[idx]?.strategy?.name || `Strategy ${idx + 1}`;
                      return [`-${Number(val || 0).toFixed(2)}%`, sName];
                    }
                    return [val, name];
                  }}
                />
                {allResults.map((res, idx) => {
                  const isVis = visibleSeries[idx] !== false;
                  if (!isVis) return null;
                  const color = PALETTE[idx % PALETTE.length];
                  return (
                    <Area
                      key={res.strategy?.id || idx}
                      type="monotone"
                      dataKey={`dd_${idx}`}
                      stroke={color}
                      fill={color}
                      fillOpacity={0.08}
                      strokeWidth={1.8}
                      name={`dd_${idx}`}
                    />
                  );
                })}
              </AreaChart>
            )}
          </ResponsiveContainer>
        </div>
      </div>

      {/* Comprehensive Multi-Strategy Comparison Table */}
      <div className="bg-[#161619]/90 border border-[#1d1d21] rounded-2xl shadow-sm overflow-hidden space-y-0">
        <div className="p-4 border-b border-[#1d1d21] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h4 className="font-bold text-sm text-white">Full Quantitative Performance Matrix</h4>
            <span className="text-[11px] text-neutral-400">
              Click any column header to sort
            </span>
          </div>

          <div className="flex items-center gap-1 text-xs text-neutral-400">
            <Info className="w-3.5 h-3.5 text-cyan-400" />
            <span>Factoring Zerodha flat ₹20 brokerage, 0.1% STT, exchange charges, and 18% GST</span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#0c0c0e] text-neutral-400 font-semibold border-b border-[#1d1d21] text-[11px] uppercase tracking-wider select-none">
              <tr>
                <th className="py-3 px-4 min-w-[200px]">Strategy Variation</th>
                <th className="py-3 px-3 min-w-[130px]">Risk Settings</th>
                <th
                  className="py-3 px-3 cursor-pointer hover:text-white transition-colors"
                  onClick={() => {
                    if (sortKey === 'totalReturnPercent') setSortAsc(!sortAsc);
                    else { setSortKey('totalReturnPercent'); setSortAsc(false); }
                  }}
                >
                  <div className="flex items-center gap-1">
                    <span>Net Return / P&L</span>
                    {sortKey === 'totalReturnPercent' && <span>{sortAsc ? '▲' : '▼'}</span>}
                  </div>
                </th>
                <th
                  className="py-3 px-3 cursor-pointer hover:text-white transition-colors"
                  onClick={() => {
                    if (sortKey === 'sharpeRatio') setSortAsc(!sortAsc);
                    else { setSortKey('sharpeRatio'); setSortAsc(false); }
                  }}
                >
                  <div className="flex items-center gap-1">
                    <span>Sharpe</span>
                    {sortKey === 'sharpeRatio' && <span>{sortAsc ? '▲' : '▼'}</span>}
                  </div>
                </th>
                <th
                  className="py-3 px-3 cursor-pointer hover:text-white transition-colors"
                  onClick={() => {
                    if (sortKey === 'winRate') setSortAsc(!sortAsc);
                    else { setSortKey('winRate'); setSortAsc(false); }
                  }}
                >
                  <div className="flex items-center gap-1">
                    <span>Win Rate</span>
                    {sortKey === 'winRate' && <span>{sortAsc ? '▲' : '▼'}</span>}
                  </div>
                </th>
                <th className="py-3 px-3">Profit Factor</th>
                <th
                  className="py-3 px-3 cursor-pointer hover:text-white transition-colors"
                  onClick={() => {
                    if (sortKey === 'maxDrawdownPercent') setSortAsc(!sortAsc);
                    else { setSortKey('maxDrawdownPercent'); setSortAsc(false); }
                  }}
                >
                  <div className="flex items-center gap-1">
                    <span>Max DD %</span>
                    {sortKey === 'maxDrawdownPercent' && <span>{sortAsc ? '▲' : '▼'}</span>}
                  </div>
                </th>
                <th className="py-3 px-3">Trades (W/L)</th>
                <th className="py-3 px-3">Indian Taxes</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1d1d21]/60 font-mono text-xs">
              {sortedResults.map((res, index) => {
                if (!res || !res.strategy) return null;
                const isWinner = topPerformer && (topPerformer.strategy?.id === res.strategy?.id);
                const isCurrentActive = currentResult && (currentResult.strategy?.id === res.strategy?.id);
                const origIndex = allResults.findIndex(r => r === res);
                const color = PALETTE[origIndex >= 0 ? origIndex % PALETTE.length : 0];
                const netPnl = res.metrics?.netPnl ?? 0;
                const indicatorsList = Array.isArray(res.strategy?.indicators)
                  ? res.strategy.indicators.map(i => i.id).join(' • ')
                  : 'Price Rules';

                return (
                  <tr
                    key={res.strategy?.id || res.backtestId || index}
                    className={`hover:bg-[#1d1d21]/40 transition-colors ${
                      isWinner ? 'bg-emerald-950/20' : isCurrentActive ? 'bg-cyan-950/20' : ''
                    }`}
                  >
                    {/* Strategy Name & Pills */}
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-sans font-bold text-white text-xs truncate max-w-[200px]">
                              {res.strategy.name || `Strategy ${index + 1}`}
                            </span>
                            {isWinner && (
                              <span className="text-[10px] font-sans px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-400 font-bold border border-emerald-500/30">
                                👑 Winner
                              </span>
                            )}
                            {isCurrentActive && !isWinner && (
                              <span className="text-[10px] font-sans px-1.5 py-0.2 rounded bg-cyan-500/20 text-cyan-400 font-bold border border-cyan-500/30">
                                Active AST
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] font-sans text-neutral-400 mt-0.5">
                            {indicatorsList || 'Price Rules'}
                          </p>
                        </div>
                      </div>
                    </td>

                    {/* Risk Controls */}
                    <td className="py-3.5 px-3 font-sans text-[11px] text-neutral-300">
                      <div className="space-y-0.5">
                        <span className="inline-block px-1.5 py-0.5 rounded bg-[#1d1d21] text-neutral-200">
                          SL: {res.strategy.risk?.stopLoss?.value ?? 2}%
                        </span>
                        <span className="inline-block ml-1 px-1.5 py-0.5 rounded bg-[#1d1d21] text-neutral-200">
                          TP: {res.strategy.risk?.takeProfit?.value || 14}%
                        </span>
                        {res.strategy.risk?.trailingStop && (
                          <div className="text-[10px] text-cyan-400 font-mono">
                            Trail: {res.strategy.risk.trailingStop.value}%
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Net Return & P&L */}
                    <td className="py-3.5 px-3">
                      <div className={`font-bold ${netPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {netPnl >= 0 ? '+' : ''}{fmtPct(res.metrics?.totalReturnPercent)}
                      </div>
                      <div className="text-[11px] text-neutral-400">
                        ₹{fmtInr(netPnl)}
                      </div>
                    </td>

                    {/* Sharpe Ratio */}
                    <td className="py-3.5 px-3">
                      <span className={`font-bold px-1.5 py-0.5 rounded text-xs ${
                        (res.metrics?.sharpeRatio ?? 0) >= 1.5
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : (res.metrics?.sharpeRatio ?? 0) >= 1.0
                          ? 'bg-cyan-500/20 text-cyan-400'
                          : 'text-neutral-300'
                      }`}>
                        {fmtNum(res.metrics?.sharpeRatio)}
                      </span>
                    </td>

                    {/* Win Rate */}
                    <td className="py-3.5 px-3 text-neutral-200">
                      <div className="font-bold">{fmtPct(res.metrics?.winRate)}</div>
                      <div className="text-[10px] text-neutral-400">
                        {res.metrics?.winningTrades ?? 0}W / {res.metrics?.losingTrades ?? 0}L
                      </div>
                    </td>

                    {/* Profit Factor */}
                    <td className="py-3.5 px-3 font-bold text-neutral-200">
                      {fmtNum(res.metrics?.profitFactor)}
                    </td>

                    {/* Max Drawdown */}
                    <td className="py-3.5 px-3 text-rose-400">
                      <div className="font-bold">-{fmtPct(res.metrics?.maxDrawdownPercent)}</div>
                      <div className="text-[10px] text-neutral-400">
                        ₹{fmtInr(res.metrics?.maxDrawdownAmount)}
                      </div>
                    </td>

                    {/* Trades */}
                    <td className="py-3.5 px-3 text-neutral-300">
                      <div>{res.metrics?.totalTrades ?? 0}</div>
                      <div className="text-[10px] text-neutral-400">
                        ~{fmtNum(res.metrics?.avgHoldingBars, 0)} bars hold
                      </div>
                    </td>

                    {/* Indian Taxes */}
                    <td className="py-3.5 px-3 text-neutral-400">
                      <div>₹{fmtInr(res.costs?.totalCharges)}</div>
                      <div className="text-[10px] text-neutral-500">
                        STT: ₹{fmtInr(res.costs?.stt)}
                      </div>
                    </td>

                    {/* Action */}
                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => onApplyStrategy(res.strategy)}
                          className="px-2.5 py-1 bg-cyan-500 hover:bg-cyan-400 text-[#0c0c0e] font-bold text-xs rounded-lg shadow-sm active:scale-95 transition-all flex items-center gap-1 font-sans"
                          title="Apply this strategy AST directly to your Strategy Builder and active simulation"
                        >
                          <Check className="w-3 h-3" />
                          <span>Apply</span>
                        </button>
                        {onSelectActiveResult && (
                          <button
                            type="button"
                            onClick={() => onSelectActiveResult(res)}
                            className="p-1 text-neutral-400 hover:text-white rounded-lg hover:bg-[#1d1d21] transition-colors font-sans"
                            title="Inspect full trade logs and price charts for this variation"
                          >
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        )}
                        {allResults.length > 1 && !isCurrentActive && (
                          <button
                            type="button"
                            onClick={() => handleRemove(res.strategy?.id || res.backtestId || '')}
                            className="p-1 text-neutral-500 hover:text-rose-400 rounded-lg hover:bg-[#1d1d21] transition-colors"
                            title="Remove variation from matrix"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
