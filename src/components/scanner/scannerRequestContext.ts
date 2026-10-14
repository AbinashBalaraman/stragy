import type { StrategyAST } from '../../shared/strategy/types';

export function scannerContextKey(strategy: StrategyAST, universe: string, date: string): string {
  return JSON.stringify([universe, date, strategy]);
}
export interface ScannerTicket { context: string; revision: number; signal: AbortSignal; }
export class ScannerRequestOwner {
  private revision = 0;
  private controller: AbortController | null = null;
  begin(context: string): ScannerTicket {
    this.cancel(); this.controller = new AbortController();
    return { context, revision: this.revision, signal: this.controller.signal };
  }
  owns(ticket: ScannerTicket, context: string): boolean {
    return ticket.revision === this.revision && ticket.context === context && !ticket.signal.aborted;
  }
  cancel(): void { this.revision++; this.controller?.abort(); this.controller = null; }
}
function dateValue(value: unknown): string | undefined {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}
/** Calendar labels, scannedAt and fetchedAt are not price cutoffs. */
export function actualDataCutoff(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const data = value as Record<string, unknown>;
  const rows = [data.trends, data.matches].flatMap(rows => Array.isArray(rows) ? rows : []);
  const dates = rows.flatMap(row => {
    if (!row || typeof row !== 'object') return [];
    const r = row as Record<string, unknown>;
    return [dateValue(r.lastDate), dateValue(r.date), actualDataCutoff(r.provenance)].filter((d): d is string => !!d);
  });
  if (dates.length) return dates.sort().at(-1);
  if (Array.isArray(data.provenance)) {
    const observed = data.provenance.map(actualDataCutoff).filter((d): d is string => !!d);
    if (observed.length) return observed.sort().at(-1);
  } else if (data.provenance && typeof data.provenance === 'object') {
    const observed = actualDataCutoff(data.provenance); if (observed) return observed;
  }
  const range = data.actualRange as { end?: unknown } | undefined;
  return dateValue(range?.end) ?? dateValue(data.asOfDate) ?? dateValue(data.asOf);
}
export function scannerBacktestOptions(selectedDate: string, observedDate?: string): { asOf: string; end: string } {
  const cutoff = dateValue(observedDate) ?? dateValue(selectedDate);
  if (!cutoff) throw new Error('Data cutoff unavailable. Reload the scanner before starting a backtest.');
  const asOf = selectedDate && selectedDate < cutoff ? selectedDate : cutoff;
  return { asOf, end: asOf };
}
