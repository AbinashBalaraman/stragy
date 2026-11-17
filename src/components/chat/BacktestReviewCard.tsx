import React from 'react';
import type { BacktestReview } from './types';
import { describeBacktestAssumptions } from '../../shared/strategy/backtestReview';
import { CardShell } from '../common/CardShell';
import { Disclosure } from '../common/Disclosure';

interface Props {
  review: BacktestReview;
  running: boolean;
  error: string;
  onApprove: () => void;
  onCancelReview: () => void;
  onCancelRun?: () => void;
}

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="st-meta font-medium text-[var(--text-3)]">{children}</p>
);

const ReviewRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="grid gap-0.5 sm:grid-cols-[8.5rem_1fr] sm:gap-3">
    <dt className="st-meta text-[var(--text-3)]">{label}</dt>
    <dd className="text-[13px] leading-5 text-[var(--text-2)]">{children}</dd>
  </div>
);

const secondaryClass = 'st-meta inline-flex min-h-11 items-center rounded-[var(--r-btn)] border border-[var(--line-strong)] px-3 text-[var(--text-2)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-1)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] sm:min-h-8';

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

  const footer = (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onApprove}
          disabled={running}
          className="st-meta inline-flex min-h-11 items-center rounded-[var(--r-btn)] bg-[var(--accent)] px-3.5 font-semibold text-[var(--accent-ink)] transition-colors hover:bg-[var(--accent-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-9"
        >
          {running ? 'Running backtest…' : error ? 'Retry' : 'Use these assumptions and run'}
        </button>
        {running && onCancelRun ? (
          <button type="button" onClick={onCancelRun} className={secondaryClass}>Cancel research</button>
        ) : !running ? (
          <button type="button" onClick={onCancelReview} className={secondaryClass}>Cancel review</button>
        ) : null}
      </div>
      <p className="st-meta text-[var(--text-3)]">Or type 'run it'.</p>
    </div>
  );

  return (
    <article aria-label="Backtest review">
      <CardShell
        tone="review"
        title={'Backtest ' + review.symbol.ticker + ' with “' + review.strategy.name + '”'}
        meta={review.sourceLabel + ' · nothing has been run or applied.'}
        state={running ? 'pending' : error ? 'error' : 'idle'}
        status={running ? 'Running' : error ? 'Could not complete' : 'Not run yet'}
        footer={footer}
      >
        <p className="text-[13px] leading-5 text-[var(--text-2)]">
          Data: {assumptions.dataWindow} The stock is {review.symbol.name} ({review.symbol.exchange}).
          {review.runOptions?.start && (
            <span className="mt-1 block text-[var(--text-3)]">
              Filled tester inputs: {review.runOptions.start} to {review.runOptions.end ?? 'latest'} · ₹{(review.runOptions.initialCapital ?? 100_000).toLocaleString('en-IN')} initial capital · {review.runOptions.robustness ? 'robustness on' : 'robustness off'}.
            </span>
          )}
        </p>

        <section aria-label="Key assumptions" className="space-y-2 rounded-[var(--r-inner)] bg-[var(--surface-2)] px-3 py-3">
          <SectionLabel>Key assumptions</SectionLabel>
          <dl className="space-y-2">
            {keyAssumptions.map(row => (
              <div key={row.label} className="grid grid-cols-[3.5rem_1fr] gap-2">
                <dt className="st-meta text-[var(--text-3)]">{row.label}</dt>
                <dd className="text-[13px] leading-5 text-[var(--text-2)]">{row.value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <Disclosure summary="Show all assumptions">
          <dl className="space-y-3">
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
            <div className="mt-4 space-y-2">
              <SectionLabel>Disclosed defaults and screening assumptions</SectionLabel>
              <ul className="list-disc space-y-1 pl-4">
                {[...review.assumptions, ...assumptions.defaults].map((line, index) => <li key={index}>{line}</li>)}
              </ul>
            </div>
          )}

          <div className="mt-4 space-y-2">
            <SectionLabel>Limitations of this simulation</SectionLabel>
            <ul className="list-disc space-y-1 pl-4">
              {assumptions.limitations.map((line, index) => <li key={index}>{line}</li>)}
            </ul>
          </div>
        </Disclosure>

        {/* The failure sentence lives in the conversation, once; this card keeps
            the error state and the Retry action next to the assumptions. */}
      </CardShell>
    </article>
  );
};
