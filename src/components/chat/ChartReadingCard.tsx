import React from 'react';
import type { ResearchScreenPlan } from '../../shared/contracts/research-chat';
import type { ChartImageReading } from '../../client/chartAnalysis';
import { renderRuleInPlainLanguage } from '../../shared/strategy/renderPlainLanguage';
import { describeBacktestAssumptions } from '../../shared/strategy/backtestReview';

interface Props {
  plan: ResearchScreenPlan;
  reading: ChartImageReading;
  busy?: boolean;
  applied?: boolean;
  canApply?: boolean;
  onUseAsDraft?: () => void;
}

const confidenceLabel = (confidence: number) => Math.round(Math.max(0, Math.min(1, confidence)) * 100) + '%';

/**
 * The validated, read-only result of looking at a chart image. It shows the
 * conditions before any scan and keeps applying and running as separate actions.
 */
export const ChartReadingCard: React.FC<Props> = ({ plan, reading, busy, applied, canApply, onUseAsDraft }) => {
  const lowConfidence = reading.confidence < 0.6;
  const conditions = plan.strategy.rules.entry.map(rule => renderRuleInPlainLanguage(rule, plan.strategy.indicators));
  const assumptions = describeBacktestAssumptions(plan.strategy, { asOf: plan.asOf, sourceLabel: 'Chart image screen' });
  const confidenceTone = lowConfidence
    ? 'border-amber-400/40 bg-amber-400/10 text-amber-200'
    : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200';

  return (
    <article aria-label="Chart reading" className="rounded-2xl border border-[#a8c7fa]/25 bg-[#171719] p-4 sm:p-5 space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-[#a8c7fa]/80">Chart image · read-only</p>
          <h3 className="mt-1 text-lg font-semibold text-neutral-100">{plan.strategy.name}</h3>
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
        <h4 className="text-xs font-medium uppercase tracking-wide text-neutral-500">Conditions to test</h4>
        {conditions.length > 0 ? (
          <ul className="mt-2 list-disc space-y-1 pl-4 text-sm leading-6 text-neutral-300">
            {conditions.map((condition, index) => <li key={index}>{condition}</li>)}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-neutral-400">No entry conditions were validated from this image.</p>
        )}
      </section>

      <details className="rounded-lg border border-white/8 p-3 text-xs text-neutral-400">
        <summary className="cursor-pointer text-neutral-300">How the later backtest will be reviewed</summary>
        <p className="mt-2 text-amber-200/80">
          This screen supplies entry conditions only. When you prepare a backtest, your current workspace exits, risk, sizing, execution and cost assumptions are applied to the reviewed stock.
        </p>
        <p className="mt-2">{assumptions.executionSummary}</p>
        <p>{assumptions.capitalSummary}</p>
        <p>{assumptions.dataWindow}</p>
        {assumptions.limitations.length > 0 && (
          <ul className="mt-2 list-disc space-y-1 pl-4">
            {assumptions.limitations.map(line => <li key={line}>{line}</li>)}
          </ul>
        )}
      </details>

      <details className="rounded-lg border border-white/8 p-3 text-xs text-neutral-400">
        <summary className="cursor-pointer text-neutral-300">What the AI saw</summary>
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-black/20 p-2">{JSON.stringify(reading.observations, null, 2)}</pre>
      </details>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!onUseAsDraft || !canApply || busy || applied}
          onClick={onUseAsDraft}
          className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-white/5 disabled:opacity-40"
        >
          {applied ? 'Conditions applied to draft' : 'Use as draft'}
        </button>
        <span className="text-[11px] leading-4 text-neutral-500">
          Applies this screen strategy to the workspace draft only. Review its exits, risk, sizing and costs in the builder. No backtest or broker order runs. To change a condition, reply in the chat.
        </span>
      </div>
    </article>
  );
};
