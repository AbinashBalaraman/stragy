import type { ResearchJobProgress } from '../../client/api';

const UNINFORMATIVE_STAGES = new Set(['market', 'simulation', 'running', 'waiting', 'queued']);

/**
 * The scanner's cold-load line. Real job stages only; counts are shown only
 * when the server actually reports them, and queued work says what it waits on.
 */
export function marketLoadingMessage(progress: ResearchJobProgress | null, label: string): string {
  if (progress?.status === 'queued') return 'Waiting for the current scan to finish…';
  const stage = progress?.stage?.trim() ?? '';
  const counts = stage.match(/(\d+)\s*(?:of|\/)\s*(\d+)/i);
  if (counts) return `Loading ${label} prices · ${counts[1]} of ${counts[2]}`;
  if (stage && !UNINFORMATIVE_STAGES.has(stage.toLowerCase())) {
    return stage.charAt(0).toUpperCase() + stage.slice(1);
  }
  return `Loading ${label} prices. The first load takes up to 3 minutes; later loads are instant.`;
}
