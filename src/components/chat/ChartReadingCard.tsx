import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { ResearchScreenPlan } from '../../shared/contracts/research-chat';
import type { ChartImageReading } from '../../client/chartAnalysis';
import type { IndicatorConfig, RuleNode, StrategyAST } from '../../shared/strategy/types';
import { renderRuleInPlainLanguage } from '../../shared/strategy/renderPlainLanguage';
import { describeBacktestAssumptions } from '../../shared/strategy/backtestReview';
import { CardShell } from '../common/CardShell';
import { displayCardTitle } from './displayTitle';
import { Disclosure } from '../common/Disclosure';

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
  /** The uploaded image, so the card can show what it is talking about (P1-3). */
  imageUrl?: string;
  imageName?: string;
  /** A reading kept from an earlier request: readable, no longer actionable. */
  past?: boolean;
}

const confidenceLabel = (confidence: number) => Math.round(Math.max(0, Math.min(1, confidence)) * 100) + '%';
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * The card's own reset identity. The parent re-creates the plan object on
 * ordinary re-renders, so identity alone must never wipe an edit in progress:
 * only a different reading (new strategy, universe or as-of date) does.
 */
const planContentKey = (plan: ResearchScreenPlan): string => {
  try {
    return JSON.stringify([plan.strategy, plan.universe ?? null, plan.asOf ?? null]);
  } catch {
    return '';
  }
};

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="st-meta font-medium text-[var(--text-3)]">{children}</p>
);

const inputClass = 'st-tnum h-11 w-20 rounded-[6px] bg-[var(--surface-2)] px-2 text-[13px] text-[var(--text-1)] outline-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] sm:h-8';

/**
 * The validated, read-only result of looking at a chart image. Conditions are
 * editable and must be confirmed before any scan starts; this is the trust gate
 * between a model interpretation and a stock scan.
 */
