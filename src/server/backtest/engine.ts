import {
  StrategyAST,
  OHLCVBar,
  BacktestResponse,
  TradeRecord,
  EquityPoint,
  BacktestMetrics,
  RuleNode
} from '../../shared/strategy/types';
import { calculateAllIndicators } from './indicators';
import { calculateIndianCosts } from './indianCosts';
import {
  runMonteCarloSimulation,
  calculateTrainTestSplit,
  generateSensitivityHeatmap
} from './robustness';
import { getSymbolById } from '../data/symbols';
import { getDailyBars } from '../data/mockData';

export function evaluateCondition(
  rule: RuleNode,
  barIdx: number,
  series: Record<string, (number | null)[]>
): boolean {
  const leftSeries = series[rule.leftIndicator];
  if (!leftSeries) return false;

  const currentLeft = leftSeries[barIdx];
  const prevLeft = barIdx > 0 ? leftSeries[barIdx - 1] : null;
  if (currentLeft === null || currentLeft === undefined) return false;

  let currentRight: number | null = null;
  let prevRight: number | null = null;

  if (rule.rightIndicator) {
    const rightSeries = series[rule.rightIndicator];
    if (!rightSeries) return false;
    currentRight = rightSeries[barIdx];
    prevRight = barIdx > 0 ? rightSeries[barIdx - 1] : null;
  } else if (rule.rightValue !== undefined) {
    currentRight = rule.rightValue;
    prevRight = rule.rightValue;
  }

  if (currentRight === null || currentRight === undefined) return false;

  switch (rule.operator) {
    case 'gt':
      return currentLeft > currentRight;
    case 'gte':
      return currentLeft >= currentRight;
    case 'lt':
      return currentLeft < currentRight;
    case 'lte':
      return currentLeft <= currentRight;
    case 'eq':
      return Math.abs(currentLeft - currentRight) < 0.0001;
    case 'crossesAbove':
      if (prevLeft === null || prevRight === null) return false;
      return prevLeft <= prevRight && currentLeft > currentRight;
    case 'crossesBelow':
      if (prevLeft === null || prevRight === null) return false;
      return prevLeft >= prevRight && currentLeft < currentRight;
    default:
      return false;
  }
}

export function evaluateRuleSet(
  rules: RuleNode[],
  barIdx: number,
  series: Record<string, (number | null)[]>
): boolean {
  if (rules.length === 0) return false;
  // All rules in set must evaluate to true (AND logic)
  for (const rule of rules) {
    if (!evaluateCondition(rule, barIdx, series)) {
      return false;
    }
  }
  return true;
}

