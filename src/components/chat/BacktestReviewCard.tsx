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
    <dt className="text-[11px] uppercase tracking-wide text-neutral-500">{label}</dt>
    <dd className="text-sm text-neutral-300">{children}</dd>
  </div>
);

/** The last gate before execution: frozen assumptions, plain English, explicit consent. */
export const BacktestReviewCard: React.FC<Props> = ({ review, running, error, onApprove, onCancelReview, onCancelRun }) => {
  const assumptions = describeBacktestAssumptions(review.strategy, {
    asOf: review.asOf,
    sourceLabel: review.sourceLabel,
  });
  return (
    <article aria-label="Backtest review" className="rounded-2xl border border-sky-300/25 bg-[#191b1f] p-4 sm:p-5 space-y-4">
      <header>
        <p className="text-[11px] uppercase tracking-wide text-sky-200/70">Review before running</p>
        <h3 className="mt-1 text-lg font-semibold text-neutral-100">Backtest {review.symbol.ticker} with “{review.strategy.name}”</h3>
        <p className="mt-1 text-xs text-neutral-400">{review.sourceLabel} · nothing has been run or applied.</p>
      </header>

      <div className="rounded-lg border border-white/8 bg-black/15 px-3 py-2 text-xs text-neutral-400">
        Data: {assumptions.dataWindow} The stock is {review.symbol.name} ({review.symbol.exchange}).
      </div>

      <dl className="space-y-3">
        <ReviewRow label="Entry rules">
          <ul className="list-disc space-y-1 pl-4">
            {assumptions.entrySummary.map((line, index) => <li key={index}>{line}</li>)}
          </ul>
        </ReviewRow>
        <ReviewRow label="Exit rules">
          <ul className="list-disc space-y-1 pl-4">
            {assumptions.exitSummary.map((line, index) => <li key={index}>{line}</li>)}
          </ul>
        </ReviewRow>
        <ReviewRow label="Risk">
          <ul className="list-disc space-y-1 pl-4">
            {assumptions.riskSummary.map((line, index) => <li key={index}>{line}</li>)}
          </ul>
        </ReviewRow>
        <ReviewRow label="Position sizing">{assumptions.sizingSummary}</ReviewRow>
        <ReviewRow label="Execution">{assumptions.executionSummary}</ReviewRow>
        <ReviewRow label="Initial capital">{assumptions.capitalSummary}</ReviewRow>
        <ReviewRow label="Costs">{assumptions.costSummary}</ReviewRow>
      </dl>

      {(review.assumptions.length > 0 || assumptions.defaults.length > 0) && (
        <details className="rounded-lg border border-white/8 p-3 text-xs text-neutral-400">
          <summary className="cursor-pointer text-neutral-300">Disclosed defaults and screening assumptions</summary>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            {[...review.assumptions, ...assumptions.defaults].map((line, index) => <li key={index}>{line}</li>)}
          </ul>
        </details>
      )}

      <details className="text-xs text-neutral-500">
        <summary className="cursor-pointer">Limitations of this simulation</summary>
        <ul className="mt-2 list-disc space-y-1 pl-4">
          {assumptions.limitations.map((line, index) => <li key={index}>{line}</li>)}
        </ul>
      </details>

      {error && <p role="alert" className="rounded-lg border border-red-400/30 bg-red-400/5 px-3 py-2 text-xs text-red-200">Backtest did not complete: {error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onApprove}
          disabled={running}
          className="rounded-lg bg-sky-200 px-3.5 py-2 text-sm font-semibold text-[#101012] hover:bg-sky-100 disabled:opacity-50"
        >
          {running ? 'Running backtest…' : 'Use these assumptions and run'}
        </button>
        {running && onCancelRun && (
          <button type="button" onClick={onCancelRun} className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-neutral-300 hover:bg-white/5">
            Cancel research
          </button>
        )}
        {!running && (
          <button type="button" onClick={onCancelReview} className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-neutral-300 hover:bg-white/5">
            Cancel review
          </button>
        )}
      </div>
      <p className="text-[11px] text-neutral-500">
        Or reply with “use these assumptions and run” in the composer. Choosing the assumptions alone does not run anything. A negative, conditional or ambiguous reply will not start the backtest.
      </p>
    </article>
  );
};
