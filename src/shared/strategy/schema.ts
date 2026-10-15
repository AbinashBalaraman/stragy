import { z } from 'zod';
import { StrategyAST } from './types';

export const IndicatorTypeSchema = z.enum([
  'SMA',
  'EMA',
  'RSI',
  'BBANDS',
  'MACD',
  'SUPERTREND',
  'ATR'
]);

export const PriceFieldSchema = z.enum([
  'open',
  'high',
  'low',
  'close',
  'volume',
  'candleBody',
  'upperWick',
  'lowerWick'
]);

export const RuleOperatorSchema = z.enum([
  'gt',
  'lt',
  'gte',
  'lte',
  'eq',
  'crossesAbove',
  'crossesBelow'
]);

export const IndicatorConfigSchema = z.object({
  id: z.string().min(1),
  type: IndicatorTypeSchema,
  params: z.record(z.string(), z.number())
});

export const RuleNodeSchema = z.object({
  id: z.string().optional(),
  leftIndicator: z.string().min(1),
  operator: RuleOperatorSchema,
  rightIndicator: z.string().optional(),
  rightValue: z.number().optional()
}).refine(
  data => (data.rightIndicator !== undefined && data.rightIndicator.trim() !== '') || (data.rightValue !== undefined && !isNaN(data.rightValue)),
  { message: 'Must specify either rightIndicator or rightValue' }
);

export const RiskControlsSchema = z.object({
  stopLoss: z.object({
    type: z.enum(['percent', 'points', 'atr']),
    value: z.number().positive()
  }),
  takeProfit: z.object({
    type: z.enum(['percent', 'points', 'rr']),
    value: z.number().positive()
  }).nullable(),
  trailingStop: z.object({
    type: z.enum(['percent', 'points', 'atr']),
    value: z.number().positive(),
    activation: z.number().optional()
  }).nullable(),
  positionSizing: z.object({
    type: z.enum(['fixedFraction', 'fixedQty', 'fixedRisk']),
    fraction: z.number().min(0.01).max(1).optional(),
    quantity: z.number().int().positive().optional(),
    riskPerTrade: z.number().positive().optional()
  }),
  maxDrawdownCutoff: z.number().min(1).max(50).nullable().optional()
});

export const ExecutionConfigSchema = z.object({
  allowLong: z.boolean().default(true),
  allowShort: z.boolean().default(false),
  orderType: z.enum(['MARKET', 'LIMIT']).default('MARKET'),
  intradaySquareOffTime: z.string().optional()
});

export const CostModelConfigSchema = z.object({
  slippageBps: z.number().min(0).max(100).default(5),
  brokerageFlat: z.number().min(0).default(20),
  tradeType: z.enum(['DELIVERY', 'INTRADAY']).default('DELIVERY'),
  applyIndianTaxes: z.boolean().default(true)
});

export const StrategyUniverseSchema = z.object({
  symbolId: z.number().int().positive().default(1),
  ticker: z.string().optional(),
  timeframe: z.enum(['1m', '5m', '15m', '1H', '1D', '1W']).default('1D')
});

export const StrategySchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  version: z.number().int().positive().default(1),
  universe: StrategyUniverseSchema,
  indicators: z.array(IndicatorConfigSchema).min(0),
  rules: z.object({
    entry: z.array(RuleNodeSchema).min(1, 'At least one entry rule is required'),
    exit: z.array(RuleNodeSchema).default([])
  }),
  risk: RiskControlsSchema,
  execution: ExecutionConfigSchema,
  costs: CostModelConfigSchema
});

/**
 * Phase 0: Auto-repair incomplete or malformed rules before safeParse
 */
