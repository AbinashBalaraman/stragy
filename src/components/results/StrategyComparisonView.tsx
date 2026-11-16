import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  AreaChart,
  Area
} from 'recharts';
import { BacktestResponse, StrategyAST } from '../../shared/strategy/types';
import { requestBacktest, type RunRequestOptions } from '../../client/api';
import { comparisonSeriesKey, consolidateComparisonRuns, partitionComparisonRuns, toggleComparisonVisibility } from '../../client/comparisonCompatibility';
import { repairStrategyAST } from '../../shared/strategy/schema';
import { STRATEGY_TEMPLATES } from '../../shared/strategy/templates';
import { formatINR, formatNumber, formatPercent } from '../../shared/format';
import {
  RefreshCw,
  Trash2,
  Check,
  ChevronRight,
  Info,
  Scale
} from 'lucide-react';

export type ComparisonListUpdate = (update: BacktestResponse[] | ((current: BacktestResponse[]) => BacktestResponse[])) => void;

export interface StrategyComparisonViewProps {
  currentResult?: BacktestResponse;
  activeResult?: BacktestResponse;
  comparisonResults: BacktestResponse[];
  onApplyStrategy?: (strategy: StrategyAST) => void;
  onUpdateComparisonList?: ComparisonListUpdate;
  onSelectActiveResult?: (result: BacktestResponse) => void;
  onRunBacktest?: () => void;
}

/** Categorical series colours stay in one family; the legend index and dash pattern carry the rest. */
const PALETTE = ['#a8c7fa', '#7d9bc4', '#c7dbff', '#94a3b8', '#5b7595', '#dbe4f0'];
const DASHES: Array<string | undefined> = [undefined, '6 3', '2 3', '8 4', '4 2', '1 4'];

const roundParam = (value: number): number => Math.round(value * 100) / 100;
const compactPercent = (value: number): string => `${formatNumber(value, 2).replace(/\.?0+$/, '')}%`;

const profitFactorText = (metrics: BacktestResponse['metrics'] | undefined): { text: string; noLosses: boolean } => {
  if (!metrics) return { text: 'N/A', noLosses: false };
  if (metrics.profitFactor === null && metrics.losingTrades === 0 && metrics.winningTrades > 0) return { text: 'No losing trades', noLosses: true };
  return { text: formatNumber(metrics.profitFactor), noLosses: false };
};

