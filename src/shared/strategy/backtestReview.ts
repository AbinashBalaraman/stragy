import type { StrategyAST } from './types';
import { renderRuleInPlainLanguage } from './renderPlainLanguage';
import { canonicalStrategyJSON, validateStrategy } from './schema';

export interface BacktestAssumptionOptions {
  /** The research engine uses ₹1,00,000 when this is not supplied. */
  initialCapital?: number;
  /** Latest actual observation date the review is anchored to. */
  asOf?: string;
  /** Where the strategy under review came from, e.g. a screen or a reviewed draft. */
  sourceLabel: string;
}

export interface BacktestAssumptionReview {
  sourceLabel: string;
  entrySummary: string[];
  exitSummary: string[];
  riskSummary: string[];
  sizingSummary: string;
  executionSummary: string;
  capitalSummary: string;
  costSummary: string;
  dataWindow: string;
  defaults: string[];
  limitations: string[];
}

const money = (value: number) => '₹' + value.toLocaleString('en-IN', { maximumFractionDigits: 2 });
const percent = (value: number) => String(Math.round(value * 100) / 100) + '%';

function stopDistance(type: 'percent' | 'points' | 'atr', value: number, atrPeriod?: number): string {
  if (type === 'percent') return percent(value) + ' below the entry price';
  if (type === 'points') return value + ' price points below the entry price';
  return value + ' × ATR(' + (atrPeriod ?? 14) + ') from the previous completed bar';
}

/**
 * A deliberately explicit, plain-English review of the assumptions that will be
 * sent to the existing backtest engine. It supplements renderPlainLanguage with
 * completion/fee/ATR details and never claims to be a complete regulatory review.
 */
export function describeBacktestAssumptions(strategy: StrategyAST, options: BacktestAssumptionOptions): BacktestAssumptionReview {
  const defaults: string[] = [];
  const risk = strategy.risk;
  const capital = options.initialCapital;
  if (capital === undefined) defaults.push('Starting capital defaults to ₹1,00,000 (the research engine default).');
  defaults.push(options.asOf
    ? 'The data cutoff is the observed date shown above; no later bars are used.'
    : 'The data cutoff is the latest completed daily session available to the provider.');

  const riskSummary: string[] = [
    'Stop loss: ' + stopDistance(risk.stopLoss.type, risk.stopLoss.value, risk.stopLoss.atrPeriod) + '.',
  ];
  if (risk.takeProfit === null) {
    riskSummary.push('Take profit: none. Exits rely on the exit rules, stop loss or trailing stop.');
  } else if (risk.takeProfit.type === 'rr') {
    riskSummary.push('Take profit: ' + risk.takeProfit.value + '× the initial stop distance.');
  } else if (risk.takeProfit.type === 'points') {
    riskSummary.push('Take profit: ' + risk.takeProfit.value + ' price points above the entry.');
  } else {
    riskSummary.push('Take profit: ' + percent(risk.takeProfit.value) + ' above the entry.');
  }
  if (risk.trailingStop) {
    const trail = risk.trailingStop.type === 'atr'
      ? risk.trailingStop.value + ' × ATR(' + (risk.trailingStop.atrPeriod ?? 14) + ') from the high-water mark'
      : risk.trailingStop.type === 'points'
        ? risk.trailingStop.value + ' price points from the high-water mark'
        : percent(risk.trailingStop.value) + ' from the high-water mark';
    const activation = risk.trailingStop.activation
      ? ' It activates after a ' + percent(risk.trailingStop.activation) + ' favourable move.'
      : '';
    riskSummary.push('Trailing stop: ' + trail + '.' + activation + ' Changes apply from the next bar.');
  } else {
    riskSummary.push('Trailing stop: none.');
  }
  if (risk.maxDrawdownCutoff) riskSummary.push(
    'Drawdown circuit breaker: at the close where peak-to-trough equity drawdown reaches ' +
    percent(risk.maxDrawdownCutoff) + ', new entries are paused and any open position is closed at the next available open. ' +
    'Gaps and fees can push the realized loss beyond that threshold.'
  );


  const sizing = risk.positionSizing;
  const sizingSummary = sizing.type === 'fixedFraction'
    ? 'Each entry may allocate up to ' + percent(Math.round((sizing.fraction ?? 0) * 10000) / 100) + ' of available cash, then buys whole units subject to estimated entry fees.'
    : sizing.type === 'fixedQty'
      ? 'Each entry attempts ' + (sizing.quantity ?? 0) + ' whole units; if that quantity is unaffordable, the run fails instead of silently reducing it.'
      : 'Each entry risks ' + percent(Math.round((sizing.riskPerTrade ?? 0) * 10000) / 100) + ' of available cash; quantity is derived from the stop distance and estimated fees.';

  const execution = strategy.execution;
  const executionParts = [
    'The research engine simulates long-only, cash-funded daily trades; short entries are not executed even if the strategy allows them.',
    'Rule signals are evaluated on a completed daily bar and fill at the next session open using market orders; LIMIT order settings are not executed by this engine.',
    'The simulation never sends a broker order, uses no leverage or borrow, and applies whole-unit position sizing.',
  ];
  if (execution.intradaySquareOffTime) executionParts.push('Intraday square-off at ' + execution.intradaySquareOffTime + ' is not supported by this daily engine and is ignored.');
  executionParts.push(execution.liquidateAtEnd === false
    ? 'End-of-data liquidation is disabled: any open position is marked to the final close instead of being sold.'
    : 'Any position still open at the end of the evaluation window is liquidated at the final close (the default).');

  const costs = strategy.costs;
  const costSummaryParts = [
    (costs.tradeType === 'DELIVERY' ? 'Delivery' : 'Intraday') + ' cost model',
    costs.slippageBps + ' bps slippage on each fill',
    money(costs.brokerageFlat) + ' flat brokerage on each fill',
  ];
  const costSummary = costSummaryParts.join(' · ') + '. ' + (costs.applyIndianTaxes
    ? 'The flat brokerage and slippage above are included. Illustrative, unverified Indian STT, exchange, SEBI, stamp-duty and GST rates are also included. Percentage-based or tiered broker fees, DP charges and other broker-specific charges are not included, and the statutory rates are not certified current or historical.'
    : 'The flat brokerage and slippage above are included. No statutory Indian taxes are included in this run. Percentage-based or tiered broker fees, DP charges and other broker-specific charges are not included.');

  const capitalSummary = capital === undefined
    ? money(100000) + ' starting capital (engine default; not explicitly set in this conversation).'
    : money(capital) + ' starting capital (explicitly supplied for this run).';

  const dataWindow = options.asOf
    ? 'Observations through ' + options.asOf + '.'
    : 'Observations through the latest completed daily session available.';

  return {
    sourceLabel: options.sourceLabel,
    entrySummary: strategy.rules.entry.map(rule => renderRuleInPlainLanguage(rule, strategy.indicators)),
    exitSummary: strategy.rules.exit.length
      ? strategy.rules.exit.map(rule => renderRuleInPlainLanguage(rule, strategy.indicators))
      : ['No rule-based exit is configured; the stop loss, take profit, trailing stop or end-of-data handling closes positions.'],
    riskSummary,
    sizingSummary,
    executionSummary: executionParts.join(' '),
    capitalSummary,
    costSummary,
    dataWindow,
    defaults,
    limitations: [
      'This is a research simulation, not investment advice, a certified performance claim or a broker order.',
      'Contract tick size, lot size, margins, settlement and statutory fee accuracy are not verified.',
      'Stops and targets are checked against daily OHLC: a gap through the stop fills at the open, and a bar that touches both stop and target is assumed to hit the stop first.',
      'Slippage and fees are charged on fills and can make realized losses exceed the configured stop or drawdown threshold.',
      'Simulated past performance does not predict future returns.',
    ],
  };
}

