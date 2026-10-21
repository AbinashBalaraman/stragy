import type { BacktestOptions } from './engine';
import { MarketDataError, validateDate, type MarketSeries } from '../data/marketSeries';

export interface RequestedBacktestWindow { start?: string; end?: string; asOf?: string; }

/** Validate before loading: all bounds are inclusive dates of completed sessions. */
export function validateRequestWindow(window: RequestedBacktestWindow): void {
  for (const date of [window.start, window.end, window.asOf]) if (date !== undefined) validateDate(date);
  if (window.start && window.end && window.start > window.end)
    throw new MarketDataError('INVALID_RANGE', 'Start exceeds end.');
  if (window.start && window.asOf && window.start > window.asOf)
    throw new MarketDataError('INVALID_RANGE', 'Start exceeds asOf.');
  if (window.end && window.asOf && window.end > window.asOf)
    throw new MarketDataError('INVALID_RANGE', 'End exceeds asOf.');
}

/** The input snapshot retains warmup history; only the indexed window is simulated. */
export function resolveRequestWindow(series: MarketSeries, requested: RequestedBacktestWindow) {
  validateRequestWindow(requested);
  const startIndex = requested.start ? series.bars.findIndex(bar => bar.date >= requested.start!) : 0;
  const endIndex = series.bars.length;
  if (startIndex < 0 || endIndex <= startIndex)
    throw new MarketDataError('OUT_OF_COVERAGE', 'No bars in the requested evaluation window.');
  // Keep exact requested bounds even when weekends/coverage produce identical indexes.
  // Job identity omits provenance, so carry these in options as well as the manifest data.
  const requestWindow = { start: requested.start, end: requested.end, asOf: requested.asOf };
  const options: BacktestOptions & { requestWindow: RequestedBacktestWindow } = { startIndex, endIndex, requestWindow };
  const provenance = {
    ...series.provenance,
    requestedRange: { start: requested.start, end: requested.end ?? requested.asOf },
    requestWindow,
    evaluationRange: { start: series.bars[startIndex].date, end: series.bars[endIndex - 1].date },
    warmupBars: startIndex,
    // actualRange and checksum continue to describe the complete permitted input snapshot.
    warmupPolicy: 'pre-start-indicators-only-flat-at-evaluation-start',
  };
  return { options, provenance };
}
