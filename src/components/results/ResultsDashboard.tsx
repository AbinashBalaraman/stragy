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
import { Disclosure } from '../common/Disclosure';

interface ResultsDashboardProps {
  result: BacktestResponse | null;
  comparisonResults?: BacktestResponse[];
  onReRun: (result?: BacktestResponse) => void;
  onApplyStrategy?: (strategy: StrategyAST) => void;
  onUpdateComparisonList?: ComparisonListUpdate;
  onSelectActiveResult?: (result: BacktestResponse) => void;
  isLoading: boolean;
  initialTab?: 'overview' | 'compare' | 'robustness' | 'costs' | 'trades';
  /** Name of the draft in the tester, shown in the empty state. */
  draftName?: string;
  /** Opens the strategy tester from the empty state. */
  onOpenTester?: () => void;
}

type TabId = NonNullable<ResultsDashboardProps['initialTab']>;

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'overview', label: 'Overview & charts' },
  { id: 'compare', label: 'Compare variations' },
  { id: 'robustness', label: 'Robustness' },
  { id: 'costs', label: 'Costs' },
  { id: 'trades', label: 'Trade log' },
];

export const ResultsDashboard: React.FC<ResultsDashboardProps> = ({
  result,
  comparisonResults = [],
  onReRun,
  onApplyStrategy,
  onUpdateComparisonList,
  onSelectActiveResult,
  isLoading,
  initialTab = 'overview',
  draftName,
  onOpenTester
}) => {
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);

  if (!result) {
    return (
      <div className="mx-auto max-w-xl p-6 sm:p-10">
        <div className="space-y-4 rounded-[var(--r-card)] border border-[var(--line)] bg-[var(--surface-1)] p-6 sm:p-8">
          <div className="space-y-1.5">
            <h3 className="text-lg font-semibold tracking-tight text-[#ececed]">No backtest yet</h3>
            <p className="text-xs leading-relaxed text-[rgba(236,236,237,0.6)]">
              {draftName
                ? <>The tester currently holds <span className="text-neutral-200">{draftName}</span>. Review its rules and window there, then run it.</>
                : 'Open the strategy tester, review the rule summary, then run a backtest on NSE daily sessions.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => onReRun()} disabled={isLoading} className="btn-primary-mint">
              {isLoading ? 'Running research…' : 'Run the current strategy'}
            </button>
            {onOpenTester && (
              <button type="button" onClick={onOpenTester} className="rounded-lg border border-white/15 px-3.5 py-2 text-xs font-medium text-neutral-200 transition-colors hover:border-[#a8c7fa]/40 hover:bg-white/[0.04]">
                Open Strategy tester
              </button>
            )}
          </div>
        </div>
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
      <header className="rounded-[var(--r-card)] border border-[var(--line)] bg-[var(--surface-1)] p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold tracking-[-0.01em] text-[var(--text-1)]">{result.strategy.name}</h2>
            <p className="st-meta mt-1 text-[var(--text-3)]">
              {result.symbol.ticker} · {result.strategy.universe.timeframe} · {result.bars.length} sessions · completed {formatDateTime(result.executedAt)}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('compare')}
              className="rounded-[var(--r-btn)] border border-[var(--line)] px-3 py-2 text-xs font-medium text-[var(--text-2)] transition-colors hover:border-[var(--line-strong)] hover:text-[var(--text-1)]"
            >
              Compare variations ({comparisonCount})
            </button>
            <button
              type="button"
              onClick={() => onReRun(result)}
              disabled={isLoading}
              title="Run again with the displayed result's stored strategy and request window."
              className="rounded-[var(--r-btn)] bg-[#a8c7fa] px-3 py-2 text-xs font-semibold text-[#101012] transition-colors hover:bg-[#c7dbff] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoading ? 'Running…' : 'Run again'}
            </button>
          </div>
        </div>
      </header>

      <RunProvenance result={result} />

      {survivorship && (
        <Disclosure summary={`Universe-based run: today's ${survivorship.basis} members are used, which overstates past results.`}>
          <p>
            The screen is built from the current {survivorship.basis} constituent list. Companies removed from the index, or added after a past date, are not represented in that history. Treat this as a screen on surviving names, not a point-in-time universe study.
          </p>
        </Disclosure>
      )}

      <MetricsGrid metrics={result.metrics} />

      <div className="sticky top-0 z-30 -mx-4 border-y border-[var(--line)] bg-[#101012]/95 px-4 py-2 backdrop-blur sm:-mx-8 sm:px-8">
        <nav aria-label="Result views" className="flex flex-wrap items-center gap-1 text-xs">
          {TABS.map(tab => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                aria-current={active ? 'page' : undefined}
                aria-label={`${tab.label}${tab.id === 'trades' ? ` (${result.trades.length})` : ''}`}
                onClick={() => setActiveTab(tab.id)}
                className={'flex shrink-0 items-center rounded-[var(--r-btn)] px-3 py-1.5 transition-colors ' + (active ? 'bg-white/[0.08] font-medium text-[var(--text-1)]' : 'text-[var(--text-3)] hover:bg-white/[0.04] hover:text-[var(--text-2)]')}
              >
                <span>{tab.label}{tab.id === 'trades' ? ` (${result.trades.length})` : ''}</span>
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
