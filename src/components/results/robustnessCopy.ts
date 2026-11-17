import type { TrainTestSplitResult } from '../../shared/strategy/types';
import { formatPercent } from '../../shared/format';

/** Below this, a fitted/test comparison is not a useful sample. */
export const MIN_SPLIT_TRADES = 5;

const KNOWN_REASONS: Record<string, string> = {
  NO_TRADES: 'This run has no trades to reshuffle.',
  INSUFFICIENT_OR_INVALID_RETURNS: 'This run does not have enough valid daily returns to reshuffle.',
  INSUFFICIENT_WINDOW: 'The fitted or test window is too short to compare. Run a longer backtest.',
};

/** Turn an internal robustness reason code into one plain sentence. */
export function plainRobustnessReason(reason: string | null | undefined): string {
  const value = (reason ?? '').trim();
  if (!value) return 'This check is unavailable for this run.';
  if (KNOWN_REASONS[value]) return KNOWN_REASONS[value];
  if (/^[A-Z0-9_]+$/.test(value)) {
    const words = value.replace(/_/g, ' ').toLowerCase();
    return words.charAt(0).toUpperCase() + words.slice(1) + '.';
  }
  return value;
}

/** One sentence for the train/test status, never a risk pill. */
export function trainTestSentence(split: TrainTestSplitResult): string {
  if (split.status !== 'available') return plainRobustnessReason(split.reason);
  if (split.trainMetrics.tradesCount < MIN_SPLIT_TRADES || split.testMetrics.tradesCount < MIN_SPLIT_TRADES) {
    return `Not enough trades in one window to judge this. Each window needs at least ${MIN_SPLIT_TRADES} trades; run a longer window.`;
  }
  if (split.overfittingRisk === 'LOW') return 'The test window looks stable compared with the fitted window.';
  if (split.overfittingRisk === 'MODERATE') return 'The test window is mixed compared with the fitted window.';
  if (split.overfittingRisk === 'HIGH') return 'The test window is weaker than the fitted window.';
  if (/parameter-selection history/i.test(split.reason ?? '')) {
    return 'Overfitting is not scored: this is a fixed strategy, and there is no verified record of how its rules were chosen. Compare the fitted and test windows below.';
  }
  return 'The fitted and test windows are shown below; overfitting is not scored for this run.';
}

/** Plain percentage change from the fitted window to the test window. */
export function decaySentence(ratio: number | null | undefined): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) {
    return 'The fitted window return was zero or negative, so a percentage change would not be meaningful.';
  }
  const change = Math.abs(1 - ratio) * 100;
  if (change < 0.5) return 'Return was about the same in the test window.';
  return `Return was ${formatPercent(change, { decimals: 0 })} ${ratio < 1 ? 'lower' : 'higher'} in the test window.`;
}
