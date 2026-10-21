import type { BacktestResponse, OHLCVBar, StrategyAST, RobustnessSuite, MonteCarloResult, TrainTestSplitResult, SensitivityHeatmapResult } from '../../shared/strategy/types';
import type { BacktestOptions } from './engine';
import { equityReturns } from './metrics';
type Simulator = (strategy: StrategyAST, bars: OHLCVBar[], options?: BacktestOptions) => BacktestResponse;
export function seededRandom(seed: number): () => number {
  let value = seed >>> 0 || 0x9e3779b9;
  return () => { value ^= value << 13; value ^= value >>> 17; value ^= value << 5; return (value >>> 0) / 4294967296; };
}
export function quantile(values: number[], p: number): number {
  if (!values.length || !Number.isFinite(p) || p < 0 || p > 1) throw new Error('INVALID_QUANTILE');
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}
function emptyMonte(reason: string): MonteCarloResult {
  return { status: 'unavailable', reason, method: 'iid-daily-net-equity-bootstrap', simulationsCount: 0, percentileCurves: { p10: [], p25: [], p50: [], p75: [], p90: [] }, dates: [], medianMaxDrawdown: null, probDrawdownOver15: null, probDrawdownOver25: null, p10TerminalEquity: null, p50TerminalEquity: null, p90TerminalEquity: null };
}
const emptyMetrics = () => ({ cagr: null, sharpe: null, maxDrawdown: 0, winRate: null, profitFactor: null, tradesCount: 0 });
function emptySplit(reason: string): TrainTestSplitResult { return { status: 'unavailable', reason, method: 'independent-chronological-holdout', trainMetrics: emptyMetrics(), testMetrics: emptyMetrics(), cagrDecayRatio: null, sharpeDecayRatio: null, overfittingRisk: 'UNAVAILABLE', splitDate: '' }; }
export function unavailableRobustness(reason: string): RobustnessSuite { return { monteCarlo: emptyMonte(reason), trainTestSplit: emptySplit(reason), sensitivityHeatmap: { status: 'unavailable', reason, param1Name: '', param2Name: '', param1Values: [], param2Values: [], matrix: [] } }; }
export function bootstrapReturns(returns: number[], initialCapital: number, simulations = 100, seed = 42, random?: () => number): MonteCarloResult {
  if (!Number.isInteger(simulations) || simulations < 1 || simulations > 500 || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff || !Number.isFinite(initialCapital) || initialCapital <= 0) throw new Error('INVALID_BOOTSTRAP_OPTIONS');
  if (!returns.length || !returns.every(r => Number.isFinite(r) && r >= -1)) return emptyMonte('INSUFFICIENT_OR_INVALID_RETURNS');
  const rng = random ?? seededRandom(seed), horizon = returns.length, paths: number[][] = [], drawdowns: number[] = [];
  for (let s = 0; s < simulations; s++) {
    let equity = initialCapital, peak = initialCapital, dd = 0; const path = [equity];
    for (let i = 0; i < horizon; i++) { const sample = rng(); if (!(sample >= 0 && sample < 1)) throw new Error('INVALID_RANDOM_SAMPLE'); equity *= 1 + returns[Math.floor(sample * returns.length)]; peak = Math.max(peak, equity); dd = Math.max(dd, (peak - equity) / peak * 100); path.push(equity); }
    paths.push(path); drawdowns.push(dd);
  }
  const curve = (p: number) => Array.from({ length: horizon + 1 }, (_, i) => quantile(paths.map(path => path[i]), p));
  const terminal = paths.map(path => path.at(-1)!);
  return { status: 'available', method: 'iid-daily-net-equity-bootstrap/xorshift32-v1/nearest-rank', seed, simulationsCount: simulations, percentileCurves: { p10: curve(.1), p25: curve(.25), p50: curve(.5), p75: curve(.75), p90: curve(.9) }, dates: Array.from({ length: horizon + 1 }, (_, i) => 'Step ' + i), medianMaxDrawdown: quantile(drawdowns, .5), probDrawdownOver15: drawdowns.filter(d => d >= 15).length / simulations * 100, probDrawdownOver25: drawdowns.filter(d => d >= 25).length / simulations * 100, p10TerminalEquity: quantile(terminal, .1), p50TerminalEquity: quantile(terminal, .5), p90TerminalEquity: quantile(terminal, .9) };
}
export function buildRobustnessSuite(base: BacktestResponse, bars: OHLCVBar[], options: BacktestOptions, simulate: Simulator): RobustnessSuite {
  const seed = options.seed ?? 42;
  const monteCarlo = base.trades.length ? bootstrapReturns(equityReturns(base.equityCurve), base.metrics.initialCapital, options.simulations ?? 100, seed) : emptyMonte('NO_TRADES');
  const start = options.startIndex ?? 0, end = options.endIndex ?? bars.length, split = start + Math.floor((end - start) * .7);
  let trainTestSplit = emptySplit('INSUFFICIENT_WINDOW');
  if (split - start >= 2 && end - split >= 2) {
    try {
      const train = simulate(base.strategy, bars, { ...options, robustness: false, startIndex: start, endIndex: split, liquidateAtEnd: true });
      const test = simulate(base.strategy, bars, { ...options, robustness: false, startIndex: split, endIndex: end, liquidateAtEnd: true });
      const pack = (r: BacktestResponse) => ({ cagr: r.metrics.cagr, sharpe: r.metrics.sharpeRatio, maxDrawdown: r.metrics.maxDrawdownPercent, winRate: r.metrics.winRate, profitFactor: r.metrics.profitFactor, tradesCount: r.trades.length });
      const ratio = (a: number | null, b: number | null) => a !== null && b !== null && a > 0 && b >= 0 ? b / a : null;
      trainTestSplit = { status: 'available', reason: 'Fixed strategy holdout; no verified parameter-selection history, so overfitting risk is not classified.', method: 'independent-chronological-holdout', trainMetrics: pack(train), testMetrics: pack(test), cagrDecayRatio: ratio(train.metrics.cagr, test.metrics.cagr), sharpeDecayRatio: ratio(train.metrics.sharpeRatio, test.metrics.sharpeRatio), overfittingRisk: 'UNAVAILABLE', splitDate: bars[split].date };
    } catch (e) { trainTestSplit = emptySplit('Window failed: ' + (e as Error).message); }
  }
  const stop = base.strategy.risk.stopLoss, target = base.strategy.risk.takeProfit;
  const unique = (xs: number[]) => [...new Set(xs)];
  const p1 = unique([stop.value * .8, stop.value, stop.value * 1.2].filter(v => v > 0 && (stop.type !== 'percent' || v <= 100)));
  const p2 = target ? unique([target.value * .8, target.value, target.value * 1.2]) : unique([Math.max(0, base.strategy.costs.slippageBps - 2), base.strategy.costs.slippageBps, Math.min(100, base.strategy.costs.slippageBps + 2)]);
  const sensitivityHeatmap: SensitivityHeatmapResult = { status: 'available', metric: 'totalReturnPercent', param1Name: 'Stop loss (' + stop.type + ')', param1Values: p1, param2Name: target ? 'Take profit (' + target.type + ')' : 'Slippage (bps)', param2Values: p2,
    matrix: p1.map(v1 => p2.map(v2 => { const strategy: StrategyAST = JSON.parse(JSON.stringify(base.strategy)); strategy.risk.stopLoss.value = v1; if (target) strategy.risk.takeProfit!.value = v2; else strategy.costs.slippageBps = v2;
      try { const run = simulate(strategy, bars, { ...options, robustness: false }); return { param1Value: v1, param2Value: v2, metricValue: run.metrics.totalReturnPercent }; }
      catch (e) { return { param1Value: v1, param2Value: v2, metricValue: null, reason: (e as Error).message }; }
    })) };
  return { monteCarlo, trainTestSplit, sensitivityHeatmap };
}
