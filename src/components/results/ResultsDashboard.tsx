import React, { useState } from 'react';
import { BacktestResponse, StrategyAST } from '../../shared/strategy/types';
import { MetricsGrid } from './MetricsGrid';
import { PriceChart } from './PriceChart';
import { EquityCharts } from './EquityCharts';
import { RobustnessView } from './RobustnessView';
import { IndianCostWaterfall } from './IndianCostWaterfall';
import { TradeLogTable } from './TradeLogTable';
import { StrategyComparisonView } from './StrategyComparisonView';
import { Activity, ShieldCheck, Receipt, List, RefreshCw, Scale } from 'lucide-react';

interface ResultsDashboardProps {
  result: BacktestResponse | null;
  comparisonResults?: BacktestResponse[];
  onReRun: () => void;
  onApplyStrategy?: (strategy: StrategyAST) => void;
  onUpdateComparisonList?: (results: BacktestResponse[]) => void;
  onSelectActiveResult?: (result: BacktestResponse) => void;
  isLoading: boolean;
  initialTab?: 'overview' | 'compare' | 'robustness' | 'costs' | 'trades';
}

export const ResultsDashboard: React.FC<ResultsDashboardProps> = ({
  result,
  comparisonResults = [],
  onReRun,
  onApplyStrategy,
  onUpdateComparisonList,
  onSelectActiveResult,
  isLoading,
  initialTab = 'overview'
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'compare' | 'robustness' | 'costs' | 'trades'>(initialTab);

  if (!result) {
    return (
      <div className="p-8 sm:p-12 text-center max-w-lg mx-auto space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-[#00ffa3]/10 border border-[#00ffa3]/30 flex items-center justify-center mx-auto text-[#00ffa3]">
          <Activity className="w-6 h-6 animate-pulse" />
        </div>
        <h3 className="text-base font-bold text-[#ececed]">No Simulation Results Yet</h3>
        <p className="text-xs text-[rgba(236,236,237,0.6)]">
          Configure your strategy rules and parameters in the Strategy Builder, then click &quot;RUN BACKTEST&quot; to execute simulation across historical NSE bars.
        </p>
        <button
          onClick={onReRun}
          disabled={isLoading}
          className="btn-primary-mint"
        >
          Run Backtest Now
        </button>
      </div>
    );
  }

  const comparisonCount = Math.max(
    comparisonResults.length,
    comparisonResults.some(r => r.strategy.id === result.strategy.id) ? comparisonResults.length : comparisonResults.length + 1
  );

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-8 space-y-6 pb-24">
      {/* Top Title & Strategy Sub-Header matching Stragy Theme */}
      <div className="bg-[#161619] border border-[rgba(236,236,237,0.08)] rounded-2xl p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h2 className="font-syne font-extrabold text-xl sm:text-2xl text-[#ececed] tracking-[-0.03em]">
              {result.strategy.name}
            </h2>
            <span className="font-mono text-[11px] font-bold px-2 py-0.5 rounded bg-[rgba(0,255,163,0.1)] text-[#00ffa3] border border-[rgba(0,255,163,0.25)]">
              {result.symbol.ticker} • {result.strategy.universe.timeframe}
            </span>
          </div>
          <p className="text-xs text-[rgba(236,236,237,0.5)]">
            Simulation executed on {result.bars.length} daily bars • Completed at {new Date(result.executedAt).toLocaleTimeString()}
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            onClick={() => setActiveTab('compare')}
            className="px-3.5 py-2 rounded-lg bg-[#1d1d21] hover:bg-[#141417] text-[#ececed] font-semibold text-xs border border-[rgba(236,236,237,0.08)] hover:border-[#00ffa3] transition-all flex items-center gap-1.5"
          >
            <Scale className="w-3.5 h-3.5 text-[#00ffa3]" />
            <span>Compare Variations ({comparisonCount})</span>
          </button>
          <button
            onClick={onReRun}
            disabled={isLoading}
            className="btn-primary-mint !py-2 !px-3.5 text-xs flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Re-Simulate</span>
          </button>
        </div>
      </div>

      {/* KPI Metrics Matrix in clean #161619 theme */}
      <MetricsGrid metrics={result.metrics} />

      {/* Analytics Tabs in clean #1d1d21 bar */}
      <div className="flex flex-wrap items-center gap-1 bg-[#1d1d21] p-1 rounded-xl border border-[rgba(236,236,237,0.08)] text-xs font-semibold">
        <button
          type="button"
          onClick={() => setActiveTab('overview')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg transition-all ${
            activeTab === 'overview'
              ? 'bg-[#0c0c0e] text-[#ececed] shadow-md shadow-black/40 font-bold'
              : 'text-[rgba(236,236,237,0.5)] hover:text-[#ececed]'
          }`}
        >
          <Activity className="w-3.5 h-3.5 text-[#00ffa3]" />
          <span>Overview & Charts</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('compare')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg transition-all ${
            activeTab === 'compare'
              ? 'bg-[#0c0c0e] text-[#ececed] shadow-md shadow-black/40 font-bold'
              : 'text-[rgba(236,236,237,0.5)] hover:text-[#ececed]'
          }`}
        >
          <Scale className="w-3.5 h-3.5 text-[#00ffa3]" />
          <span>Multi-Strategy Matrix ({comparisonCount})</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('robustness')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg transition-all ${
            activeTab === 'robustness'
              ? 'bg-[#0c0c0e] text-[#ececed] shadow-md shadow-black/40 font-bold'
              : 'text-[rgba(236,236,237,0.5)] hover:text-[#ececed]'
          }`}
        >
          <ShieldCheck className="w-3.5 h-3.5 text-[#00ffa3]" />
          <span>Robustness & Monte Carlo</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('costs')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg transition-all ${
            activeTab === 'costs'
              ? 'bg-[#0c0c0e] text-[#ececed] shadow-md shadow-black/40 font-bold'
              : 'text-[rgba(236,236,237,0.5)] hover:text-[#ececed]'
          }`}
        >
          <Receipt className="w-3.5 h-3.5 text-[#00ffa3]" />
          <span>NSE Cost Waterfall</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('trades')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg transition-all ${
            activeTab === 'trades'
              ? 'bg-[#0c0c0e] text-[#ececed] shadow-md shadow-black/40 font-bold'
              : 'text-[rgba(236,236,237,0.5)] hover:text-[#ececed]'
          }`}
        >
          <List className="w-3.5 h-3.5 text-[#00ffa3]" />
          <span>Trade Log ({result.trades.length})</span>
        </button>
      </div>

      {/* Tab Panels */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <PriceChart
            bars={result.bars}
            trades={result.trades}
            indicators={result.strategy.indicators}
            symbol={result.symbol}
          />
          <EquityCharts
            equityCurve={result.equityCurve}
            benchmarkReturnPercent={result.metrics.benchmarkReturnPercent}
            trades={result.trades}
            initialCapital={result.metrics.initialCapital}
          />
        </div>
      )}

      {activeTab === 'compare' && (
        <StrategyComparisonView
          activeResult={result}
          comparisonResults={comparisonResults}
          onSelectActiveResult={onSelectActiveResult}
          onUpdateComparisonList={onUpdateComparisonList}
          onApplyStrategy={onApplyStrategy}
          onRunBacktest={onReRun}
        />
      )}

      {activeTab === 'robustness' && (
        <RobustnessView
          result={result}
          onRunNewSimulation={onReRun}
        />
      )}

      {activeTab === 'costs' && (
        <IndianCostWaterfall
          costs={result.costs}
          config={result.strategy.costs}
          netPnl={result.metrics.netPnl}
          tradesCount={result.metrics.totalTrades}
          tradeType={result.strategy.costs.tradeType}
        />
      )}

      {activeTab === 'trades' && (
        <TradeLogTable
          trades={result.trades}
          symbol={result.symbol}
        />
      )}
    </div>
  );
};
