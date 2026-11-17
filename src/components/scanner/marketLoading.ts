import type { ResearchJobProgress } from '../../client/api';

/** Only count stages we deliberately present; raw server stage names never leak. */
const COUNT_STAGE = /^(?:scan|prices?|loading)?\s*(\d+)\s*(?:of|\/)\s*(\d+)$/i;

/**
 * The scanner's cold-load line. Real job stages only; counts are shown only
 * when the server actually reports them, and queued work says what it waits on.
 */
export function marketLoadingMessage(progress: ResearchJobProgress | null, label: string): string {
  if (progress?.status === 'queued') return 'Waiting for the current scan to finish…';
  const stage = progress?.stage?.trim() ?? '';
  const counts = stage.match(COUNT_STAGE);
  if (counts) return `Loading ${label} prices · ${counts[1]} of ${counts[2]}`;
  return `Loading ${label} prices. The first load takes up to 4 minutes; later loads are instant.`;
}
