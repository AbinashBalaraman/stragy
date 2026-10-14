/**
 * Bounded parameter sweep that PROPOSES a candidate. It does not promise profitability:
 * metrics are in-sample on the same bars used to choose the winner, only parameters that already
 * exist in the strategy are varied, and no rules, indicators or risk controls are added.
 */
import type { StrategyAST, BacktestResponse } from '../../shared/strategy/types';
import { STRATEGY_TEMPLATES } from '../../shared/strategy/templates';
import { runBacktest } from '../backtest/engine';
import { getSymbolById } from '../data/symbols';
import { strictValidateStrategy, diffStrategies } from './validation';
import { LOCAL_LABEL } from './heuristics';
import type { AgentActionStep, MetricsSnapshot, OptimizationResult } from './types';

export type BacktestFn = (strategy: StrategyAST) => BacktestResponse;

export const OPTIMIZER_LIMITS = { maxTrials: 25, minTradesForConfidence: 10 } as const;
const SCALES = [0.7, 0.85, 1, 1.2, 1.5];

export class StrategyValidationError extends Error {
  readonly code = 'invalid_strategy';
  constructor(public readonly details: string[]) {
    super(`Strategy failed strict validation: ${details.slice(0, 5).join('; ')}`);
    this.name = 'StrategyValidationError';
  }
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const r2 = (n: number) => Math.round(n * 100) / 100;

function snapshot(res: BacktestResponse): MetricsSnapshot {
  const m = res.metrics;
  return { totalPnL: m.netPnl, winRate: m.winRate, profitFactor: m.profitFactor, maxDrawdown: m.maxDrawdownPercent, sharpeRatio: m.sharpeRatio, totalTrades: m.totalTrades };
}

function score(m: MetricsSnapshot): number {
  const f = (n: number | null) => (n !== null && Number.isFinite(n) ? n : 0);
  // Risk-adjusted, penalises drawdown and thin samples. Heuristic ranking only.
  const base = f(m.sharpeRatio) * 2 + Math.min(f(m.profitFactor), 5) * 1.5 + f(m.winRate) / 25 - f(m.maxDrawdown) * 0.1;
  const thin = m.totalTrades < OPTIMIZER_LIMITS.minTradesForConfidence ? -5 : 0;
  return m.totalPnL > 0 ? base + thin : base + thin - 5;
}

function buildCandidates(base: StrategyAST): { label: string; strategy: StrategyAST }[] {
  const out: { label: string; strategy: StrategyAST }[] = [];
  const slScales = SCALES;
  const tpScales = base.risk.takeProfit ? SCALES : [1];
  const trScales = base.risk.trailingStop ? SCALES : [1];
  for (const a of slScales) for (const b of tpScales) for (const c of trScales) {
    if (a === 1 && b === 1 && c === 1) continue;
    const s = clone(base);
    s.risk.stopLoss = { ...s.risk.stopLoss, value: r2(s.risk.stopLoss.value * a) };
    if (s.risk.takeProfit) s.risk.takeProfit = { ...s.risk.takeProfit, value: r2(s.risk.takeProfit.value * b) };
    if (s.risk.trailingStop) s.risk.trailingStop = { ...s.risk.trailingStop, value: r2(s.risk.trailingStop.value * c) };
    out.push({ label: `risk x${a}/${b}/${c}`, strategy: s });
  }
  // One-at-a-time indicator period tweaks, only for indicators already present.
  for (const ind of base.indicators) {
    const p = ind.params.period;
    if (typeof p !== 'number' || !['SMA', 'EMA', 'RSI', 'ATR', 'SUPERTREND', 'BBANDS'].includes(ind.type)) continue;
    for (const k of [0.8, 1.25]) {
      const np = Math.max(2, Math.round(p * k));
      if (np === p) continue;
      const s = clone(base);
      s.indicators = s.indicators.map((i) => (i.id === ind.id ? { ...i, params: { ...i.params, period: np } } : i));
      out.push({ label: `${ind.id}.period ${p}->${np}`, strategy: s });
    }
  }
  return out.slice(0, OPTIMIZER_LIMITS.maxTrials);
}

export function runOptimizationSweep(
  currentStrategy?: StrategyAST,
  userGoal: string = 'Explore safer parameters',
  deps: { backtest?: BacktestFn } = {}
): OptimizationResult {
  const backtest = deps.backtest ?? ((s: StrategyAST) => runBacktest(s, undefined, { robustness: false }));
  const warnings: string[] = [];
  let rawBase: unknown = currentStrategy;
  if (!currentStrategy) {
    rawBase = STRATEGY_TEMPLATES[0].strategy;
    warnings.push(`No strategy was supplied; the sweep used the library template "${STRATEGY_TEMPLATES[0].name}" as its starting point.`);
  }
  const v = strictValidateStrategy(rawBase);
  if (!v.success) throw new StrategyValidationError(v.errors ?? ['invalid strategy']);
  const base = v.data!;
  if (!base.id) base.id = 'opt_base';

  const baseRes = backtest(base);
  const before = snapshot(baseRes);
  let best = base;
  let bestRes = baseRes;
  let bestScore = score(before);
  let bestLabel = 'baseline';
  let trials = 0;

  for (const cand of buildCandidates(base)) {
    const cv = strictValidateStrategy(cand.strategy);
    if (!cv.success) continue;
    trials++;
    try {
      const res = backtest(cv.data!);
      const sc = score(snapshot(res));
      if (sc > bestScore + 1e-9) { best = cv.data!; bestRes = res; bestScore = sc; bestLabel = cand.label; }
    } catch { /* candidate could not be evaluated; skipped */ }
  }

  const after = snapshot(bestRes);
  const noImprovementFound = best === base;
  const changes = diffStrategies(base, best);
  const sym = getSymbolById(base.universe.symbolId);
  if (after.totalTrades < OPTIMIZER_LIMITS.minTradesForConfidence) warnings.push(`Only ${after.totalTrades} trades in the sample; the ranking is statistically weak.`);
  warnings.push('Metrics are in-sample: the same bars chose the winner and scored it, so results are optimistic and may not repeat. Validate on held-out data before relying on it.');
  warnings.push('This is a draft proposal. Nothing was applied. No workspace changes or broker orders were made.');
  if (userGoal && /profit|money|guarantee/i.test(userGoal)) warnings.push('Profitability cannot be promised; the sweep only ranks parameter sets on historical bars.');

  const trace: AgentActionStep[] = [
    { step: 1, type: 'INSPECT', title: 'Baseline backtest', detail: `Ran the supplied strategy on ${sym.ticker}: net P&L ${before.totalPnL.toFixed(0)}, ${before.totalTrades} trades, max drawdown ${before.maxDrawdown.toFixed(1)}%.`, status: before.totalPnL >= 0 ? 'completed' : 'warning' },
    { step: 2, type: 'TRIAL_SWEEP', title: `Evaluated ${trials} parameter variants`, detail: 'Scaled existing stop loss / take profit / trailing stop values and indicator periods. No rules or controls were added.', status: 'completed' },
    { step: 3, type: 'EVALUATE', title: noImprovementFound ? 'No better variant found' : `Best variant: ${bestLabel}`, detail: `Ranked by a risk-adjusted heuristic score (in-sample). Net P&L ${after.totalPnL.toFixed(0)}, max drawdown ${after.maxDrawdown.toFixed(1)}%.`, status: noImprovementFound ? 'warning' : 'completed' },
  ];

  const mutations = changes.length ? changes : ['No parameter changes proposed.'];
  const message = noImprovementFound
    ? 'No parameter variant ranked above the current strategy on this sample. The strategy is unchanged. This is a draft proposal result, not a guarantee.'
    : `Draft proposal: ${changes.length} parameter change(s) ranked highest on in-sample history (${trials} variants tested). Review the diff and warnings; no workspace changes or broker orders were made.`;

  return {
    assistantMessage: message,
    agentTrace: trace,
    trialsCount: trials,
    beforeMetrics: before,
    afterMetrics: after,
    improvements: mutations,
    mutationsApplied: mutations,
    optimizedStrategy: best,
    variations: [{
      id: 'opt_proposal', name: best.name, category: 'Parameter sweep proposal (in-sample)',
      summary: noImprovementFound ? 'Baseline retained.' : `Best of ${trials} variants: ${bestLabel}.`,
      pros: `In-sample net P&L ${after.totalPnL.toFixed(0)}, win rate ${after.winRate === null ? 'N/A' : after.winRate.toFixed(1)}%, Sharpe ${after.sharpeRatio === null ? 'N/A' : after.sharpeRatio.toFixed(2)}`,
      cons: `Max drawdown ${after.maxDrawdown.toFixed(1)}%; may be overfit to this sample`,
      strategy: best,
    }],
    providerUsed: LOCAL_LABEL,
    method: 'parameter_sweep',
    proposalOnly: true,
    inSample: true,
    warnings,
    noImprovementFound,
  };
}
