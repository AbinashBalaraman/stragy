import { randomUUID } from 'node:crypto';
import type { StrategyAST, OHLCVBar, BacktestResponse, TradeRecord, EquityPoint, IndianCostBreakdown } from '../../shared/strategy/types';
import { validateStrategy } from '../../shared/strategy/schema';
import { calculateAllIndicators, calcATR } from './indicators';
import { calculateFillCosts, aggregateCosts, type FeeSchedule } from './indianCosts';
import { computeMetrics } from './metrics';
import { buildRobustnessSuite, unavailableRobustness } from './robustness';
import { evaluateRuleSet } from './rules';
import { getSymbolById } from '../data/symbols';
import { getDailyBars } from '../data/mockData';
import { validateBars } from '../data/marketSeries';
export { evaluateCondition, evaluateRuleSet } from './rules';

export interface BacktestOptions {
  initialCapital?: number; seed?: number; robustness?: boolean; simulations?: number;
  feeSchedule?: FeeSchedule; startIndex?: number; endIndex?: number; liquidateAtEnd?: boolean;
}
export class SimulationInputError extends Error { constructor(public code: string, message: string) { super(message); } }
interface Position { entryIndex: number; entryPrice: number; quantity: number; entryFees: number; stop: number; target: number | null; trail: number | null; highWater: number; }

