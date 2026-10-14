import type { BacktestMetrics, EquityPoint, TradeRecord } from '../../shared/strategy/types';
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
export function equityReturns(points: EquityPoint[]): number[] {
  return points.slice(1).map((p, i) => points[i].equity > 0 ? p.equity / points[i].equity - 1 : NaN);
}
export function computeMetrics(points: EquityPoint[], trades: TradeRecord[], initialCapital: number, options: { annualization?: number; riskFreeAnnual?: number } = {}): BacktestMetrics {
  if (!points.length || !Number.isFinite(initialCapital) || initialCapital <= 0) throw new Error('INVALID_METRIC_INPUT');
  const finalEquity = points.at(-1)!.equity;
  const factor = options.annualization ?? 252, riskFreeAnnual = options.riskFreeAnnual ?? 0;
  if (!Number.isFinite(factor) || factor <= 0 || !Number.isFinite(riskFreeAnnual) || riskFreeAnnual <= -1) throw new Error('INVALID_ANNUALIZATION');
  const unavailableReasons: Record<string, string> = {};
  const unavailable = (name: string, reason: string): null => { unavailableReasons[name] = reason; return null; };
  const durationDays = (points.at(-1)!.timestamp - points[0].timestamp) / 86400000;
  const cagrRaw = durationDays > 0 && finalEquity > 0 ? (Math.pow(finalEquity / initialCapital, 365.2425 / durationDays) - 1) * 100 : null;
  const cagr = cagrRaw !== null && Number.isFinite(cagrRaw) ? cagrRaw : unavailable('cagr', finalEquity <= 0 ? 'NONPOSITIVE_EQUITY' : 'INSUFFICIENT_DURATION');
  const returns = equityReturns(points), dailyRf = Math.pow(1 + riskFreeAnnual, 1 / factor) - 1;
  const validReturns = returns.length >= 2 && returns.every(Number.isFinite);
  const excess = returns.map(r => r - dailyRf), avg = validReturns ? mean(excess) : 0;
  const variance = validReturns ? excess.reduce((s, r) => s + (r - avg) ** 2, 0) / (excess.length - 1) : 0;
  const sharpeRatio = validReturns && variance > 0 ? avg / Math.sqrt(variance) * Math.sqrt(factor) : unavailable('sharpeRatio', validReturns ? 'ZERO_VARIANCE' : 'INSUFFICIENT_OBSERVATIONS');
  const downside = validReturns ? Math.sqrt(excess.reduce((s, r) => s + Math.min(r, 0) ** 2, 0) / excess.length) : 0;
  const sortinoRatio = validReturns && downside > 0 ? avg / downside * Math.sqrt(factor) : unavailable('sortinoRatio', validReturns ? 'ZERO_DOWNSIDE' : 'INSUFFICIENT_OBSERVATIONS');
  let peak = initialCapital, maxDrawdownAmount = 0, maxDrawdownPercent = 0;
  for (const point of points) { peak = Math.max(peak, point.equity); const amount = peak - point.equity; maxDrawdownAmount = Math.max(maxDrawdownAmount, amount); maxDrawdownPercent = Math.max(maxDrawdownPercent, peak > 0 ? amount / peak * 100 : 0); }
  const calmarRatio = cagr !== null && maxDrawdownPercent > 0 ? cagr / maxDrawdownPercent : unavailable('calmarRatio', 'ZERO_DRAWDOWN_OR_UNDEFINED_CAGR');
  const wins = trades.filter(t => t.netPnl > 0), losses = trades.filter(t => t.netPnl < 0), grossWin = wins.reduce((s, t) => s + t.netPnl, 0), grossLoss = -losses.reduce((s, t) => s + t.netPnl, 0);
  const averageWin = wins.length ? grossWin / wins.length : 0, averageLoss = losses.length ? grossLoss / losses.length : 0;
  let consecutive = 0, maxConsecutiveLosses = 0;
  for (const t of trades) { consecutive = t.netPnl < 0 ? consecutive + 1 : 0; maxConsecutiveLosses = Math.max(maxConsecutiveLosses, consecutive); }
  const benchmark = points.slice(1).map((p, i) => points[i].benchmarkEquity > 0 ? p.benchmarkEquity / points[i].benchmarkEquity - 1 - dailyRf : NaN);
  let alpha: number | null = null, beta: number | null = null;
  if (validReturns && benchmark.every(Number.isFinite)) {
    const bMean = mean(benchmark), bVariance = benchmark.reduce((s, r) => s + (r - bMean) ** 2, 0);
    if (bVariance > 0) { beta = excess.reduce((s, r, i) => s + (r - avg) * (benchmark[i] - bMean), 0) / bVariance; alpha = mean(excess.map((r, i) => r - beta! * benchmark[i])) * factor * 100; }
  }
  if (beta === null) unavailable('beta', 'INSUFFICIENT_OR_ZERO_VARIANCE_BENCHMARK');
  if (alpha === null) unavailable('alpha', 'INSUFFICIENT_OR_ZERO_VARIANCE_BENCHMARK');
  return { initialCapital, finalEquity, netPnl: finalEquity - initialCapital, totalReturnPercent: (finalEquity / initialCapital - 1) * 100, cagr, sharpeRatio, sortinoRatio, calmarRatio,
    maxDrawdownPercent, maxDrawdownAmount, winRate: trades.length ? wins.length / trades.length * 100 : unavailable('winRate', 'NO_TRADES'), profitFactor: grossLoss > 0 ? grossWin / grossLoss : unavailable('profitFactor', trades.length ? 'ZERO_GROSS_LOSS' : 'NO_TRADES'),
    totalTrades: trades.length, winningTrades: wins.length, losingTrades: losses.length, averageTradePnl: trades.length ? trades.reduce((s, t) => s + t.netPnl, 0) / trades.length : 0,
    averageWin, averageLoss, winLossRatio: averageLoss > 0 ? averageWin / averageLoss : unavailable('winLossRatio', 'ZERO_AVERAGE_LOSS'), maxConsecutiveLosses,
    avgHoldingBars: trades.length ? trades.reduce((s, t) => s + (t.holdingBars ?? t.holdingDays), 0) / trades.length : 0,
    benchmarkReturnPercent: points.at(-1)!.benchmarkEquity / initialCapital * 100 - 100, alpha, beta, unavailableReasons };
}
