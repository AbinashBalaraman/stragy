import React, { useEffect, useState } from 'react';
import type { ResearchScreenPlan } from '../../shared/contracts/research-chat';
import type { ChartImageReading } from '../../client/chartAnalysis';
import type { IndicatorConfig, RuleNode, StrategyAST } from '../../shared/strategy/types';
import { renderRuleInPlainLanguage } from '../../shared/strategy/renderPlainLanguage';
import { describeBacktestAssumptions } from '../../shared/strategy/backtestReview';
import { truncateAtWord } from '../../shared/format';

interface Props {
  plan: ResearchScreenPlan;
  reading: ChartImageReading;
  busy?: boolean;
  applied?: boolean;
  canApply?: boolean;
  onUseAsDraft?: (strategy?: StrategyAST) => void;
  /** Called only after the user has reviewed/edited the conditions. */
  onConfirmScan?: (strategy: StrategyAST) => void;
  scanning?: boolean;
}

const confidenceLabel = (confidence: number) => Math.round(Math.max(0, Math.min(1, confidence)) * 100) + '%';
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * The validated, read-only result of looking at a chart image. Conditions are
 * editable and must be confirmed before any scan starts; this is the trust gate
 * between a model interpretation and a stock scan.
 */
export const ChartReadingCard: React.FC<Props> = ({ plan, reading, busy, applied, canApply, onUseAsDraft, onConfirmScan, scanning }) => {
  const [entryRules, setEntryRules] = useState<RuleNode[]>(() => clone(plan.strategy.rules.entry));
  const [indicators, setIndicators] = useState<IndicatorConfig[]>(() => clone(plan.strategy.indicators));

  useEffect(() => {
    setEntryRules(clone(plan.strategy.rules.entry));
    setIndicators(clone(plan.strategy.indicators));
  }, [plan]);

  const editedStrategy: StrategyAST = {
    ...plan.strategy,
    indicators,
    rules: { ...plan.strategy.rules, entry: entryRules },
  };
  const lowConfidence = reading.confidence < 0.6;
  const confidenceTone = lowConfidence
    ? 'border-amber-400/40 bg-amber-400/10 text-amber-200'
    : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200';
  const editable = !!onConfirmScan;

  const updateRule = (index: number, change: Partial<RuleNode>) => {
    setEntryRules(current => current.map((rule, position) => position === index ? { ...rule, ...change } : rule));
  };
  const removeRule = (index: number) => {
    setEntryRules(current => current.filter((_, position) => position !== index));
  };
  const updatePeriod = (indicatorId: string, key: string, value: number) => {
    if (!Number.isFinite(value)) return;
    setIndicators(current => current.map(indicator => indicator.id === indicatorId
      ? { ...indicator, params: { ...indicator.params, [key]: value } }
      : indicator));
  };
  const reset = () => {
    setEntryRules(clone(plan.strategy.rules.entry));
    setIndicators(clone(plan.strategy.indicators));
  };

  return (
    <article aria-label="Chart reading" className="rounded-2xl border border-[#a8c7fa]/25 bg-[#171719] p-4 sm:p-5 space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-[#a8c7fa]/80">Chart image · conditions to confirm</p>
          <h3 className="mt-1 text-lg font-semibold text-neutral-100">{truncateAtWord(plan.strategy.name, 70)}</h3>
        </div>
        <span className={'rounded-full border px-2.5 py-1 text-[11px] font-medium ' + confidenceTone}>
          Confidence {confidenceLabel(reading.confidence)}
        </span>
      </header>

      <p className="text-sm leading-6 text-neutral-200">{reading.summary}</p>

      {lowConfidence && (
        <p role="status" className="rounded-lg border border-amber-400/30 bg-amber-400/5 px-3 py-2 text-xs text-amber-100">
          Low confidence — check these conditions
        </p>
      )}

      <section aria-label="Chart conditions">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-xs font-medium uppercase tracking-wide text-neutral-500">Conditions to test</h4>
          {editable && entryRules.length !== plan.strategy.rules.entry.length && (
            <button type="button" onClick={reset} className="text-xs text-neutral-400 underline hover:text-neutral-200">Reset to AI read</button>
          )}
        </div>
        {entryRules.length > 0 ? (
          <ul className="mt-2 space-y-2">
            {entryRules.map((rule, index) => {
              const indicator = indicators.find(candidate => candidate.id === rule.leftIndicator);
              const periodKey = indicator && indicator.type !== 'RSI_TRENDLINE'
                ? ('period' in indicator.params ? 'period' : undefined)
                : indicator?.type === 'RSI_TRENDLINE' ? 'rsiPeriod' : undefined;
              const label = renderRuleInPlainLanguage(rule, indicators);
              return (
                <li key={(rule.id ?? 'rule') + '-' + index} className="rounded-lg border border-white/8 bg-white/[0.02] px-3 py-2">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm leading-6 text-neutral-300">{label}</p>
                    {editable && (
                      <button
                        type="button"
                        aria-label={'Remove condition ' + (index + 1)}
                        onClick={() => removeRule(index)}
                        className="shrink-0 rounded p-1 text-neutral-500 hover:bg-white/5 hover:text-red-300"
                      >
                        ×
                      </button>
                    )}
                  </div>
                  {editable && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px] text-neutral-400">
                      {rule.rightValue !== undefined && (
                        <label className="flex items-center gap-1.5">
                          Value
                          <input
                            type="number"
                            aria-label={'Condition ' + (index + 1) + ' value'}
                            value={rule.rightValue}
                            onChange={event => updateRule(index, { rightValue: Number(event.target.value) })}
                            className="w-20 rounded border border-white/10 bg-black/20 px-2 py-1 text-neutral-200"
                          />
                        </label>
                      )}
                      {rule.lookback && (
                        <label className="flex items-center gap-1.5">
                          Lookback bars
                          <input
                            type="number"
                            min={1}
                            max={30}
                            aria-label={'Condition ' + (index + 1) + ' lookback'}
                            value={rule.lookback.bars}
                            onChange={event => updateRule(index, { lookback: { ...rule.lookback!, bars: Math.max(1, Math.min(30, Number(event.target.value))) } })}
                            className="w-16 rounded border border-white/10 bg-black/20 px-2 py-1 text-neutral-200"
                          />
                        </label>
                      )}
                      {periodKey && indicator && (
                        <label className="flex items-center gap-1.5">
                          {indicator.type === 'RSI_TRENDLINE' ? 'RSI period' : 'Period'}
                          <input
                            type="number"
                            min={2}
                            max={250}
                            aria-label={'Condition ' + (index + 1) + ' period'}
                            value={indicator.params[periodKey] ?? 14}
                            onChange={event => updatePeriod(indicator.id, periodKey, Number(event.target.value))}
                            className="w-16 rounded border border-white/10 bg-black/20 px-2 py-1 text-neutral-200"
                          />
                        </label>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-amber-200">All conditions were removed. Reset to the AI read before scanning.</p>
        )}
      </section>

      {editable && (
        <div className="rounded-lg border border-sky-300/20 bg-sky-400/[0.04] px-3 py-2">
          <p className="text-xs leading-5 text-neutral-300">
            Edit or remove any condition, then press <span className="font-medium text-sky-200">Scan with these</span>. Nothing scans until you confirm.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={entryRules.length === 0 || !!scanning || !!busy}
              onClick={() => onConfirmScan?.(editedStrategy)}
              className="rounded-lg bg-sky-200 px-3.5 py-2 text-sm font-semibold text-[#101012] hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {scanning ? 'Scanning…' : 'Scan with these'}
            </button>
            <span className="text-[11px] text-neutral-500">{entryRules.length} confirmed {entryRules.length === 1 ? 'condition' : 'conditions'}</span>
          </div>
        </div>
      )}

      <details className="rounded-lg border border-white/8 p-3 text-xs text-neutral-400">
        <summary className="cursor-pointer text-neutral-300">How the later backtest will be reviewed</summary>
        <p className="mt-2 text-amber-200/80">
          This screen supplies entry conditions only. When you prepare a backtest, your current workspace exits, risk, sizing, execution and cost assumptions are applied to the reviewed stock.
        </p>
        <p className="mt-2">{describeBacktestAssumptions(editedStrategy, { asOf: plan.asOf, sourceLabel: 'Chart image screen' }).executionSummary}</p>
        <p>{describeBacktestAssumptions(editedStrategy, { asOf: plan.asOf, sourceLabel: 'Chart image screen' }).capitalSummary}</p>
        <p>{describeBacktestAssumptions(editedStrategy, { asOf: plan.asOf, sourceLabel: 'Chart image screen' }).dataWindow}</p>
      </details>

      <details className="rounded-lg border border-white/8 p-3 text-xs text-neutral-400">
        <summary className="cursor-pointer text-neutral-300">What the AI saw</summary>
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-black/20 p-2">{JSON.stringify(reading.observations, null, 2)}</pre>
      </details>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!onUseAsDraft || !canApply || busy || applied}
          onClick={() => onUseAsDraft?.(editedStrategy)}
          className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-white/5 disabled:opacity-40"
        >
          {applied ? 'Conditions applied to draft' : 'Use as draft'}
        </button>
        <span className="text-[11px] leading-4 text-neutral-500">
          Applies this confirmed screen strategy to the workspace draft only. Review its exits, risk, sizing and costs in the builder. No backtest or broker order runs. To change a condition, edit it above or reply in the chat.
        </span>
      </div>
    </article>
  );
};