export function repairStrategyAST(raw: any): StrategyAST {
  const cloned = JSON.parse(JSON.stringify(raw || {}));

  if (!cloned.id || typeof cloned.id !== 'string') {
    cloned.id = `strat_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  }
  if (!cloned.name || typeof cloned.name !== 'string') {
    cloned.name = 'Quantitative Strategy';
  }
  if (!cloned.version) {
    cloned.version = 1;
  }
  if (!cloned.universe || typeof cloned.universe !== 'object') {
    cloned.universe = { symbolId: 1, timeframe: '1D' };
  } else {
    cloned.universe.symbolId = Number(cloned.universe.symbolId) || 1;
    cloned.universe.timeframe = cloned.universe.timeframe || '1D';
  }
  if (!cloned.indicators || !Array.isArray(cloned.indicators)) {
    cloned.indicators = [];
  }

  // Deduplicate and sanitize indicators
  const seenIds = new Set<string>();
  cloned.indicators = cloned.indicators.map((ind: any, idx: number) => {
    let id = (ind.id || `${(ind.type || 'ind').toLowerCase()}${idx + 1}`).trim();
    if (seenIds.has(id)) {
      id = `${id}_${idx + 1}`;
    }
    seenIds.add(id);

    const type = ind.type?.toUpperCase() || 'RSI';
    let params = ind.params || {};

    if (type === 'RSI' && (!params.period || isNaN(params.period))) params.period = 14;
    if (type === 'SMA' && (!params.period || isNaN(params.period))) params.period = 20;
    if (type === 'EMA' && (!params.period || isNaN(params.period))) params.period = 20;
    if (type === 'SUPERTREND') {
      if (!params.period || isNaN(params.period)) params.period = 10;
      if (!params.multiplier || isNaN(params.multiplier)) params.multiplier = 3;
    }
    if (type === 'ATR' && (!params.period || isNaN(params.period))) params.period = 14;
    if (type === 'BBANDS') {
      if (!params.period || isNaN(params.period)) params.period = 20;
      if (!params.stdDev || isNaN(params.stdDev)) params.stdDev = 2;
    }
    if (type === 'MACD') {
      if (!params.fastPeriod || isNaN(params.fastPeriod)) params.fastPeriod = 12;
      if (!params.slowPeriod || isNaN(params.slowPeriod)) params.slowPeriod = 26;
      if (!params.signalPeriod || isNaN(params.signalPeriod)) params.signalPeriod = 9;
    }

    return { id, type, params };
  });

  if (!cloned.rules || typeof cloned.rules !== 'object') {
    cloned.rules = { entry: [], exit: [] };
  }
  if (!Array.isArray(cloned.rules.entry)) cloned.rules.entry = [];
  if (!Array.isArray(cloned.rules.exit)) cloned.rules.exit = [];

  const repairRule = (r: any, defaultLeft: string) => {
    const left = (r.leftIndicator || defaultLeft).trim();
    const op = r.operator || 'gt';
    let rightInd = r.rightIndicator ? r.rightIndicator.trim() : undefined;
    let rightVal = r.rightValue !== undefined && !isNaN(Number(r.rightValue)) ? Number(r.rightValue) : undefined;

    if (!rightInd && rightVal === undefined) {
      rightVal = 0;
    }

    return {
      id: r.id || `rule_${Math.random().toString(36).substring(2, 8)}`,
      leftIndicator: left,
      operator: op,
      ...(rightInd ? { rightIndicator: rightInd } : {}),
      ...(rightVal !== undefined ? { rightValue: rightVal } : {})
    };
  };

  if (cloned.rules.entry.length === 0) {
    const defaultLeft = cloned.indicators[0]?.id || 'close';
    cloned.rules.entry = [
      { id: 'rule_e1', leftIndicator: defaultLeft, operator: 'gt', rightValue: 50 }
    ];
  } else {
    cloned.rules.entry = cloned.rules.entry.map((r: any) => repairRule(r, cloned.indicators[0]?.id || 'close'));
  }

  cloned.rules.exit = cloned.rules.exit.map((r: any) => repairRule(r, cloned.indicators[0]?.id || 'close'));

  // Risk controls default imputation
  if (!cloned.risk || typeof cloned.risk !== 'object') {
    cloned.risk = {};
  }
  if (!cloned.risk.stopLoss || typeof cloned.risk.stopLoss !== 'object') {
    cloned.risk.stopLoss = { type: 'percent', value: 2 };
  } else {
    cloned.risk.stopLoss.type = cloned.risk.stopLoss.type || 'percent';
    cloned.risk.stopLoss.value = Number(cloned.risk.stopLoss.value) || 2;
  }

  if (cloned.risk.takeProfit) {
    cloned.risk.takeProfit = {
      type: cloned.risk.takeProfit.type || 'percent',
      value: Number(cloned.risk.takeProfit.value) || 4
    };
  } else {
    cloned.risk.takeProfit = null;
  }

  if (cloned.risk.trailingStop) {
    cloned.risk.trailingStop = {
      type: cloned.risk.trailingStop.type || 'percent',
      value: Number(cloned.risk.trailingStop.value) || 1.5,
      activation: cloned.risk.trailingStop.activation ? Number(cloned.risk.trailingStop.activation) : undefined
    };
  } else {
    cloned.risk.trailingStop = null;
  }

  if (!cloned.risk.positionSizing || typeof cloned.risk.positionSizing !== 'object') {
    cloned.risk.positionSizing = { type: 'fixedFraction', fraction: 0.1 };
  } else {
    cloned.risk.positionSizing.type = cloned.risk.positionSizing.type || 'fixedFraction';
    if (cloned.risk.positionSizing.type === 'fixedFraction') {
      cloned.risk.positionSizing.fraction = Math.min(Math.max(Number(cloned.risk.positionSizing.fraction) || 0.1, 0.01), 1.0);
    }
  }

  if (cloned.risk.maxDrawdownCutoff !== undefined && cloned.risk.maxDrawdownCutoff !== null) {
    cloned.risk.maxDrawdownCutoff = Math.min(Math.max(Number(cloned.risk.maxDrawdownCutoff) || 15, 2), 50);
  }

  // Execution & Cost defaults
  if (!cloned.execution || typeof cloned.execution !== 'object') {
    cloned.execution = { allowLong: true, allowShort: false, orderType: 'MARKET' };
  }
  if (!cloned.costs || typeof cloned.costs !== 'object') {
    cloned.costs = { slippageBps: 5, brokerageFlat: 20, tradeType: 'DELIVERY', applyIndianTaxes: true };
  }

  return cloned as StrategyAST;
}

export function validateStrategy(raw: any): { success: boolean; data?: StrategyAST; errors?: string[] } {
  try {
    const repaired = repairStrategyAST(raw);
    const parsed = StrategySchema.safeParse(repaired);
    if (parsed.success) {
      return { success: true, data: parsed.data as StrategyAST };
    }
    return {
      success: false,
      errors: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`)
    };
  } catch (err: any) {
    return {
      success: false,
      errors: [err?.message || 'Invalid strategy AST structure']
    };
  }
}
