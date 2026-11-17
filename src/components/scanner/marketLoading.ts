import type { ResearchJobProgress } from '../../client/api';

/** Only the trailing count is presented; raw server stage names never leak. */
const COUNT_STAGE = /(\d+)\s*(?:of|\/)\s*(\d+)\s*$/i;

/**
 * The scanner's cold-load line. Real job stages only; counts are shown only
 * when the server actually reports them, and queued work says what it waits on.
 */
export function marketLoadingMessage(progress: ResearchJobProgress | null, label: string): string {
  if (progress?.status === 'queued') {
    const behind = progress.queuedBehind;
    if (typeof behind === 'number' && behind > 0) return `Waiting behind ${behind} earlier ${behind === 1 ? 'job' : 'jobs'}…`;
    return 'Waiting for the current scan to finish…';
  }
  const stage = progress?.stage?.trim() ?? '';
  const counts = stage.match(COUNT_STAGE);
  if (counts) return `Loading ${label} prices · ${counts[1]} of ${counts[2]}`;
  const job = progress?.progress;
  if (job && Number.isFinite(job.processed) && Number.isFinite(job.total) && job.total > 0) {
    return `Loading ${label} prices · ${job.processed} of ${job.total}`;
  }
  return `Loading ${label} prices. A cold snapshot usually finishes in 90 seconds (up to 210 seconds for broad universes); later loads are instant.`;
}
