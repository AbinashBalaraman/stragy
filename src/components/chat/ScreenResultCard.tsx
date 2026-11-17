import React from 'react';
import type { ScanResult } from '../../client/api';
import type { ResearchScreenPlan } from '../../shared/contracts/research-chat';
import { formatNumber } from '../../client/format';
import { formatDate } from '../../shared/format';
import { describeUnmatchedRule, formatIndicatorValue, getIndicatorLabel, humanObservationFreshness, humanSourceLabel } from '../../shared/strategy/renderPlainLanguage';
import { CardShell, type CardState } from '../common/CardShell';
import { DataTable, type DataColumn } from '../common/DataTable';
import { Disclosure } from '../common/Disclosure';
import { summarizeProviderFailures } from './researchFollowUp';

interface Props {
  plan: ResearchScreenPlan;
  result: ScanResult | null;
  pending: boolean;
  error: string;
  busy?: boolean;
  onPrepareBacktest: (symbolId: number, asOf?: string) => void;
  onCancelScan?: () => void;
  onRetryScan?: () => void;
}

type ScanMatch = ScanResult['matches'][number];
type IndicatorEntry = { id: string; label: string; value: number };

const universeLabel = (universe: string) => universe === 'NIFTY_50'
  ? 'Nifty 50'
  : universe.replace(/_/g, ' ').toLowerCase().replace(/^./, character => character.toUpperCase());

const methodShort = (plan: ResearchScreenPlan) => plan.provider.aiGenerated
  ? 'AI-assisted plan · ' + plan.provider.name
  : plan.method === 'rule_parser'
    ? 'Built-in rule parser · not AI'
    : 'Local planning · not AI';

/** One entry per indicator id *and* label (P1-10: the old rows repeated RSI twice). */
function indicatorEntries(plan: ResearchScreenPlan, match: ScanMatch): IndicatorEntry[] {
  const references = new Set<string>();
  for (const rule of plan.strategy.rules.entry) {
    references.add(rule.leftIndicator);
    if (rule.rightIndicator) references.add(rule.rightIndicator);
  }
  const seen = new Set<string>();
  const entries: IndicatorEntry[] = [];
  for (const indicator of plan.strategy.indicators) {
    const referenced = references.has(indicator.id)
      || [...references].some(reference => reference.startsWith(indicator.id + '_') || reference.startsWith(indicator.id + '.'));
    if (!referenced) continue;
    const value = match.indicatorValues[indicator.id];
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const label = getIndicatorLabel(indicator.id, plan.strategy.indicators);
    if (seen.has(indicator.id) || seen.has(label)) continue;
    seen.add(indicator.id);
    seen.add(label);
    entries.push({ id: indicator.id, label, value });
    if (entries.length === 3) break;
  }
  return entries;
}

const indicatorLine = (entries: IndicatorEntry[]) => entries.length
  ? entries.map(entry => entry.label + ' ' + formatIndicatorValue(entry.label, entry.value)).join(' · ')
  : 'Not reported';

/** Close matches are a lead, never a match: one sentence says so, once. */
const scoreLabel = (match: ScanMatch, total: number) => {
  if (total <= 0) return 'Partial';
  const score = typeof match.score === 'number' && Number.isFinite(match.score)
    ? Math.round(Math.max(0, Math.min(1, match.score)) * total)
    : null;
  return score === null ? 'Partial' : score + '/' + total;
};

/**
 * A read-only screen: one headline, one table of matches, a quiet close-matches
 * section, and provenance behind a disclosure. No nested boxes, one status chip.
 */
