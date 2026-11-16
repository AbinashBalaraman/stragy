import React from 'react';
import type { BacktestReview } from './types';
import { describeBacktestAssumptions } from '../../shared/strategy/backtestReview';

interface Props {
  review: BacktestReview;
  running: boolean;
  error: string;
  onApprove: () => void;
  onCancelReview: () => void;
  onCancelRun?: () => void;
}

const ReviewRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="grid gap-0.5 sm:grid-cols-[8.5rem_1fr] sm:gap-3">
    <dt className="text-xs uppercase tracking-wide text-neutral-400">{label}</dt>
    <dd className="text-sm text-neutral-300">{children}</dd>
  </div>
);

/** The last gate before execution: frozen assumptions, plain English, explicit consent. */
export const BacktestReviewCard: React.FC<Props> = ({ review, running, error, onApprove, onCancelReview, onCancelRun }) => {
  const assumptions = describeBacktestAssumptions(review.strategy, {
    asOf: review.asOf,
    sourceLabel: review.sourceLabel,
  });
  const keyAssumptions = [
    { label: 'Entry', value: assumptions.entrySummary[0] ?? 'No entry rule is configured.' },
    { label: 'Exit', value: assumptions.exitSummary[0] ?? 'No exit rule is configured.' },
    { label: 'Risk', value: assumptions.riskSummary[0] ?? 'No stop, target or trailing stop is configured.' },
  ];
  return (
    <article aria-label="Backtest review" className="rounded-2xl border border-sky-300/25 bg-[#191b1f] p-4 sm:p-5 space-y-4">
      <header>
        <p className="text-xs uppercase tracking-wide text-sky-200/70">Review before running</p>
        <h3 className="mt-1 text-base font-semibold text-neutral-100 sm:text-lg">Backtest {review.symbol.ticker} with “{review.strategy.name}”</h3>
        <p className="mt-1 text-xs text-neutral-400">{review.sourceLabel} · nothing has been run or applied.</p>
      </header>

      <div className="rounded-lg border border-white/8 bg-black/15 px-3 py-2 text-xs text-neutral-400">
        Data: {assumptions.dataWindow} The stock is {review.symbol.name} ({review.symbol.exchange}).
        {review.runOptions?.start && (
          <span className="mt-1 block">
            Filled tester inputs: {review.runOptions.start} to {review.runOptions.end ?? 'latest'} · ₹{(review.runOptions.initialCapital ?? 100_000).toLocaleString('en-IN')} initial capital · {review.runOptions.robustness ? 'robustness on' : 'robustness off'}.
          </span>
        )}
      </div>

      <section aria-label="Key assumptions" className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-3">
        <p className="text-xs uppercase tracking-wide text-neutral-400">Key assumptions</p>
        <dl className="mt-2 space-y-2">
          {keyAssumptions.map(row => (
            <div key={row.label} className="grid grid-cols-[3.5rem_1fr] gap-2">
              <dt className="text-xs uppercase tracking-wide text-neutral-400">{row.label}</dt>
              <dd className="text-sm leading-5 text-neutral-300">{row.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <details className="rounded-lg border border-white/8 p-3 text-xs text-neutral-400">
        <summary className="cursor-pointer text-neutral-200">Show all assumptions</summary>
        <dl className="mt-3 space-y-3">
          <ReviewRow label="Entry rules">
            <ul className="list-disc space-y-1 pl-4">
              {assumptions.entrySummary.slice(1).map((line, index) => <li key={index}>{line}</li>)}
            </ul>
          </ReviewRow>
          <ReviewRow label="Exit rules">
            <ul className="list-disc space-y-1 pl-4">
              {assumptions.exitSummary.slice(1).map((line, index) => <li key={index}>{line}</li>)}
            </ul>
          </ReviewRow>
          <ReviewRow label="Risk">
            <ul className="list-disc space-y-1 pl-4">
              {assumptions.riskSummary.slice(1).map((line, index) => <li key={index}>{line}</li>)}
            </ul>
          </ReviewRow>
          <ReviewRow label="Position sizing">{assumptions.sizingSummary}</ReviewRow>
          <ReviewRow label="Execution">{assumptions.executionSummary}</ReviewRow>
          <ReviewRow label="Initial capital">{assumptions.capitalSummary}</ReviewRow>
          <ReviewRow label="Costs">{assumptions.costSummary}</ReviewRow>
        </dl>

        {(review.assumptions.length > 0 || assumptions.defaults.length > 0) && (
          <div className="mt-4 border-t border-white/8 pt-3">
            <p className="text-neutral-300">Disclosed defaults and screening assumptions</p>
            <ul className="mt-2 list-disc space-y-1 pl-4">
              {[...review.assumptions, ...assumptions.defaults].map((line, index) => <li key={index}>{line}</li>)}
            </ul>
          </div>
        )}

        <div className="mt-4 border-t border-white/8 pt-3">
          <p className="text-neutral-300">Limitations of this simulation</p>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            {assumptions.limitations.map((line, index) => <li key={index}>{line}</li>)}
          </ul>
        </div>
      </details>

      {error && <p role="alert" className="rounded-lg border border-red-400/30 bg-red-400/5 px-3 py-2 text-xs text-red-200">Backtest did not complete: {error}</p>}

      <footer className="sticky bottom-0 z-10 -mx-4 -mb-4 border-t border-white/10 bg-[#191b1f]/95 px-4 py-3 backdrop-blur sm:-mx-5 sm:-mb-5 sm:px-5">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onApprove}
            disabled={running}
            className="min-h-9 rounded-lg bg-sky-200 px-3.5 py-2 text-sm font-semibold text-[#101012] hover:bg-sky-100 disabled:opacity-50"
          >
            {running ? 'Running backtest…' : 'Use these assumptions and run'}
          </button>
          {running && onCancelRun && (
            <button type="button" onClick={onCancelRun} className="min-h-8 rounded-lg border border-white/15 px-3 py-1.5 text-xs text-neutral-300 hover:bg-white/5">
              Cancel research
            </button>
          )}
          {!running && (
            <button type="button" onClick={onCancelReview} className="min-h-8 rounded-lg border border-white/15 px-3 py-1.5 text-xs text-neutral-300 hover:bg-white/5">
              Cancel review
            </button>
          )}
        </div>
        <p className="mt-2 hidden text-xs text-neutral-400 sm:block">
          Or reply with “use these assumptions and run”. Choosing the assumptions alone does not run anything; a negative, conditional or ambiguous reply will not start the backtest.
        </p>
      </footer>
    </article>
  );
};