export const StrategyComparisonView: React.FC<StrategyComparisonViewProps> = ({
  currentResult: providedCurrentResult,
  activeResult,
  comparisonResults = [],
  onApplyStrategy,
  onUpdateComparisonList,
  onSelectActiveResult
}) => {
  const currentResult = activeResult || providedCurrentResult || comparisonResults?.find(result => result?.strategy);
  const effectiveCurrent = currentResult;
  const generation = useRef(0);
  const batchAbort = useRef<AbortController | null>(null);
  const [batchError, setBatchError] = useState('');
  useEffect(() => {
    generation.current++;
    batchAbort.current?.abort();
    setIsRunningBatch(false);
    return () => { generation.current++; batchAbort.current?.abort(); };
  }, [effectiveCurrent?.backtestId]);
  const [isRunningBatch, setIsRunningBatch] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [visibleSeries, setVisibleSeries] = useState<Record<string, boolean>>({});
  const [chartMetric, setChartMetric] = useState<'equity' | 'drawdown'>('equity');
  const [sortKey, setSortKey] = useState<'sharpeRatio' | 'totalReturnPercent' | 'netPnl' | 'winRate' | 'maxDrawdownPercent'>('sharpeRatio');
  const [sortAsc, setSortAsc] = useState(false);

  const loadedResults = useMemo(() => consolidateComparisonRuns(effectiveCurrent, Array.isArray(comparisonResults) ? comparisonResults : []), [effectiveCurrent, comparisonResults]);
  const compatibility = useMemo(() => effectiveCurrent ? partitionComparisonRuns(effectiveCurrent, loadedResults) : { compatible: [], excluded: [], baselineIssues: [] }, [effectiveCurrent, loadedResults]);
  const allResults = compatibility.compatible;
  const canRank = allResults.length > 1 && compatibility.baselineIssues.length === 0;

  const topPerformer = useMemo(() => {
    if (!canRank || !allResults.some(result => Number.isFinite(result.metrics.sharpeRatio))) return null;
    return allResults.filter(result => Number.isFinite(result.metrics.sharpeRatio)).sort((a, b) => (b.metrics?.sharpeRatio ?? -Infinity) - (a.metrics?.sharpeRatio ?? -Infinity))[0];
  }, [allResults, canRank]);

  const sortedResults = useMemo(() => {
    return [...allResults].sort((a, b) => {
      const valueA = a.metrics?.[sortKey];
      const valueB = b.metrics?.[sortKey];
      if (valueA == null) return valueB == null ? 0 : 1;
      if (valueB == null) return -1;
      return sortAsc ? valueA - valueB : valueB - valueA;
    });
  }, [allResults, sortKey, sortAsc]);

  const multiEquityData = useMemo(() => {
    if (allResults.length === 0) return [];
    const dateMap = new Map<number, Record<string, string | number>>();

    allResults.forEach(result => {
      const strategyKey = comparisonSeriesKey(result.backtestId, 'equity');
      const drawdownKey = comparisonSeriesKey(result.backtestId, 'drawdown');
      const curve = result.equityCurve || [];

      curve.forEach(point => {
        if (!point || !point.date) return;
        if (!dateMap.has(point.timestamp)) {
          dateMap.set(point.timestamp, {
            date: point.date,
            timestamp: point.timestamp || 0,
            benchmark: point.benchmarkEquity
          });
        }
        const row = dateMap.get(point.timestamp)!;
        row[strategyKey] = point.equity;
        row[drawdownKey] = Math.abs(point.drawdownPercent || 0);
      });
    });

    return Array.from(dateMap.values()).sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
  }, [allResults, canRank]);

  const contextFor = (result: BacktestResponse): RunRequestOptions => ({
    initialCapital: result.metrics.initialCapital,
    start: result.bars[0]?.date,
    end: result.bars.at(-1)?.date,
    seed: 42
  });

  const runBatch = async (variants: StrategyAST[], baseline: BacktestResponse) => {
    if (!onUpdateComparisonList) return;
    batchAbort.current?.abort();
    const abort = new AbortController();
    batchAbort.current = abort;
    const owned = ++generation.current;
    setIsRunningBatch(true);
    setBatchError('');
    const results: BacktestResponse[] = [];
    try {
      for (const candidate of variants.slice(0, 4)) {
        if (abort.signal.aborted) return;
        try { results.push(await requestBacktest(candidate, abort.signal, contextFor(baseline))); }
        catch (error) { if (abort.signal.aborted) return; setBatchError((error as Error).message); }
      }
      if (generation.current === owned) onUpdateComparisonList(current => {
        const latest = Array.isArray(current) ? current : [];
        return [...latest, baseline, ...results].filter((run, index, list) => list.findIndex(item => item.backtestId === run.backtestId) === index).slice(-12);
      });
    } finally {
      if (generation.current === owned) setIsRunningBatch(false);
    }
  };

  const indicatorPeriodSweep = (base: StrategyAST, scale: number): StrategyAST => {
    let varied = false;
    const indicators = base.indicators.map(indicator => ({
      ...indicator,
      params: Object.fromEntries(Object.entries(indicator.params).map(([key, value]) => {
        if (!/period/i.test(key) || !Number.isFinite(value)) return [key, value];
        varied = true;
        return [key, Math.min(10000, Math.max(1, Math.round(value * scale)))];
      })),
    }));
    if (!varied) throw new Error('There are no indicator period parameters to vary. No sweep was invented.');
    return repairStrategyAST({ ...base, name: base.name + ' · Indicator period x' + scale, indicators });
  };

  const stopLossValues = useMemo(() => currentResult
    ? [0.8, 1, 1.2].map(scale => roundParam(currentResult.strategy.risk.stopLoss.value * scale))
    : [], [currentResult]);
  const trailingValues = useMemo(() => currentResult?.strategy.risk.trailingStop
    ? [0.8, 1, 1.2].map(scale => roundParam(currentResult.strategy.risk.trailingStop!.value * scale))
    : [], [currentResult]);

  const handleRunPresetSweep = async (presetType: 'stoploss' | 'indicators' | 'trailing' | 'templates') => {
    if (!currentResult) return;
    setSelectedPreset(presetType);
    const base = currentResult.strategy;
    let variants: StrategyAST[] = [];
    try {
      if (presetType === 'stoploss') {
        variants = stopLossValues.map(value => repairStrategyAST({
          ...base,
          name: `SL ${compactPercent(value)} · ${base.name}`,
          risk: { ...base.risk, stopLoss: { ...base.risk.stopLoss, value } }
        }));
      } else if (presetType === 'trailing') {
        if (!base.risk.trailingStop) { setBatchError('There is no trailing stop to vary. No control was invented.'); return; }
        variants = trailingValues.map(value => repairStrategyAST({
          ...base,
          name: `Trail ${compactPercent(value)} · ${base.name}`,
          risk: { ...base.risk, trailingStop: { ...base.risk.trailingStop!, value } }
        }));
      } else if (presetType === 'indicators') {
        variants = [0.8, 1.25].map(scale => indicatorPeriodSweep(base, scale));
      } else {
        variants = STRATEGY_TEMPLATES.slice(0, 4).map(template => repairStrategyAST({
          ...template.strategy,
          universe: { ...template.strategy.universe, symbolId: base.universe.symbolId }
        }));
      }
    } catch (caught) {
      setBatchError('The sweep could not be prepared: ' + (caught as Error).message + ' Nothing was run.');
      return;
    }
    await runBatch(variants, currentResult);
  };

  const handleReRunAll = async () => {
    if (currentResult) await runBatch(allResults.slice(0, 4).map(result => result.strategy), currentResult);
  };

  const handleRemove = (idToRemove: string) => {
    onUpdateComparisonList?.(current => (Array.isArray(current) ? current : []).filter(result => result?.strategy && result.backtestId !== idToRemove));
  };

  const handleToggleSeries = (runId: string) => setVisibleSeries(prev => toggleComparisonVisibility(prev, runId));

  const seriesIndex = (runId: string): number => {
    const index = allResults.findIndex(result => result.backtestId === runId);
    return index >= 0 ? index : 0;
  };
  const colorFor = (runId: string): string => PALETTE[seriesIndex(runId) % PALETTE.length];
  const dashFor = (runId: string): string | undefined => DASHES[seriesIndex(runId) % DASHES.length];

  const sortableHeader = (key: typeof sortKey, label: string, extraClass = '') => (
    <th
      className={`cursor-pointer px-3 py-3 transition-colors hover:text-[#ececed] ${extraClass}`}
      aria-sort={sortKey === key ? (sortAsc ? 'ascending' : 'descending') : 'none'}
      onClick={() => {
        if (sortKey === key) setSortAsc(!sortAsc);
        else { setSortKey(key); setSortAsc(false); }
      }}
    >
      <div className="flex items-center gap-1">
        <span>{label}</span>
        {sortKey === key && <span className="text-[#a8c7fa]">{sortAsc ? '▲' : '▼'}</span>}
      </div>
    </th>
  );

  if (!currentResult) {
    return (
      <div className="space-y-2 rounded-2xl border border-[rgba(236,236,237,0.08)] bg-[#171719] p-8 text-center text-xs text-[rgba(236,236,237,0.55)]">
        {batchError && <p role="alert" className="text-rose-300">{batchError}</p>}
        <p className="text-xs text-[rgba(236,236,237,0.55)]">Comparisons are immutable run snapshots. Different symbols, data windows, capital or execution assumptions are not directly comparable.</p>
        <p>No completed run is loaded for comparison.</p>
      </div>
    );
  }

  const symbolName = currentResult.symbol?.name || 'Asset';
  const symbolTicker = currentResult.symbol?.ticker || 'NSE';
  const sweepButtonClass = (preset: string) =>
    `rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
      selectedPreset === preset
        ? 'border-[#a8c7fa]/50 bg-[#a8c7fa]/10 text-[#a8c7fa]'
        : 'border-[rgba(236,236,237,0.1)] bg-[#101012] text-[rgba(236,236,237,0.68)] hover:border-[rgba(236,236,237,0.22)] hover:text-[#ececed]'
    }`;

  return (
    <div className="space-y-4">
      <section className="space-y-4 rounded-2xl border border-[rgba(236,236,237,0.08)] bg-[#171719] p-4 sm:p-5">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Scale className="h-4 w-4 text-[#a8c7fa]" />
              <h3 className="text-base font-semibold tracking-tight text-[#ececed]">Compare variations</h3>
              <span className="rounded border border-[rgba(236,236,237,0.1)] bg-[#1e1e21] px-2 py-0.5 font-mono text-[11px] text-[rgba(236,236,237,0.62)]">
                {allResults.length} compatible · {loadedResults.length} {loadedResults.length === 1 ? 'run' : 'runs'} loaded
              </span>
            </div>
            <p className="text-xs leading-relaxed text-[rgba(236,236,237,0.58)]">
              Rank runs of {symbolName} ({symbolTicker}) that share the same dates, capital and costs. Each run is kept as its own result.
            </p>
          </div>

          <button
            type="button"
            onClick={handleReRunAll}
            disabled={isRunningBatch}
            className="flex shrink-0 items-center gap-1.5 rounded-xl border border-[rgba(236,236,237,0.1)] bg-[#1e1e21] px-3 py-1.5 text-xs font-medium text-[#ececed] transition-colors hover:border-[#a8c7fa]/40 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRunningBatch ? 'animate-spin text-[#a8c7fa]' : 'text-[#a8c7fa]'}`} />
            <span>{isRunningBatch ? 'Running variations…' : 'Re-run variations'}</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-[rgba(236,236,237,0.08)] pt-3">
          <span className="text-xs font-medium text-[rgba(236,236,237,0.52)]">Sweeps</span>
          <button type="button" onClick={() => handleRunPresetSweep('stoploss')} disabled={isRunningBatch} className={sweepButtonClass('stoploss')}>
            Stop-Loss Sweep (SL {stopLossValues.map(value => compactPercent(value)).join(' · ')})
          </button>
          <button type="button" onClick={() => handleRunPresetSweep('trailing')} disabled={isRunningBatch} className={sweepButtonClass('trailing')}>
            {currentResult.strategy.risk.trailingStop
              ? `Trailing Stop Sweep (trail ${trailingValues.map(value => compactPercent(value)).join(' · ')})`
              : 'Trailing Stop Sweep (no trailing stop)'}
          </button>
          <button type="button" onClick={() => handleRunPresetSweep('indicators')} disabled={isRunningBatch} className={sweepButtonClass('indicators')}>
            Indicator Period Sweep (×0.8, ×1.25)
          </button>
          <button type="button" onClick={() => handleRunPresetSweep('templates')} disabled={isRunningBatch} className={sweepButtonClass('templates')}>
            Compare 4 strategy templates
          </button>
        </div>

        {batchError && <p role="alert" className="text-xs text-rose-300">{batchError}</p>}
      </section>

      <details className="group rounded-xl border border-amber-500/25 bg-amber-500/[0.04] px-3.5 py-2.5 text-xs">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[rgba(236,236,237,0.7)] [&::-webkit-details-marker]:hidden">
          <span>
            Run a sweep above to add a matching variation.
            {compatibility.excluded.length > 0 ? ` ${compatibility.excluded.length} ${compatibility.excluded.length === 1 ? 'run is' : 'runs are'} excluded.` : ''}
            {!canRank ? ' Two matching runs are needed before ranking starts.' : ' Only runs with the same symbol, dates, capital and costs are ranked.'}
          </span>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-amber-300 transition-transform group-open:rotate-90" />
        </summary>
        <div className="mt-2 space-y-2 leading-relaxed text-[rgba(236,236,237,0.6)]">
          <p>Each run is kept as its own result; a strategy name alone does not identify a run. A different symbol, dates, capital or cost model is not directly comparable.</p>
          {compatibility.baselineIssues.length > 0 && <p role="alert" className="text-rose-300">Baseline context is unverified: {compatibility.baselineIssues.join(', ')}. Ranking is disabled.</p>}
          {compatibility.excluded.length > 0 && (
            <ul className="space-y-2">
              {compatibility.excluded.map(({ result, reasons }) => (
                <li key={result.backtestId}>
                  <strong className="text-[rgba(236,236,237,0.82)]">{result.strategy.name}</strong> ({result.symbol.ticker}) <code>{result.backtestId}</code>: {reasons.join('; ')}.
                  {onSelectActiveResult && <button type="button" className="ml-2 text-[#a8c7fa] underline" onClick={() => onSelectActiveResult(result)}>Inspect</button>}
                  {onUpdateComparisonList && <button type="button" className="ml-2 text-[#a8c7fa] underline" onClick={() => handleRemove(result.backtestId)}>Remove</button>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>

      <section className="space-y-4 rounded-2xl border border-[rgba(236,236,237,0.08)] bg-[#171719] p-4 sm:p-5">
        <div className="flex flex-col justify-between gap-3 border-b border-[rgba(236,236,237,0.08)] pb-3 sm:flex-row sm:items-center">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-[#ececed] sm:text-base">
                {chartMetric === 'equity' ? 'Equity overlay' : 'Drawdown overlay'}
              </h3>
              <span className="rounded bg-[#1e1e21] px-2 py-0.5 font-mono text-[11px] text-[rgba(236,236,237,0.62)]">
                {multiEquityData.length} sessions
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-[rgba(236,236,237,0.52)]">
              {formatINR(currentResult.metrics.initialCapital)} initial capital across compatible runs only.
            </p>
          </div>

          <div className="flex items-center gap-1 rounded-xl border border-[rgba(236,236,237,0.08)] bg-[#101012] p-1 text-xs font-medium">
            <button
              type="button"
              onClick={() => setChartMetric('equity')}
              aria-pressed={chartMetric === 'equity'}
              className={`rounded-lg px-2.5 py-1 transition-colors ${chartMetric === 'equity' ? 'bg-[#a8c7fa] font-semibold text-[#101012]' : 'text-[rgba(236,236,237,0.58)] hover:text-[#ececed]'}`}
            >
              Equity
            </button>
            <button
              type="button"
              onClick={() => setChartMetric('drawdown')}
              aria-pressed={chartMetric === 'drawdown'}
              className={`rounded-lg px-2.5 py-1 transition-colors ${chartMetric === 'drawdown' ? 'bg-[#a8c7fa] font-semibold text-[#101012]' : 'text-[rgba(236,236,237,0.58)] hover:text-[#ececed]'}`}
            >
              Drawdown
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {allResults.map((result, index) => {
            const color = colorFor(result.backtestId);
            const visible = visibleSeries[result.backtestId] !== false;
            const isTop = topPerformer?.backtestId === result.backtestId;
            return (
              <button
                key={result.backtestId}
                type="button"
                onClick={() => handleToggleSeries(result.backtestId)}
                aria-pressed={visible}
                title={`${result.strategy.name} (${result.backtestId})`}
                className={`flex min-w-0 max-w-full items-center gap-1.5 rounded-lg border px-2 py-1 text-xs transition-colors ${
                  visible
                    ? 'border-[rgba(236,236,237,0.12)] bg-[#101012] text-[rgba(236,236,237,0.82)]'
                    : 'border-[rgba(236,236,237,0.06)] bg-[#101012]/40 text-[rgba(236,236,237,0.35)] line-through'
                }`}
              >
                <span className="font-mono text-[10px] text-[rgba(236,236,237,0.45)]">{String(index + 1).padStart(2, '0')}</span>
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color, opacity: visible ? 1 : 0.3 }} />
                <span className="truncate max-w-[150px] sm:max-w-[210px]">{result.strategy?.name || `Strategy ${index + 1}`}</span>
                {isTop && <span className="shrink-0 rounded border border-[#a8c7fa]/30 px-1 text-[9px] font-semibold uppercase tracking-wide text-[#a8c7fa]">Top</span>}
              </button>
            );
          })}
        </div>

        <div className="h-72 w-full sm:h-80 lg:h-96">
          <ResponsiveContainer width="100%" height="100%">
            {chartMetric === 'equity' ? (
              <LineChart data={multiEquityData} margin={{ top: 10, right: 15, left: -15, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(236, 236, 237, 0.05)" />
                <XAxis
                  dataKey="date"
                  stroke="#6b7280"
                  fontSize={10}
                  tickFormatter={value => (typeof value === 'string' && value.length > 5 ? value.slice(5) : value || '')}
                  minTickGap={30}
                />
                <YAxis
                  stroke="#6b7280"
                  fontSize={10}
                  tickFormatter={value => `₹${((value || 0) / 1000).toFixed(0)}k`}
                  domain={['auto', 'auto']}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#151517',
                    borderColor: 'rgba(236, 236, 237, 0.12)',
                    borderRadius: '0.75rem',
                    fontSize: '0.75rem',
                    color: '#ececed'
                  }}
                  formatter={(value: any, name: string) => {
                    const matchedRun = allResults.find(run => comparisonSeriesKey(run.backtestId, 'equity') === name);
                    if (matchedRun) return [formatINR(Number(value || 0)), matchedRun.strategy.name];
                    if (name === 'benchmark') return [formatINR(Number(value || 0)), 'Instrument buy-and-hold'];
                    return [value, name];
                  }}
                />
                <Line type="monotone" dataKey="benchmark" stroke="#52525b" strokeDasharray="4 4" strokeWidth={1.5} dot={false} name="benchmark" />
                {allResults.map(result => {
                  if (visibleSeries[result.backtestId] === false) return null;
                  return (
                    <Line
                      key={result.backtestId}
                      type="monotone"
                      dataKey={comparisonSeriesKey(result.backtestId, 'equity')}
                      stroke={colorFor(result.backtestId)}
                      strokeDasharray={dashFor(result.backtestId)}
                      strokeWidth={topPerformer?.backtestId === result.backtestId ? 2.4 : 1.7}
                      dot={false}
                      name={comparisonSeriesKey(result.backtestId, 'equity')}
                    />
                  );
                })}
              </LineChart>
            ) : (
              <AreaChart data={multiEquityData} margin={{ top: 10, right: 15, left: -15, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(236, 236, 237, 0.05)" />
                <XAxis
                  dataKey="date"
                  stroke="#6b7280"
                  fontSize={10}
                  tickFormatter={value => (typeof value === 'string' && value.length > 5 ? value.slice(5) : value || '')}
                  minTickGap={30}
                />
                <YAxis
                  stroke="#6b7280"
                  fontSize={10}
                  tickFormatter={value => formatPercent(-Math.abs(Number(value)), { decimals: 0 })}
                  domain={[0, 'auto']}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#151517',
                    borderColor: 'rgba(236, 236, 237, 0.12)',
                    borderRadius: '0.75rem',
                    fontSize: '0.75rem',
                    color: '#ececed'
                  }}
                  formatter={(value: any, name: string) => {
                    const matchedRun = allResults.find(run => comparisonSeriesKey(run.backtestId, 'drawdown') === name);
                    if (matchedRun) return [formatPercent(-Math.abs(Number(value || 0)), { decimals: 2 }), matchedRun.strategy.name];
                    return [value, name];
                  }}
                />
                {allResults.map(result => {
                  if (visibleSeries[result.backtestId] === false) return null;
                  return (
                    <Area
                      key={result.backtestId}
                      type="monotone"
                      dataKey={comparisonSeriesKey(result.backtestId, 'drawdown')}
                      stroke={colorFor(result.backtestId)}
                      strokeDasharray={dashFor(result.backtestId)}
                      fill={colorFor(result.backtestId)}
                      fillOpacity={0.05}
                      strokeWidth={1.7}
                      name={comparisonSeriesKey(result.backtestId, 'drawdown')}
                    />
                  );
                })}
              </AreaChart>
            )}
          </ResponsiveContainer>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-[rgba(236,236,237,0.08)] bg-[#171719]">
        <div className="flex flex-col justify-between gap-2 border-b border-[rgba(236,236,237,0.08)] p-4 sm:flex-row sm:items-center">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-semibold text-[#ececed]">Ranked variations</h4>
            <span className="text-[11px] text-[rgba(236,236,237,0.45)]">Click a column to sort</span>
          </div>
          <div className="flex items-center gap-1 text-xs text-[rgba(236,236,237,0.52)]">
            <Info className="h-3.5 w-3.5 text-[#a8c7fa]" />
            <span>Costs reflect each run's fee configuration; statutory rates may be illustrative.</span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full table-fixed text-left text-xs">
            <thead className="select-none border-b border-[rgba(236,236,237,0.08)] bg-[#101012] text-[11px] font-semibold uppercase tracking-wider text-[rgba(236,236,237,0.52)]">
              <tr>
                <th className="w-8 px-2 py-3 sm:w-[38px] sm:px-3">
                  <span className="sm:hidden">#</span>
                  <span className="hidden sm:inline">Rank</span>
                </th>
                <th className="w-auto px-2 py-3 sm:w-[250px] sm:px-3">Variation</th>
                {sortableHeader('totalReturnPercent', 'Net return', 'w-[78px] sm:w-[110px]')}
                {sortableHeader('sharpeRatio', 'Sharpe', 'hidden xl:table-cell xl:w-[65px]')}
                {sortableHeader('winRate', 'Win rate', 'hidden xl:table-cell xl:w-[85px]')}
                <th className="hidden px-3 py-3 xl:table-cell xl:w-[75px]">Profit factor</th>
                {sortableHeader('maxDrawdownPercent', 'Max DD', 'hidden xl:table-cell xl:w-[90px]')}
                <th className="hidden px-3 py-3 xl:table-cell xl:w-[65px]">Trades</th>
                <th className="w-[84px] px-2 py-3 text-right sm:w-[160px] sm:px-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[rgba(236,236,237,0.06)] font-mono text-xs">
              {sortedResults.map((result, index) => {
                if (!result || !result.strategy) return null;
                const isTop = topPerformer?.backtestId === result.backtestId;
                const isCurrent = currentResult.backtestId === result.backtestId;
                const color = colorFor(result.backtestId);
                const netPnl = result.metrics?.netPnl ?? 0;
                const indicatorsList = Array.isArray(result.strategy?.indicators) && result.strategy.indicators.length
                  ? result.strategy.indicators.map(indicator => indicator.id).join(' · ')
                  : 'Price rules';
                const profitFactor = profitFactorText(result.metrics);

                return (
                  <tr key={result.backtestId} className={`transition-colors hover:bg-white/[0.02] ${isTop ? 'bg-[#a8c7fa]/[0.035]' : ''}`}>
                    <td className="px-2 py-3.5 font-semibold sm:px-3">
                      <span className={isTop ? 'text-[#a8c7fa]' : 'text-[rgba(236,236,237,0.5)]'}>{index + 1}</span>
                    </td>
                    <td className="min-w-0 px-2 py-3.5 sm:px-3">
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="max-w-[130px] truncate font-sans text-xs font-semibold text-[#ececed] sm:max-w-[240px]" title={result.strategy.name}>
                              {result.strategy.name || `Strategy ${index + 1}`}
                            </span>
                            {isTop && <span className="rounded border border-[#a8c7fa]/30 px-1.5 text-[10px] font-sans font-semibold text-[#a8c7fa]">Top Sharpe</span>}
                            {isCurrent && <span className="rounded border border-[rgba(236,236,237,0.14)] px-1.5 text-[10px] font-sans font-medium text-[rgba(236,236,237,0.6)]">Current</span>}
                          </div>
                          <p className="mt-0.5 truncate font-sans text-[11px] text-[rgba(236,236,237,0.45)]" title={`${indicatorsList} · SL ${formatNumber(result.strategy.risk?.stopLoss?.value ?? 2, 2)}% · ${result.backtestId}`}>
                            {indicatorsList} · SL {formatNumber(result.strategy.risk?.stopLoss?.value ?? 2, 2)}% · {result.strategy.risk?.takeProfit ? `TP ${formatNumber(result.strategy.risk.takeProfit.value, 2)}% · ` : ''}{result.strategy.risk?.trailingStop ? `trail ${formatNumber(result.strategy.risk.trailingStop.value, 2)}% · ` : ''}run {result.backtestId}
                          </p>
                        </div>
                      </div>
                    </td>

                    <td className="px-3 py-3.5">
                      <div className={`font-semibold ${netPnl >= 0 ? 'text-[#a8c7fa]' : 'text-rose-300'}`}>
                        {formatPercent(result.metrics?.totalReturnPercent, { signed: true, decimals: 2 })}
                      </div>
                      <div className="text-[11px] text-[rgba(236,236,237,0.5)]">
                        {formatINR(netPnl, { signed: true })}<span className="hidden sm:inline"> · fees {formatINR(result.costs?.totalCharges)}</span>
                      </div>
                    </td>

                    <td className="hidden px-3 py-3.5 xl:table-cell">
                      <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${(result.metrics?.sharpeRatio ?? 0) >= 1.5 ? 'bg-[#a8c7fa]/15 text-[#a8c7fa]' : (result.metrics?.sharpeRatio ?? 0) >= 1 ? 'bg-[#a8c7fa]/10 text-[#c7dbff]' : 'text-[rgba(236,236,237,0.7)]'}`}>
                        {formatNumber(result.metrics?.sharpeRatio)}
                      </span>
                    </td>

                    <td className="hidden px-3 py-3.5 text-[rgba(236,236,237,0.8)] xl:table-cell">
                      <div className="font-semibold">{formatPercent(result.metrics?.winRate, { decimals: 1 })}</div>
                      <div className="text-[10px] text-[rgba(236,236,237,0.45)]">
                        {result.metrics?.winningTrades ?? 0}W / {result.metrics?.losingTrades ?? 0}L
                      </div>
                    </td>

                    <td className={`hidden px-3 py-3.5 font-semibold xl:table-cell ${profitFactor.noLosses ? 'font-sans text-[11px] text-[#a8c7fa]' : 'text-[rgba(236,236,237,0.8)]'}`}>
                      {profitFactor.text}
                    </td>

                    <td className="hidden px-3 py-3.5 text-rose-300 xl:table-cell">
                      <div className="font-semibold">{formatPercent(Math.abs(result.metrics?.maxDrawdownPercent ?? 0), { decimals: 2 })}</div>
                      <div className="text-[10px] text-[rgba(236,236,237,0.45)]">{formatINR(result.metrics?.maxDrawdownAmount)}</div>
                    </td>

                    <td className="hidden px-3 py-3.5 text-[rgba(236,236,237,0.7)] xl:table-cell">
                      <div>{result.metrics?.totalTrades ?? 0}</div>
                      <div className="text-[10px] text-[rgba(236,236,237,0.45)]">~{formatNumber(result.metrics?.avgHoldingBars, 0)} {(result.metrics?.avgHoldingBars ?? 0) === 1 ? 'bar' : 'bars'}</div>
                    </td>

                    <td className="w-[86px] px-2 py-3.5 text-right sm:w-[180px] sm:px-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => onApplyStrategy?.(result.strategy)}
                          aria-label="Use this variation"
                          className="flex items-center gap-1 whitespace-nowrap rounded-lg border border-[#a8c7fa]/35 bg-[#a8c7fa]/10 px-2 py-1 font-sans text-[11px] font-medium text-[#a8c7fa] transition-colors hover:bg-[#a8c7fa] hover:text-[#101012]"
                          title="Copy this run's strategy into the builder. This does not run a simulation."
                        >
                          <Check className="h-3 w-3" />
                          <span className="sm:hidden">Use</span>
                          <span className="hidden sm:inline">Use this variation</span>
                        </button>
                        {onSelectActiveResult && (
                          <button
                            type="button"
                            onClick={() => onSelectActiveResult?.(result)}
                            className="hidden rounded-lg p-1 text-[rgba(236,236,237,0.5)] transition-colors hover:bg-[#1e1e21] hover:text-[#ececed] sm:inline-flex"
                            title={`Inspect ${result.strategy.name}`}
                            aria-label={`Inspect ${result.strategy.name}`}
                          >
                            <ChevronRight className="h-4 w-4" />
                          </button>
                        )}
                        {allResults.length > 1 && !isCurrent && (
                          <button
                            type="button"
                            onClick={() => handleRemove(result.backtestId)}
                            className="hidden rounded-lg p-1 text-[rgba(236,236,237,0.45)] transition-colors hover:bg-[#1e1e21] hover:text-rose-300 sm:inline-flex"
                            title="Remove variation from matrix"
                            aria-label={`Remove ${result.strategy.name}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
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
      </section>
    </div>
  );
};