export const ScreenResultCard: React.FC<Props> = ({ plan, result, pending, error, busy, onPrepareBacktest, onCancelScan, onRetryScan }) => {
  const observedInMatches = result
    ? result.matches.reduce((latest, match) => match.lastDate > latest ? match.lastDate : latest, '')
    : '';
  const observationDate = result
    ? result.observationDates?.latest ?? (observedInMatches || result.asOf || 'Unavailable')
    : 'Unavailable';
  const sources = result ? Object.keys(result.sourceCoverage) : [];
  const source = sources.length ? sources.map(humanSourceLabel).join(', ') : result?.dataSource ? humanSourceLabel(result.dataSource) : 'Unavailable';
  const failures = result ? summarizeProviderFailures(result.errors) : '';
  const partial = result ? result.succeeded < result.requested || result.failed > 0 : false;
  const demo = result?.mode === 'demo';
  const angelData = sources.includes('ANGEL_SMARTAPI') || /angel/i.test(result?.dataSource ?? '');
  const nearMatches = result ? (result.nearMatches ?? []).filter(near => !result.matches.some(match => match.symbolId === near.symbolId)) : [];
  const totalConditions = plan.strategy.rules.entry.length;

  /** One sentence under the headline. No second count sentence repeats the headline. */
  const summaryLine = !result
    ? ''
    : result.succeeded === 0
      ? 'No successful data coverage. Matches are unknown, not zero.'
      : result.matched === 0
        ? 'No stock meets all conditions today.'
        : (() => {
          const parts: string[] = [];
          if (result.matched > result.matches.length) parts.push('Showing the first ' + result.matches.length + ' of ' + result.matched + ' matches');
          if (nearMatches.length) parts.push(nearMatches.length + ' close ' + (nearMatches.length === 1 ? 'match' : 'matches') + ' below');
          return (parts.length ? parts.join('. ') + '.' : 'Every condition held on the latest session.');
        })();

  const state: CardState = pending ? 'pending' : error && !result ? 'error' : partial ? 'partial' : 'idle';
  const status = pending
    ? 'Scanning'
    : error && !result
      ? 'Could not complete'
      : partial && result
        ? result.succeeded + ' of ' + result.requested + ' evaluated'
        : demo
          ? 'Demo data — not observed'
          : angelData
            ? 'Angel One daily data'
            : result
              ? humanSourceLabel(result.dataSource ?? '') || 'Observed public data'
              : 'Read-only';

  const columns: DataColumn<ScanMatch>[] = [
    {
      key: 'symbol',
      header: 'Symbol',
      sticky: true,
      render: match => (
        <span className="flex min-w-0 flex-col">
          <span className="font-semibold text-[var(--text-1)]">{match.ticker}</span>
          <span className="st-meta block max-w-[9rem] truncate text-[var(--text-3)]">{match.name}</span>
        </span>
      ),
    },
    { key: 'close', header: 'Close', align: 'right', render: match => formatNumber(match.lastClose) },
    { key: 'indicators', header: 'Indicators', render: match => <span className="st-meta text-[var(--text-2)]">{indicatorLine(indicatorEntries(plan, match))}</span> },
    {
      key: 'conditions',
      header: 'Conditions',
      align: 'right',
      render: match => (result?.matches.includes(match)
        ? totalConditions > 0 ? totalConditions + '/' + totalConditions : '—'
        : scoreLabel(match, totalConditions)),
    },
    {
      key: 'action',
      header: 'Action',
      align: 'right',
      render: match => (
        <button
          type="button"
          disabled={busy}
          onClick={() => onPrepareBacktest(match.symbolId, match.lastDate || result?.asOf)}
          aria-label={'Prepare backtest for ' + match.ticker}
          className="st-meta inline-flex min-h-11 items-center rounded-[var(--r-btn)] px-2 text-[var(--text-2)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-1)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:text-[var(--text-disabled)] sm:min-h-8"
        >
          Backtest
        </button>
      ),
    },
  ];

  const rowKey = (match: ScanMatch) => String(match.symbolId);

  const footer = pending && onCancelScan ? (
    <button
      type="button"
      onClick={onCancelScan}
      className="st-meta inline-flex min-h-11 items-center rounded-[var(--r-btn)] px-2.5 text-[var(--text-2)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-1)] sm:min-h-8"
    >
      Cancel scan
    </button>
  ) : (
    <p className="st-meta text-[var(--text-3)]">Read-only screen. Preparing a backtest does not run it.</p>
  );

  return (
    <article aria-label="Research screen">
      <CardShell
        title={plan.strategy.name}
        meta={'Read-only screen · ' + universeLabel(plan.universe) + ' · ' + methodShort(plan)}
        state={state}
        status={status}
        footer={footer}
      >
        {pending && (
          <div className="space-y-2">
            <div className="st-prose space-y-2" aria-hidden="true">
              <div className="h-3 w-[35%] animate-pulse rounded bg-white/[0.06]" />
              <div className="h-3 w-[70%] animate-pulse rounded bg-white/[0.06]" />
              <div className="h-3 w-[55%] animate-pulse rounded bg-white/[0.06]" />
            </div>
            <p className="st-meta text-[var(--text-2)]">Results are pending, not zero matches.</p>
          </div>
        )}

        {error && (
          <div role="alert" className="space-y-2">
            <p className="text-[15px] leading-6 text-[var(--text-1)]">{error.replace(/[.\s]+$/, '')}.</p>
            {!/not a zero-match result/i.test(error) && <p className="st-meta text-[var(--text-2)]">No zero-match conclusion.</p>}
            {onRetryScan && (
              <button
                type="button"
                disabled={pending}
                onClick={onRetryScan}
                className="st-meta inline-flex min-h-11 items-center rounded-[var(--r-btn)] border border-[var(--line-strong)] px-3 text-[var(--text-1)] transition-colors hover:bg-[var(--surface-hover)] disabled:opacity-40 sm:min-h-8"
              >
                Retry scan
              </button>
            )}
          </div>
        )}

        {result && (
          <div aria-label="Screen results" role="group" className="space-y-5">
            <div className="space-y-1">
              <p className="st-stat font-semibold text-[var(--text-1)]">
                {result.succeeded > 0 ? (result.matched + (result.matched === 1 ? ' match' : ' matches')) : 'Matches unknown'}
              </p>
              <p className="text-[15px] leading-6 text-[var(--text-2)]">{summaryLine}</p>
              <p className="st-meta text-[var(--text-3)]">
                {result.succeeded} of {result.requested} evaluated · {result.unavailable} unavailable · {result.failed} failed · {source} · observed through {/^\d{4}-\d{2}-\d{2}$/.test(observationDate) ? formatDate(observationDate) : observationDate}
              </p>
              {partial && (
                <p className="st-meta text-[#f5d383]">
                  Partial coverage: matches among the {result.requested - result.succeeded} unevaluated stocks are unknown.
                </p>
              )}
              {failures && <p className="st-meta text-[var(--text-3)]">Provider failures: {failures}</p>}
            </div>

            {result.matches.length > 0 && (
              <DataTable
                caption={'Screen matches, ' + result.matches.length + (result.matches.length === 1 ? ' row' : ' rows')}
                columns={columns}
                rows={result.matches}
                rowKey={rowKey}
                stickyLastColumn
              />
            )}

            {nearMatches.length > 0 && (
              <section aria-label="Close matches" className="space-y-2">
                <div className="space-y-0.5">
                  <h4 className="text-[15px] font-semibold leading-6 text-[var(--text-1)]">Close matches (missing one condition)</h4>
                  <p className="st-meta text-[var(--text-3)]">Research leads, not matches. The score counts the entry conditions met.</p>
                </div>
                <DataTable
                  caption={'Close matches, ' + nearMatches.length + (nearMatches.length === 1 ? ' row' : ' rows')}
                  columns={columns}
                  rows={nearMatches}
                  rowKey={rowKey}
                  initialLimit={5}
                  stickyLastColumn
                />
                {nearMatches.some(near => near.unmatchedRules?.length) && (
                  <ul className="space-y-1">
                    {nearMatches.filter(near => near.unmatchedRules?.length).slice(0, 3).map(near => (
                      <li key={'missing-' + near.symbolId} className="st-meta text-[var(--text-3)]">
                        <span className="text-[var(--text-2)]">{near.ticker}:</span>{' '}
                        {near.unmatchedRules!.map((missing, index) => {
                          const rule = missing.ruleIndex !== undefined ? plan.strategy.rules.entry[missing.ruleIndex] : undefined;
                          return rule ? describeUnmatchedRule(rule, plan.strategy.indicators, missing.currentActualLeft, missing.currentActualRight) : missing.rule;
                        }).join('; ')}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            <Disclosure summary="Assumptions and provenance">
              <div className="space-y-2">
                {plan.assumptions.length > 0 && (
                  <ul className="list-disc space-y-1 pl-4">
                    {plan.assumptions.map((assumption, index) => <li key={index}>{assumption}</li>)}
                  </ul>
                )}
                <p>Data source: {source} · Data cutoff: {result.asOf ?? 'not supplied'} · Scan completed: {result.scannedAt}</p>
                <p>Observation dates: {result.observationDates ? result.observationDates.earliest + ' to ' + result.observationDates.latest + ' (' + result.observationDates.staleSymbols + ' stale)' : 'Unavailable'}</p>
                <p>Source coverage: {Object.entries(result.sourceCoverage).map(([name, count]) => humanSourceLabel(name) + ': ' + count).join(' · ') || 'Unavailable'}</p>
                {result.scanned !== result.requested && <p>Scanned {result.scanned} of {result.requested} requested instruments.</p>}
                {result.warnings.length > 0 && <ul className="list-disc space-y-1 pl-4">{result.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
                {result.errors.length > 0 && (
                  <Disclosure summary={'Technical provider errors (' + result.errors.length + ')'}>
                    <ul className="max-h-40 space-y-1 overflow-y-auto">
                      {result.errors.map((item, index) => <li key={index}>{item.ticker ?? 'symbol ' + item.symbolId}: {item.code} — {item.message}</li>)}
                    </ul>
                  </Disclosure>
                )}
                <Disclosure summary="Exact screening rules and indicator configuration">
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all font-mono text-[12px] leading-5 text-[var(--text-2)]">{JSON.stringify(plan.strategy, null, 2)}</pre>
                </Disclosure>
              </div>
            </Disclosure>
          </div>
        )}
      </CardShell>
    </article>
  );
};