/** Simulation-only core. No provider calls, randomness in mathematics, or recursive robustness. */
export function simulate(raw: StrategyAST, inputBars: OHLCVBar[], options: BacktestOptions = {}): BacktestResponse {
  const parsed = validateStrategy(raw);
  if (!parsed.success || !parsed.data) throw new SimulationInputError('INVALID_STRATEGY', parsed.errors?.join('; ') ?? 'Invalid strategy');
  const strategy = parsed.data;
  const bars = validateBars(inputBars);
  const symbol = getSymbolById(strategy.universe.symbolId);
  const initialCapital = options.initialCapital ?? 100000;
  if (!Number.isFinite(initialCapital) || initialCapital <= 0 || initialCapital > 1e9) throw new SimulationInputError('INVALID_CAPITAL', 'Capital must be positive and bounded.');
  const start = options.startIndex ?? 0, end = options.endIndex ?? bars.length;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > bars.length || end <= start) throw new SimulationInputError('INVALID_WINDOW', 'Invalid evaluation window.');
  const series = calculateAllIndicators(bars, strategy.indicators);
  const riskATR = calcATR(bars, strategy.risk.stopLoss.atrPeriod ?? 14);
  const trailingATR = calcATR(bars, strategy.risk.trailingStop?.atrPeriod ?? 14);
  const trades: TradeRecord[] = [], equityCurve: EquityPoint[] = [], fillCosts: IndianCostBreakdown[] = [];
  const ledger: NonNullable<BacktestResponse['ledger']> = [];
  const warnings = [...(parsed.warnings ?? []), 'Single-symbol long-only daily cash-funded market-order research; no partial fills, borrow, dividends, or verified point-in-time universes.', 'Benchmark is this instrument buy-and-hold, not a market index.'];
  if (strategy.costs.applyIndianTaxes && !options.feeSchedule?.verified) warnings.push('Illustrative unverified fee schedule: not certified current/historical statutory charges; DP and other broker-specific charges are excluded.');
  if ((bars[end - 1].timestamp - bars[start].timestamp) / 86400000 < 365) warnings.push('Short-horizon annualized metrics can be unstable.');
  let cash = initialCapital, peak = initialCapital, position: Position | null = null, pendingEntry = false;
  let pendingExit: TradeRecord['exitReason'] | null = null, halted = false, ambiguousBars = 0;
  if (strategy.universe.metadata) warnings.push('Instrument metadata is unverified: tickSize, exchange tradability and trading calendar are not validated; quantityStep is enforced for research sizing only.');
  const quantityStep = strategy.universe.metadata?.quantityStep ?? 1;
  const slip = strategy.costs.slippageBps / 10000;
  const fee = (price: number, quantity: number, side: 'BUY' | 'SELL', i: number, referencePrice?: number) => calculateFillCosts({ price, quantity, side, timestamp: bars[i].timestamp, referencePrice }, strategy.costs, options.feeSchedule);
  const effectiveStop = () => position ? Math.max(position.stop, position.trail ?? -Infinity) : -Infinity;
  const stopReason = (): TradeRecord['exitReason'] => position?.trail !== null && position && position.trail! > position.stop ? 'TRAILING_STOP' : 'STOP_LOSS';
  function close(i: number, reference: number, reason: TradeRecord['exitReason']) {
    if (!position) return;
    const p = position, price = reference * (1 - slip), charged = fee(price, p.quantity, 'SELL', i, reference);
    cash += p.quantity * price - charged.totalCharges;
    fillCosts.push(charged); ledger.push({ timestamp: bars[i].timestamp, side: 'SELL', quantity: p.quantity, price, fees: charged.totalCharges, cash });
    const pnl = p.quantity * (price - p.entryPrice), costs = p.entryFees + charged.totalCharges;
    trades.push({ id: 'T' + (trades.length + 1), entryDate: bars[p.entryIndex].date, entryTimestamp: bars[p.entryIndex].timestamp, entryPrice: p.entryPrice,
      exitDate: bars[i].date, exitTimestamp: bars[i].timestamp, exitPrice: price, direction: 'LONG', quantity: p.quantity, pnl, pnlPercent: (price / p.entryPrice - 1) * 100,
      holdingDays: (bars[i].timestamp - bars[p.entryIndex].timestamp) / 86400000, holdingBars: i - p.entryIndex, exitReason: reason, costs, netPnl: pnl - costs });
    position = null; pendingExit = null;
  }
  function distance(type: string, value: number, price: number, atr: number | null | undefined): number | null {
    if (type === 'percent') return price * value / 100;
    if (type === 'points') return value;
    return typeof atr === 'number' && Number.isFinite(atr) && atr > 0 ? value * atr : null;
  }
  for (let i = start; i < end; i++) {
    const b = bars[i]; let exited = false;
    // Previously resting protection has priority at a gap, before a pending rule exit.
    if (position && b.open <= effectiveStop()) { close(i, b.open, stopReason()); exited = true; }
    else if (position?.target !== null && position && b.open >= position.target!) { close(i, position.target!, 'TAKE_PROFIT'); exited = true; }
    if (position && pendingExit) { close(i, b.open, pendingExit); exited = true; }
    if (pendingEntry) {
      pendingEntry = false;
      if (!position && !exited && !halted) {
        const price = b.open * (1 + slip), stopDistance = distance(strategy.risk.stopLoss.type, strategy.risk.stopLoss.value, price, riskATR[i - 1]);
        if (stopDistance === null || stopDistance <= 0 || stopDistance > price) warnings.push('Entry skipped: unavailable ATR or non-executable stop distance at ' + b.date);
        else {
          const stop = price - stopDistance, sizing = strategy.risk.positionSizing;
          const allocation = sizing.type === 'fixedFraction' ? cash * sizing.fraction! : cash;
          const cashCeiling = Math.max(0, Math.floor(cash / price / quantityStep));
          if (!Number.isSafeInteger(cashCeiling)) throw new SimulationInputError('UNSUPPORTED_QUANTITY_STEP', 'quantityStep requires an unsafe number of sizing units.');
          const affordable = (q: number) => q * price + fee(price, q, 'BUY', i).totalCharges <= Math.min(cash, allocation) + 1e-9;
          const withinRisk = (q: number) => sizing.type !== 'fixedRisk' || q * (price - stop * (1 - slip)) + fee(price, q, 'BUY', i).totalCharges + fee(Math.max(Number.EPSILON, stop * (1 - slip)), q, 'SELL', i).totalCharges <= cash * sizing.riskPerTrade! + 1e-9;
          let qty = sizing.type === 'fixedQty' ? sizing.quantity! : cashCeiling * quantityStep;
          if (sizing.type === 'fixedQty' && !affordable(qty)) throw new SimulationInputError('INSUFFICIENT_FUNDS', 'Fixed quantity is unaffordable at ' + b.date);
          if (sizing.type !== 'fixedQty') { let lo = 0, hi = cashCeiling; while (lo < hi) { const mid = lo + Math.ceil((hi - lo) / 2); if (affordable(mid * quantityStep) && withinRisk(mid * quantityStep)) lo = mid; else hi = mid - 1; } qty = lo * quantityStep; }
          if (qty > 0) {
            const charged = fee(price, qty, 'BUY', i, b.open); cash -= qty * price + charged.totalCharges;
            fillCosts.push(charged); ledger.push({ timestamp: b.timestamp, side: 'BUY', quantity: qty, price, fees: charged.totalCharges, cash });
            const target = strategy.risk.takeProfit;
            const targetPrice = target ? price + (target.type === 'percent' ? price * target.value / 100 : target.type === 'points' ? target.value : stopDistance * target.value) : null;
            const trail = strategy.risk.trailingStop;
            const trailDistance = trail ? distance(trail.type, trail.value, price, trailingATR[i - 1]) : null;
            if (trail?.type === 'atr' && trailDistance === null) throw new SimulationInputError('ATR_NOT_READY', 'Trailing ATR is unavailable at entry.');
            position = { entryIndex: i, entryPrice: price, quantity: qty, entryFees: charged.totalCharges, stop, target: targetPrice, trail: trail && !(trail.activation && trail.activation > 0) && trailDistance !== null ? price - trailDistance : null, highWater: price };
          } else warnings.push('Entry skipped: allocation/risk budget cannot fund a valid quantity at ' + b.date);
        }
      }
    }
    if (position) {
      const stop = effectiveStop(), stopTouched = b.low <= stop, targetTouched = position.target !== null && b.high >= position.target;
      if (stopTouched && targetTouched) ambiguousBars++;
      if (stopTouched) { close(i, stop, stopReason()); exited = true; }
      else if (targetTouched) { close(i, position.target!, 'TAKE_PROFIT'); exited = true; }
    }
    if (position && i === end - 1 && (options.liquidateAtEnd ?? strategy.execution.liquidateAtEnd ?? true)) { close(i, b.close, 'END_OF_DATA'); exited = true; }
    const equity = cash + (position ? position.quantity * b.close : 0);
    peak = Math.max(peak, equity);
    const drawdown = peak - equity, drawdownPercent = peak > 0 ? drawdown / peak * 100 : 0;
    equityCurve.push({ date: b.date, timestamp: b.timestamp, equity, drawdown, drawdownPercent, benchmarkEquity: initialCapital * b.close / bars[start].close });
    if (strategy.risk.maxDrawdownCutoff != null && drawdownPercent >= strategy.risk.maxDrawdownCutoff) { halted = true; pendingEntry = false; if (position) pendingExit = 'MAX_DRAWDOWN'; }
    // Trail changes use the completed bar; they become active only next iteration.
    if (position && strategy.risk.trailingStop) {
      position.highWater = Math.max(position.highWater, b.high);
      const trail = strategy.risk.trailingStop, excursionPct = (position.highWater / position.entryPrice - 1) * 100;
      if (excursionPct >= (trail.activation ?? 0)) { const d = distance(trail.type, trail.value, position.highWater, trailingATR[i]); if (d !== null) position.trail = Math.max(position.trail ?? -Infinity, position.highWater - d); }
    }
    if (i < end - 1) {
      if (position && !pendingExit && evaluateRuleSet(strategy.rules.exit, i, series)) pendingExit = 'RULE_EXIT';
      else if (!position && !halted && evaluateRuleSet(strategy.rules.entry, i, series)) pendingEntry = true;
    }
  }
  if (ambiguousBars) warnings.push(ambiguousBars + ' bars touched stop and target; adverse stop-first OHLC ambiguity policy applied.');
  if (halted) warnings.push('Drawdown circuit breaker triggered at close; actual gap/fee losses can exceed its threshold.');
  if (position) warnings.push('Position remains open: final equity includes marked unrealized PnL, not invented liquidation.');
  const realized = trades.reduce((s, t) => s + t.netPnl, 0), unrealized = position ? position.quantity * (bars[end - 1].close - position.entryPrice) - position.entryFees : 0;
  const expectedEquity = initialCapital + realized + unrealized, actualEquity = equityCurve.at(-1)!.equity;
  if (Math.abs(expectedEquity - actualEquity) > 1e-6 * Math.max(1, initialCapital / 100000)) throw new Error('LEDGER_RECONCILIATION_FAILED');
  return { backtestId: randomUUID(), strategy, symbol, metrics: computeMetrics(equityCurve, trades, initialCapital), equityCurve, trades, costs: aggregateCosts(fillCosts),
    robustness: unavailableRobustness('Not requested in simulation-only core'), indicatorsData: Object.fromEntries(Object.entries(series).map(([k, v]) => [k, v.slice(start, end)])), bars: bars.slice(start, end), executedAt: new Date().toISOString(),
    engineVersion: 'stragy-next-open-v2', executionPolicy: 'next_open_long_cash_v1', warnings: [...new Set(warnings)], ledger, reconciliation: { expectedEquity, actualEquity, difference: actualEquity - expectedEquity } };
}
export function runBacktest(strategy: StrategyAST, customBars?: OHLCVBar[], options: BacktestOptions = {}): BacktestResponse {
  const bars = customBars ?? getDailyBars(strategy.universe.symbolId);
  const result = simulate(strategy, bars, options);
  if (options.robustness !== false) result.robustness = buildRobustnessSuite(result, bars, options, simulate);
  return result;
}