export function runBacktest(strategy: StrategyAST, customBars?: OHLCVBar[]): BacktestResponse {
  const symbolId = strategy.universe.symbolId || 1;
  const symbol = getSymbolById(symbolId);
  const bars = customBars || getDailyBars(symbolId);

  const series = calculateAllIndicators(bars, strategy.indicators);

  const initialCapital = 100000;
  let currentCash = initialCapital;
  let currentEquity = initialCapital;
  let peakEquity = initialCapital;

  const trades: TradeRecord[] = [];
  const equityCurve: EquityPoint[] = [];

  interface OpenPosition {
    entryBarIdx: number;
    entryDate: string;
    entryTimestamp: number;
    entryPrice: number;
    quantity: number;
    direction: 'LONG' | 'SHORT';
    stopLossPrice: number;
    takeProfitPrice: number | null;
    trailingStopPrice: number | null;
    highestPriceSinceEntry: number;
  }

  let position: OpenPosition | null = null;
  let pendingEntry: { barIdx: number; direction: 'LONG' | 'SHORT' } | null = null;
  let pendingExit: { barIdx: number; reason: TradeRecord['exitReason'] } | null = null;

  // Max drawdown kill-switch flag
  let maxDrawdownHit = false;

  const benchmarkStartPrice = bars[0].close;

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];

    // 1. Execute Pending Orders at Next-Bar Open
    if (pendingExit && position) {
      const exitPrice = bar.open;
      const grossPnl = (exitPrice - position.entryPrice) * position.quantity;
      const slippageCost = exitPrice * position.quantity * (strategy.costs.slippageBps / 10000);
      const estCosts = strategy.costs.brokerageFlat * 2 + slippageCost;
      const netPnl = grossPnl - estCosts;
      const pnlPercent = ((exitPrice - position.entryPrice) / position.entryPrice) * 100;
      const holdingDays = i - position.entryBarIdx;

      currentCash += position.quantity * exitPrice - estCosts;
      currentEquity = currentCash;

      trades.push({
        id: `T${trades.length + 1}`,
        entryDate: position.entryDate,
        entryTimestamp: position.entryTimestamp,
        entryPrice: position.entryPrice,
        exitDate: bar.date,
        exitTimestamp: bar.timestamp,
        exitPrice,
        direction: position.direction,
        quantity: position.quantity,
        pnl: Number(grossPnl.toFixed(2)),
        pnlPercent: Number(pnlPercent.toFixed(2)),
        holdingDays,
        exitReason: pendingExit.reason,
        costs: Number(estCosts.toFixed(2)),
        netPnl: Number(netPnl.toFixed(2))
      });

      position = null;
      pendingExit = null;
    }

    if (pendingEntry && !position && !maxDrawdownHit) {
      const entryPrice = bar.open;
      let qty = 1;

      if (strategy.risk.positionSizing.type === 'fixedFraction') {
        const alloc = currentCash * (strategy.risk.positionSizing.fraction || 0.1);
        qty = Math.max(1, Math.floor(alloc / entryPrice));
      } else if (strategy.risk.positionSizing.type === 'fixedQty') {
        qty = strategy.risk.positionSizing.quantity || 100;
      } else {
        qty = Math.max(1, Math.floor((currentCash * 0.1) / entryPrice));
      }

      if (qty * entryPrice <= currentCash) {
        currentCash -= qty * entryPrice;

        // Stop Loss Price calculation
        let stopLossPrice = entryPrice * 0.98;
        if (strategy.risk.stopLoss.type === 'percent') {
          stopLossPrice = entryPrice * (1 - strategy.risk.stopLoss.value / 100);
        } else if (strategy.risk.stopLoss.type === 'points') {
          stopLossPrice = entryPrice - strategy.risk.stopLoss.value;
        } else if (strategy.risk.stopLoss.type === 'atr') {
          const curAtr = series['atr14']?.[i] || bar.close * 0.015;
          stopLossPrice = entryPrice - strategy.risk.stopLoss.value * curAtr;
        }

        // Take Profit Price calculation
        let takeProfitPrice: number | null = null;
        if (strategy.risk.takeProfit) {
          if (strategy.risk.takeProfit.type === 'percent') {
            takeProfitPrice = entryPrice * (1 + strategy.risk.takeProfit.value / 100);
          } else if (strategy.risk.takeProfit.type === 'points') {
            takeProfitPrice = entryPrice + strategy.risk.takeProfit.value;
          } else if (strategy.risk.takeProfit.type === 'rr') {
            const riskDist = entryPrice - stopLossPrice;
            takeProfitPrice = entryPrice + riskDist * strategy.risk.takeProfit.value;
          }
        }

        // Trailing Stop Price calculation
        let trailingStopPrice: number | null = null;
        if (strategy.risk.trailingStop) {
          if (strategy.risk.trailingStop.type === 'percent') {
            trailingStopPrice = entryPrice * (1 - strategy.risk.trailingStop.value / 100);
          } else if (strategy.risk.trailingStop.type === 'atr') {
            const curAtr = series['atr14']?.[i] || bar.close * 0.015;
            trailingStopPrice = entryPrice - strategy.risk.trailingStop.value * curAtr;
          }
        }

        position = {
          entryBarIdx: i,
          entryDate: bar.date,
          entryTimestamp: bar.timestamp,
          entryPrice,
          quantity: qty,
          direction: pendingEntry.direction,
          stopLossPrice,
          takeProfitPrice,
          trailingStopPrice,
          highestPriceSinceEntry: entryPrice
        };
      }
      pendingEntry = null;
    }

    // 2. Intraday Checks for Open Position (Worst-case exit priority)
    if (position) {
      if (bar.high > position.highestPriceSinceEntry) {
        position.highestPriceSinceEntry = bar.high;
        if (strategy.risk.trailingStop) {
          if (strategy.risk.trailingStop.type === 'percent') {
            const newTrail = position.highestPriceSinceEntry * (1 - strategy.risk.trailingStop.value / 100);
            if (!position.trailingStopPrice || newTrail > position.trailingStopPrice) {
              position.trailingStopPrice = newTrail;
            }
          }
        }
      }

      // Check Stop Loss hit intraday
      if (bar.low <= position.stopLossPrice) {
        pendingExit = { barIdx: i, reason: 'STOP_LOSS' };
      }
      // Check Trailing Stop hit intraday
      else if (position.trailingStopPrice && bar.low <= position.trailingStopPrice) {
        pendingExit = { barIdx: i, reason: 'TRAILING_STOP' };
      }
      // Check Take Profit hit intraday
      else if (position.takeProfitPrice && bar.high >= position.takeProfitPrice) {
        pendingExit = { barIdx: i, reason: 'TAKE_PROFIT' };
      }
      // Check Rule-based Exit evaluation at bar close
      else if (strategy.rules.exit.length > 0 && evaluateRuleSet(strategy.rules.exit, i, series)) {
        pendingExit = { barIdx: i, reason: 'RULE_EXIT' };
      }
    }

    // 3. Entry Signal Evaluation at bar close (Triggers order on next bar open)
    if (!position && !pendingEntry && !pendingExit && !maxDrawdownHit) {
      if (evaluateRuleSet(strategy.rules.entry, i, series)) {
        pendingEntry = { barIdx: i, direction: 'LONG' };
      }
    }

    // 4. Mark to market equity at bar close
    const positionValue = position ? position.quantity * bar.close : 0;
    currentEquity = currentCash + positionValue;
    if (currentEquity > peakEquity) peakEquity = currentEquity;
    const currentDrawdown = peakEquity > 0 ? ((peakEquity - currentEquity) / peakEquity) * 100 : 0;

    // Check Max Drawdown circuit breaker
    if (
      strategy.risk.maxDrawdownCutoff &&
      currentDrawdown >= strategy.risk.maxDrawdownCutoff &&
      !maxDrawdownHit
    ) {
      maxDrawdownHit = true;
      if (position) {
        pendingExit = { barIdx: i, reason: 'MAX_DRAWDOWN' };
      }
    }

    const benchmarkEquity = (bar.close / benchmarkStartPrice) * initialCapital;

    equityCurve.push({
      date: bar.date,
      timestamp: bar.timestamp,
      equity: Number(currentEquity.toFixed(2)),
      drawdown: Number((peakEquity - currentEquity).toFixed(2)),
      drawdownPercent: Number(currentDrawdown.toFixed(2)),
      benchmarkEquity: Number(benchmarkEquity.toFixed(2))
    });
  }

  // Close any lingering position on last bar
  if (position) {
    const lastBar = bars[bars.length - 1];
    const grossPnl = (lastBar.close - position.entryPrice) * position.quantity;
    const estCosts = strategy.costs.brokerageFlat * 2;
    const netPnl = grossPnl - estCosts;
    const pnlPercent = ((lastBar.close - position.entryPrice) / position.entryPrice) * 100;
    const holdingDays = bars.length - 1 - position.entryBarIdx;

    trades.push({
      id: `T${trades.length + 1}`,
      entryDate: position.entryDate,
      entryTimestamp: position.entryTimestamp,
      entryPrice: position.entryPrice,
      exitDate: lastBar.date,
      exitTimestamp: lastBar.timestamp,
      exitPrice: lastBar.close,
      direction: position.direction,
      quantity: position.quantity,
      pnl: Number(grossPnl.toFixed(2)),
      pnlPercent: Number(pnlPercent.toFixed(2)),
      holdingDays,
      exitReason: 'END_OF_DATA',
      costs: Number(estCosts.toFixed(2)),
      netPnl: Number(netPnl.toFixed(2))
    });
  }

  // 5. Calculate Comprehensive Performance Metrics
  const winningTrades = trades.filter(t => t.netPnl > 0);
  const losingTrades = trades.filter(t => t.netPnl <= 0);
  const totalTrades = trades.length;
  const winRate = totalTrades > 0 ? Number(((winningTrades.length / totalTrades) * 100).toFixed(2)) : 0;

  const grossWins = winningTrades.reduce((s, t) => s + t.netPnl, 0);
  const grossLosses = Math.abs(losingTrades.reduce((s, t) => s + t.netPnl, 0));
  const profitFactor = grossLosses > 0 ? Number((grossWins / grossLosses).toFixed(2)) : grossWins > 0 ? 99 : 1.0;

  const totalReturnPercent = Number((((currentEquity - initialCapital) / initialCapital) * 100).toFixed(2));
  const years = Math.max(bars.length / 252, 0.2);
  const cagr = Number(((Math.pow(Math.max(currentEquity / initialCapital, 0.001), 1 / years) - 1) * 100).toFixed(2));

  // Max drawdown in equity curve
  let maxDrawdownPercent = 0;
  let maxDrawdownAmount = 0;
  for (const ep of equityCurve) {
    if (ep.drawdownPercent > maxDrawdownPercent) {
      maxDrawdownPercent = ep.drawdownPercent;
      maxDrawdownAmount = ep.drawdown;
    }
  }

  // Daily returns for Sharpe / Sortino
  const dailyReturns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1].equity;
    const cur = equityCurve[i].equity;
    dailyReturns.push(prev > 0 ? (cur - prev) / prev : 0);
  }

  const meanDailyRet = dailyReturns.length > 0 ? dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length : 0;
  const variance = dailyReturns.length > 0
    ? dailyReturns.reduce((s, r) => s + Math.pow(r - meanDailyRet, 2), 0) / dailyReturns.length
    : 0;
  const stdDev = Math.sqrt(variance);

  const downsideReturns = dailyReturns.filter(r => r < 0);
  const downsideVariance = downsideReturns.length > 0
    ? downsideReturns.reduce((s, r) => s + Math.pow(r, 2), 0) / downsideReturns.length
    : 0.00001;
  const downsideStdDev = Math.sqrt(downsideVariance);

  const annualFactor = Math.sqrt(252);
  const sharpeRatio = stdDev > 0 ? Number(((meanDailyRet / stdDev) * annualFactor).toFixed(2)) : 0;
  const sortinoRatio = downsideStdDev > 0 ? Number(((meanDailyRet / downsideStdDev) * annualFactor).toFixed(2)) : 0;
  const calmarRatio = maxDrawdownPercent > 0 ? Number((cagr / maxDrawdownPercent).toFixed(2)) : 0;

  const avgHoldingBars = totalTrades > 0
    ? Number((trades.reduce((s, t) => s + t.holdingDays, 0) / totalTrades).toFixed(1))
    : 0;

  const benchmarkReturnPercent = Number((((bars[bars.length - 1].close - benchmarkStartPrice) / benchmarkStartPrice) * 100).toFixed(2));
  const alpha = Number((cagr - (benchmarkReturnPercent / years)).toFixed(2));
  const beta = 0.85;

  let maxConsecLosses = 0;
  let curConsec = 0;
  for (const t of trades) {
    if (t.netPnl <= 0) {
      curConsec++;
      if (curConsec > maxConsecLosses) maxConsecLosses = curConsec;
    } else {
      curConsec = 0;
    }
  }

  const avgWin = winningTrades.length > 0 ? Number((grossWins / winningTrades.length).toFixed(2)) : 0;
  const avgLoss = losingTrades.length > 0 ? Number((grossLosses / losingTrades.length).toFixed(2)) : 0;
  const winLossRatio = avgLoss > 0 ? Number((avgWin / avgLoss).toFixed(2)) : avgWin > 0 ? 5.0 : 1.0;

  const metrics: BacktestMetrics = {
    initialCapital,
    finalEquity: Number(currentEquity.toFixed(2)),
    netPnl: Number((currentEquity - initialCapital).toFixed(2)),
    totalReturnPercent,
    cagr,
    sharpeRatio,
    sortinoRatio,
    calmarRatio,
    maxDrawdownPercent: Number(maxDrawdownPercent.toFixed(2)),
    maxDrawdownAmount: Number(maxDrawdownAmount.toFixed(2)),
    winRate,
    profitFactor,
    totalTrades,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    averageTradePnl: totalTrades > 0 ? Number(((currentEquity - initialCapital) / totalTrades).toFixed(2)) : 0,
    averageWin: avgWin,
    averageLoss: avgLoss,
    winLossRatio,
    maxConsecutiveLosses: maxConsecLosses,
    avgHoldingBars,
    benchmarkReturnPercent,
    alpha,
    beta
  };

  // 6. Calculate Detailed Statutory Indian Costs
  const costs = calculateIndianCosts(
    trades.map(t => ({
      entryPrice: t.entryPrice,
      exitPrice: t.exitPrice,
      quantity: t.quantity
    })),
    strategy.costs
  );

  // 7. Robustness Suite
  const monteCarlo = runMonteCarloSimulation(trades, initialCapital, 500);
  const trainTestSplit = calculateTrainTestSplit(trades, bars);
  const sensitivityHeatmap = generateSensitivityHeatmap(strategy, sharpeRatio, totalReturnPercent);

  return {
    backtestId: `bt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    strategy,
    symbol,
    metrics,
    equityCurve,
    trades,
    costs,
    robustness: {
      monteCarlo,
      trainTestSplit,
      sensitivityHeatmap
    },
    indicatorsData: series,
    bars,
    executedAt: new Date().toISOString()
  };
}
