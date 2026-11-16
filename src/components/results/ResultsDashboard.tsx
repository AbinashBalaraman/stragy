import React, { useState } from 'react';
import { BacktestResponse, StrategyAST } from '../../shared/strategy/types';
import { formatDateTime } from '../../shared/format';
import { MetricsGrid } from './MetricsGrid';
import { PriceChart } from './PriceChart';
import { EquityCharts } from './EquityCharts';
import { RunProvenance } from './RunProvenance';
import { RobustnessView } from './RobustnessView';
import { IndianCostWaterfall } from './IndianCostWaterfall';
import { TradeLogTable } from './TradeLogTable';
import { StrategyComparisonView, type ComparisonListUpdate } from './StrategyComparisonView';
import { survivorshipBasis } from './survivorship';
import { Activity, ShieldCheck, Receipt, List, RefreshCw, Scale, ChevronRight } from 'lucide-react';

interface ResultsDashboardProps {
  result: BacktestResponse | null;
  comparisonResults?: BacktestResponse[];
  onReRun: (result?: BacktestResponse) => void;
  onApplyStrategy?: (strategy: StrategyAST) => void;
  onUpdateComparisonList?: ComparisonListUpdate;
  onSelectActiveResult?: (result: BacktestResponse) => void;
  isLoading: boolean;
  initialTab?: 'overview' | 'compare' | 'robustness' | 'costs' | 'trades';
}

type TabId = NonNullable<ResultsDashboardProps['initialTab']>;

const TABS: Array<{ id: TabId; label: string; short: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'overview', label: 'Overview & charts', short: 'Overview', icon: Activity },
  { id: 'compare', label: 'Compare variations', short: 'Compare', icon: Scale },
  { id: 'robustness', label: 'Robustness', short: 'Robustness', icon: ShieldCheck },
  { id: 'costs', label: 'Costs', short: 'Costs', icon: Receipt },
  { id: 'trades', label: 'Trade log', short: 'Trades', icon: List },
];

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
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);

  if (!result) {
    return (
      <div className="mx-auto max-w-lg space-y-4 p-8 text-center sm:p-12">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-[#a8c7fa]/30 bg-[#a8c7fa]/10 text-[#a8c7fa]">
          <Activity className="h-6 w-6 animate-pulse" />
        </div>
        <h3 className="text-base font-semibold text-[#ececed]">No simulation results yet</h3>
        <p className="text-xs leading-relaxed text-[rgba(236,236,237,0.6)]">
          Configure your strategy rules and parameters in the Strategy Builder, then run a backtest on historical NSE sessions.
        </p>
        <button onClick={() => onReRun()} disabled={isLoading} className="btn-primary-mint">
          Run Backtest Now
        </button>
      </div>
    );
  }

  const comparisonCount = Math.max(
    comparisonResults.length,
    comparisonResults.some(r => r.strategy.id === result.strategy.id) ? comparisonResults.length : comparisonResults.length + 1
  );
  const survivorship = survivorshipBasis(result);

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 pb-24 sm:space-y-5 sm:p-8">
      <div className="flex flex-col justify-between gap-4 rounded-2xl border border-[rgba(236,236,237,0.08)] bg-[#171719] p-4 sm:flex-row sm:items-center sm:p-5">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-xl font-semibold tracking-[-0.02em] text-[#ececed] sm:text-2xl">
              {result.strategy.name}
            </h2>
            <span className="rounded border border-[rgba(168,199,250,0.25)] bg-[rgba(168,199,250,0.1)] px-2 py-0.5 font-mono text-[11px] font-semibold text-[#a8c7fa]">
              {result.symbol.ticker} · {result.strategy.universe.timeframe}
            </span>
          </div>
          <p className="text-xs text-[rgba(236,236,237,0.52)]">
            {result.bars.length} sessions · completed {formatDateTime(result.executedAt)}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2.5">
          <button
            onClick={() => setActiveTab('compare')}
            className="flex items-center gap-1.5 rounded-lg border border-[rgba(236,236,237,0.1)] bg-[#1e1e21] px-3.5 py-2 text-xs font-medium text-[#ececed] transition-colors hover:border-[#a8c7fa]/50 hover:bg-[#232326]"
          >
            <Scale className="h-3.5 w-3.5 text-[#a8c7fa]" />
            <span>Compare variations <span className="text-[rgba(236,236,237,0.45)]">({comparisonCount})</span></span>
          </button>
          <button
            onClick={() => onReRun(result)}
            disabled={isLoading}
            title="Re-run the displayed result's strategy and stored request window. This does not use the current builder draft."
            className="btn-primary-mint !px-3.5 !py-2 text-xs"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Re-Simulate</span>
          </button>
        </div>
      </div>

      <RunProvenance result={result} />

      {survivorship && (
        <details className="group rounded-xl border border-[rgba(236,236,237,0.08)] bg-[#171719]/60 px-3.5 py-2.5 text-xs">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
            <span className="min-w-0 text-[rgba(236,236,237,0.7)]">
              Universe-based run: today&apos;s {survivorship.basis} members are used, which overstates past results.
            </span>
            <span className="flex shrink-0 items-center gap-1 font-medium text-[#a8c7fa]">
              Details
              <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
            </span>
          </summary>
          <p className="mt-2 leading-relaxed text-[rgba(236,236,237,0.58)]">
            The screen is built from the current {survivorship.basis} constituent list. Companies removed from the index, or added after a past date, are not represented in that history. Treat this as a screen on surviving names, not a point-in-time universe study.
          </p>
        </details>
      )}

      <MetricsGrid metrics={result.metrics} />

      <div className="sticky top-0 z-30 -mx-4 border-y border-[rgba(236,236,237,0.08)] bg-[#101012]/95 px-4 py-2 backdrop-blur sm:-mx-8 sm:px-8">
        <nav aria-label="Result views" className="no-scrollbar flex items-center gap-1 overflow-x-auto text-xs font-medium">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                aria-current={active ? 'page' : undefined}
                aria-label={`${tab.label}${tab.id === 'trades' ? ` (${result.trades.length})` : ''}`}
                onClick={() => setActiveTab(tab.id)}
                className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 transition-colors sm:px-3 ${
                  active
                    ? 'bg-[#a8c7fa] font-semibold text-[#101012]'
                    : 'text-[rgba(236,236,237,0.55)] hover:bg-[#1e1e21] hover:text-[#ececed]'
                }`}
              >
                <Icon className={`hidden h-3.5 w-3.5 sm:block ${active ? 'text-[#101012]' : 'text-[#a8c7fa]'}`} />
                <span className="sm:hidden">{tab.short}</span>
                <span className="hidden sm:inline">{tab.label}{tab.id === 'trades' ? ` (${result.trades.length})` : ''}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {activeTab === 'overview' && (
        <div className="space-y-5">
          <PriceChart
            bars={result.bars}
            trades={result.trades}
            indicators={result.strategy.indicators}
            symbol={result.symbol}
          />
          <EquityCharts
            equityCurve={result.equityCurve}
            benchmarkLabel={result.symbol.ticker + ' buy-and-hold'}
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