export const ChartReadingCard: React.FC<Props> = ({ plan, reading, busy, applied, canApply, onUseAsDraft, onConfirmScan, scanning, imageUrl, imageName, past = false }) => {
  const [entryRules, setEntryRules] = useState<RuleNode[]>(() => clone(plan.strategy.rules.entry));
  const [indicators, setIndicators] = useState<IndicatorConfig[]>(() => clone(plan.strategy.indicators));
  const [expanded, setExpanded] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  /** The reading the local edits belong to; changed only by new plan content. */
  const editsForPlan = useRef(planContentKey(plan));

  useEffect(() => {
    const key = planContentKey(plan);
    if (key === editsForPlan.current) return;
    editsForPlan.current = key;
    setEntryRules(clone(plan.strategy.rules.entry));
    setIndicators(clone(plan.strategy.indicators));
  }, [plan]);

  const editedStrategy: StrategyAST = {
    ...plan.strategy,
    indicators,
    rules: { ...plan.strategy.rules, entry: entryRules },
  };
  const lowConfidence = reading.confidence < 0.6;
  /**
   * The server says whether it could check the reading against the charted
   * stock. When it could not, the card says what actually happens next instead
   * of repeating that bare sentence.
   */
  const selfCheckNote = !reading.selfCheck
    ? ''
    : reading.selfCheck.status === 'checked'
      ? reading.selfCheck.line
      : reading.selfCheck.status === 'unavailable'
        ? "The charted stock's data is unavailable, so the scan runs on the Nifty 50. Pick a match to backtest."
        : "The chart doesn't name a stock, so the scan runs on the Nifty 50. Pick a match to backtest.";
  const editable = !!onConfirmScan && !past;
  const edited = JSON.stringify(entryRules) !== JSON.stringify(plan.strategy.rules.entry)
    || JSON.stringify(indicators) !== JSON.stringify(plan.strategy.indicators);

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

  const footer = (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {editable && (
          <button
            type="button"
            disabled={entryRules.length === 0 || !!scanning || !!busy}
            onClick={() => onConfirmScan?.(editedStrategy)}
            className="st-meta inline-flex min-h-11 items-center rounded-[var(--r-btn)] bg-[var(--accent)] px-3.5 font-semibold text-[var(--accent-ink)] transition-colors hover:bg-[var(--accent-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-9"
          >
            {scanning ? 'Scanning…' : 'Scan with these'}
          </button>
        )}
        {!past && (
          <button
            type="button"
            disabled={!onUseAsDraft || !canApply || busy || applied}
            onClick={() => onUseAsDraft?.(editedStrategy)}
            className="st-meta inline-flex min-h-11 items-center rounded-[var(--r-btn)] border border-[var(--line-strong)] px-3 text-[var(--text-2)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-1)] disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-8"
          >
            {applied ? 'Applied to draft' : 'Use as draft'}
          </button>
        )}
        <span className="st-meta text-[var(--text-3)]">{entryRules.length} confirmed {entryRules.length === 1 ? 'condition' : 'conditions'}</span>
      </div>
      <p className="st-meta text-[var(--text-3)]">{past ? 'Kept from earlier in this conversation. Nothing runs from this card.' : 'Nothing scans until you confirm. No backtest or broker order runs.'}</p>
    </div>
  );

  return (
    <article aria-label="Chart reading">
      <CardShell
        tone="review"
        title={displayCardTitle(plan.strategy.name)}
        meta={past ? 'Read from your chart image · earlier in this conversation' : 'Read from your chart image · confirm the conditions'}
        state={lowConfidence ? 'partial' : 'idle'}
        status={'Confidence ' + confidenceLabel(reading.confidence)}
        footer={footer}
      >
        {imageUrl && (
          <figure className="flex items-start gap-3">
            <button
              type="button"
              onClick={() => setExpanded(value => !value)}
              aria-expanded={expanded}
              aria-label={expanded ? 'Hide chart image' : 'View chart image'}
              className="shrink-0 overflow-hidden rounded-[var(--r-inner)] bg-[var(--surface-2)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            >
              <img
                src={imageUrl}
                alt={'Your uploaded chart' + (imageName ? ': ' + imageName : '')}
                className={expanded ? 'max-h-[320px] w-auto max-w-full object-contain' : 'h-16 w-28 object-cover'}
              />
            </button>
            <figcaption className="st-meta min-w-0 flex-1 text-[var(--text-3)]">
              <span className="block truncate text-[var(--text-2)]">{imageName ?? 'Chart image'}</span>
              <span className="mt-0.5 block">{expanded ? 'Your image, full size.' : 'Tap the thumbnail to see the image the reading came from.'}</span>
            </figcaption>
          </figure>
        )}

        <div className="space-y-1">
          <p className={'st-prose text-[var(--text-1)]' + (summaryOpen ? '' : ' line-clamp-2')}>{reading.summary}</p>
          {reading.summary.trim().length > 110 && (
            <button
              type="button"
              aria-expanded={summaryOpen}
              onClick={() => setSummaryOpen(value => !value)}
              className="st-meta inline-flex min-h-11 items-center text-[var(--text-3)] underline decoration-[var(--line-strong)] underline-offset-2 transition-colors hover:text-[var(--text-1)] sm:min-h-8"
            >
              {summaryOpen ? 'Less' : 'More'}
            </button>
          )}
        </div>

        {lowConfidence && (
          <p className="rounded-[var(--r-inner)] bg-[var(--surface-2)] px-3 py-2 text-[13px] leading-5 text-[#f5d383]">
            Low confidence — check these conditions
          </p>
        )}

        <section aria-label="Chart conditions" className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <SectionLabel>Conditions to test</SectionLabel>
            {editable && edited && (
              <button type="button" onClick={reset} className="st-meta inline-flex min-h-11 items-center text-[var(--text-3)] underline decoration-[var(--line-strong)] underline-offset-2 transition-colors hover:text-[var(--text-1)] sm:min-h-8">
                Reset to AI read
              </button>
            )}
          </div>
          {reading.selfCheck && (
            <p className="st-meta text-[var(--text-3)]">{selfCheckNote}</p>
          )}
          {entryRules.length > 0 ? (
            <ol className="divide-y divide-[var(--line)]">
              {entryRules.map((rule, index) => {
                const indicator = indicators.find(candidate => candidate.id === rule.leftIndicator);
                const periodKey = indicator && indicator.type !== 'RSI_TRENDLINE'
                  ? ('period' in indicator.params ? 'period' : undefined)
                  : indicator?.type === 'RSI_TRENDLINE' ? 'rsiPeriod' : undefined;
                const label = renderRuleInPlainLanguage(rule, indicators);
                return (
                  <li key={(rule.id ?? 'rule') + '-' + index} className="py-2.5 first:pt-1 last:pb-0">
                    <div className="flex items-start gap-2">
                      <span aria-hidden="true" className="st-meta st-tnum mt-0.5 w-4 shrink-0 text-right text-[var(--text-3)]">{index + 1}</span>
                      <p className="min-w-0 flex-1 text-[13px] leading-5 text-[var(--text-1)]">{label}</p>
                      {editable && (
                        <button
                          type="button"
                          aria-label={'Remove condition ' + (index + 1)}
                          onClick={() => removeRule(index)}
                          className="-my-1 inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-[var(--r-btn)] text-[var(--text-3)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--down)] sm:min-h-8 sm:min-w-8"
                        >
                          <X size={14} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                    {editable && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-2 pl-6 text-[12px] text-[var(--text-3)]">
                        {rule.rightValue !== undefined && (
                          <label className="flex items-center gap-1.5">
                            Value
                            <input
                              type="number"
                              aria-label={'Condition ' + (index + 1) + ' value'}
                              value={rule.rightValue}
                              onChange={event => updateRule(index, { rightValue: Number(event.target.value) })}
                              className={inputClass}
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
                              className={inputClass + ' w-16'}
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
                              className={inputClass + ' w-16'}
                            />
                          </label>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="text-[13px] leading-5 text-[#f5d383]">All conditions were removed. Reset to the AI read before scanning.</p>
          )}
        </section>

        <Disclosure summary="How the later backtest will be reviewed">
          <div className="space-y-2">
            <p>This screen supplies entry conditions only. When you prepare a backtest, your current workspace exits, risk, sizing, execution and cost assumptions are applied to the reviewed stock.</p>
            <p>{describeBacktestAssumptions(editedStrategy, { asOf: plan.asOf, sourceLabel: 'Chart image screen' }).executionSummary}</p>
            <p>{describeBacktestAssumptions(editedStrategy, { asOf: plan.asOf, sourceLabel: 'Chart image screen' }).capitalSummary}</p>
            <p>{describeBacktestAssumptions(editedStrategy, { asOf: plan.asOf, sourceLabel: 'Chart image screen' }).dataWindow}</p>
          </div>
        </Disclosure>

        <Disclosure summary="What the AI saw">
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all font-mono text-[12px] leading-5 text-[var(--text-2)]">{JSON.stringify(reading.observations, null, 2)}</pre>
        </Disclosure>
      </CardShell>
    </article>
  );
};