/**
 * Screen plans carry their own indicator set. Current workspace exit rules may
 * only be overlaid when every indicator they reference is present in the screen
 * with exactly the same definition. Missing or changed semantics must be refused
 * instead of silently running different exits than the user reviewed.
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return '{' + Object.keys(record).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(record[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

export function exitRuleCompatibility(
  exitRules: StrategyAST['rules']['exit'],
  screenIndicators: StrategyAST['indicators'],
  workspaceIndicators: StrategyAST['indicators'],
): string | null {
  const screenById = new Map(screenIndicators.map(indicator => [indicator.id, indicator]));
  const workspaceById = new Map(workspaceIndicators.map(indicator => [indicator.id, indicator]));
  const referenced = new Set<string>();
  for (const rule of exitRules) {
    referenced.add(rule.leftIndicator);
    if (rule.rightIndicator !== undefined) referenced.add(rule.rightIndicator);
  }
  for (const id of referenced) {
    const workspace = workspaceById.get(id);
    if (!workspace) continue; // A validated rule may reference a price field or constant.
    const screen = screenById.get(id);
    if (!screen) {
      return 'Your current exit rules use indicator “' + id + '”, which is not part of this screen. Prepare the screen again or choose exit rules that use the screen’s indicators. Nothing was run.';
    }
    if (screen.type !== workspace.type || canonicalJson(screen.params) !== canonicalJson(workspace.params)) {
      return 'Your current exit rules use indicator “' + id + '” with different settings from the screen. Prepare the screen again or choose exit rules that use the screen’s settings. Nothing was run.';
    }
  }
  return null;
}

/**
 * Stable identity for the exact reviewed strategy content.
 *
 * Validate first: the engine returns its canonical strategy, which includes
 * normalized defaults such as executionPolicy and liquidateAtEnd that a legacy
 * review input may omit. Raw JSON equality would reject the same strategy.
 */
export function canonicalStrategySignature(strategy: StrategyAST): string | null {
  const validated = validateStrategy(strategy);
  return validated.success && validated.canonicalData
    ? canonicalStrategyJSON(validated.canonicalData)
    : null;
}

