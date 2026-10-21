import { z } from 'zod';
import type { InstrumentMetadataSchema } from '../contracts/strategy-v2';

export type Timeframe = '1m' | '5m' | '15m' | '1H' | '1D' | '1W';

export type IndicatorType = 'SMA' | 'EMA' | 'RSI' | 'BBANDS' | 'MACD' | 'SUPERTREND' | 'ATR' | 'VOLUME_SMA';

export type PriceField = 'open' | 'high' | 'low' | 'close' | 'volume' | 'candleBody' | 'upperWick' | 'lowerWick';

export type RuleOperator = 'gt' | 'lt' | 'gte' | 'lte' | 'eq' | 'approxEq' | 'crossesAbove' | 'crossesBelow';

export interface IndicatorConfig {
  id: string;
  type: IndicatorType;
  params: Record<string, number>;
}

/** Any match in the preceding completed bars, never including the decision bar. */
export interface RuleLookback {
  bars: number; // integer 1..252
  includeCurrent: false;
  match: 'any';
}

export interface RuleNode {
  lookback?: RuleLookback;
  id?: string;
  leftIndicator: string; // indicator ID or PriceField
  leftValue?: number;
  absoluteTolerance?: number;
  equality?: 'exact';
  operator: RuleOperator;
  rightIndicator?: string;
  rightValue?: number;
}

export interface RiskControls {
  stopLoss: {
    type: 'percent' | 'points' | 'atr';
    value: number;
    atrPeriod?: number;
  };
  takeProfit: {
    type: 'percent' | 'points' | 'rr';
    value: number;
  } | null;
  trailingStop: {
    type: 'percent' | 'points' | 'atr';
    value: number;
    atrPeriod?: number;
    activation?: number;
  } | null;
  positionSizing: {
    type: 'fixedFraction' | 'fixedQty' | 'fixedRisk';
    fraction?: number;
    quantity?: number;
    riskPerTrade?: number;
  };
  maxDrawdownCutoff?: number | null; // e.g. 10%
}

export interface ExecutionConfig {
  allowLong: boolean;
  allowShort: boolean;
  orderType: 'MARKET' | 'LIMIT';
  liquidateAtEnd?: boolean;
  executionPolicy?: 'next_open_long_cash_v1';
  intradaySquareOffTime?: string; // '15:15'
}

export interface CostModelConfig {
  slippageBps: number;
  brokerageFlat: number;
  tradeType: 'DELIVERY' | 'INTRADAY';
  applyIndianTaxes: boolean;
}

export interface StrategyUniverse {
  symbolId: number;
  instrumentId?: string;
  /** Descriptive, unverified instrument metadata. quantityStep constrains research sizing. */
  metadata?: z.infer<typeof InstrumentMetadataSchema>;
  ticker?: string;
  timeframe: Timeframe;
}

export interface StrategyAST {
  id?: string;
  name: string;
  description?: string;
  version: number;
  universe: StrategyUniverse;
  indicators: IndicatorConfig[];
  rules: {
    entry: RuleNode[];
    exit: RuleNode[];
  };
  risk: RiskControls;
  execution: ExecutionConfig;
  costs: CostModelConfig;
}

export interface OHLCVBar {
  date: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface SymbolMeta {
  id: number;
  ticker: string;
  name: string;
  exchange: 'NSE' | 'BSE';
  sector: string;
  lotSize?: number;
  currentPrice: number;
  changePercent: number;
  indices?: string[];
}

export interface TradeRecord {
  id: string;
  entryDate: string;
  entryTimestamp: number;
  entryPrice: number;
  exitDate: string;
  exitTimestamp: number;
  exitPrice: number;
  direction: 'LONG' | 'SHORT';
  quantity: number;
  pnl: number;
  pnlPercent: number;
  holdingDays: number;
  holdingBars?: number;
  exitReason: 'STOP_LOSS' | 'TAKE_PROFIT' | 'TRAILING_STOP' | 'RULE_EXIT' | 'MAX_DRAWDOWN' | 'END_OF_DATA';
  costs: number;
  netPnl: number;
}

export interface EquityPoint {
  date: string;
  timestamp: number;
  equity: number;
  drawdown: number;
  drawdownPercent: number;
  benchmarkEquity: number;
}

export interface IndianCostBreakdown {
  brokerage: number;
  stt: number;
  exchangeTxnCharges: number;
  sebiCharges: number;
  stampDuty: number;
  gst: number;
  slippage: number;
  totalCharges: number;
  turnover: number;
}

export interface MonteCarloResult {
  status?: 'available' | 'unavailable';
  reason?: string;
  seed?: number;
  method?: string;
  simulationsCount: number;
  percentileCurves: {
    p10: number[];
    p25: number[];
    p50: number[];
    p75: number[];
    p90: number[];
  };
  dates: string[];
  medianMaxDrawdown: number | null;
  probDrawdownOver15: number | null;
  probDrawdownOver25: number | null;
  p10TerminalEquity: number | null;
  p50TerminalEquity: number | null;
  p90TerminalEquity: number | null;
}

export interface TrainTestSplitResult {
  status?: 'available' | 'unavailable';
  reason?: string;
  method?: string;
  trainMetrics: {
    cagr: number | null;
    sharpe: number | null;
    maxDrawdown: number;
    winRate: number | null;
    profitFactor: number | null;
    tradesCount: number;
  };
  testMetrics: {
    cagr: number | null;
    sharpe: number | null;
    maxDrawdown: number;
    winRate: number | null;
    profitFactor: number | null;
    tradesCount: number;
  };
  cagrDecayRatio: number | null; // testCAGR / trainCAGR
  sharpeDecayRatio: number | null;
  overfittingRisk: 'LOW' | 'MODERATE' | 'HIGH' | 'UNAVAILABLE';
  splitDate: string;
}

export interface SensitivityHeatmapCell {
  reason?: string;
  param1Value: number;
  param2Value: number;
  metricValue: number | null; // Sharpe or Net PnL %
}

export interface SensitivityHeatmapResult {
  status?: 'available' | 'unavailable';
  reason?: string;
  metric?: string;
  param1Name: string;
  param1Values: number[];
  param2Name: string;
  param2Values: number[];
  matrix: SensitivityHeatmapCell[][];
}

export interface RobustnessSuite {
  monteCarlo: MonteCarloResult;
  trainTestSplit: TrainTestSplitResult;
  sensitivityHeatmap: SensitivityHeatmapResult;
}

export interface BacktestMetrics {
  unavailableReasons?: Record<string, string>;
  initialCapital: number;
  finalEquity: number;
  netPnl: number;
  totalReturnPercent: number;
  cagr: number | null;
  sharpeRatio: number | null;
  sortinoRatio: number | null;
  calmarRatio: number | null;
  maxDrawdownPercent: number;
  maxDrawdownAmount: number;
  winRate: number | null;
  profitFactor: number | null;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  averageTradePnl: number;
  averageWin: number;
  averageLoss: number;
  winLossRatio: number | null;
  maxConsecutiveLosses: number;
  avgHoldingBars: number;
  benchmarkReturnPercent: number;
  alpha: number | null;
  beta: number | null;
}

export interface BacktestResponse {
  engineVersion?: string;
  executionPolicy?: string;
  warnings?: string[];
  provenance?: unknown;
  manifest?: unknown;
  ledger?: { timestamp: number; side: string; quantity: number; price: number; fees: number; cash: number }[];
  reconciliation?: { expectedEquity: number; actualEquity: number; difference: number };
  backtestId: string;
  strategy: StrategyAST;
  symbol: SymbolMeta;
  metrics: BacktestMetrics;
  equityCurve: EquityPoint[];
  trades: TradeRecord[];
  costs: IndianCostBreakdown;
  robustness: RobustnessSuite;
  indicatorsData: Record<string, (number | null)[]>;
  bars: OHLCVBar[];
  executedAt: string;
}

export interface StockTrendData {
  id: number;
  ticker: string;
  name: string;
  sector: string;
  ltp: number;
  changePercent: number;
  high: number;
  low: number;
  volume: number;
  avg20Volume: number;
  volumeRatio: number;
  fiftyTwoWeekHigh: number;
  fiftyTwoWeekLow: number;
  distFrom52WHigh: number;
  distFrom52WLow: number;
  rsi: number;
  ema20: number;
  sma50: number;
  sma200: number;
  trend: 'STRONG_BULLISH' | 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'OVERSOLD_REVERSAL';
  trendLabel: string;
  momentumScore: number;
  signal: 'BUY_BREAKOUT' | 'PULLBACK_ENTRY' | 'OVERSOLD_RSI' | 'GOLDEN_CROSS' | 'NEUTRAL';
  signalLabel: string;
  openInterest: number;
  oiChangePercent: number;
  oiInterpretation: 'LONG_BUILDUP' | 'SHORT_COVERING' | 'SHORT_BUILDUP' | 'LONG_UNWINDING';
  pcrRatio: number;
  dataSource: 'DEMO_MODEL' | 'OHLCV_ANALYSIS';
  exchange?: 'NSE' | 'BSE';
  indices?: string[];
  date?: string;
  formattedDate?: string;
  timestamp?: number;
}

export interface MarketMoversData {
  universe?: string;
  asOfDate: string;
  formattedDate: string;
  isHistorical?: boolean;
  availableTradingSessions?: { date: string; label: string; isLatest: boolean }[];
  totalFilteredCount?: number;
  topGainers: StockTrendData[];
  topLosers: StockTrendData[];
  volumeShockers: StockTrendData[];
  nearFiftyTwoWeekHigh: StockTrendData[];
  nearFiftyTwoWeekLow: StockTrendData[];
  derivativesBuildup: {
    longBuildup: StockTrendData[];
    shortCovering: StockTrendData[];
    shortBuildup: StockTrendData[];
    longUnwinding: StockTrendData[];
  };
  marketBreadth: {
    advances: number;
    declines: number;
    unchanged: number;
    advanceDeclineRatio: number;
    bullishPercent: number;
  };
  sectorHeatmap: {
    sector: string;
    avgChangePercent: number;
    count: number;
    advances: number;
    declines: number;
  }[];
}

export interface ScanMatchResult {
  symbolId: number;
  ticker: string;
  name: string;
  sector: string;
  lastDate: string;
  lastClose: number;
  changePercent: number;
  matchedRules: {
    rule: string;
    actualLeft: number;
    actualRight: number;
  }[];
  indicatorValues: Record<string, number>;
}

export interface UniverseScanResponse {
  universe: string;
  scanned: number;
  matched: number;
  scannedAt: string;
  dataSource: string;
  matches: ScanMatchResult[];
}

export interface OptionChainStrike {
  strikePrice: number;
  isAtm?: boolean;
  straddlePrice?: number;
  call: {
    ltp: number;
    change: number;
    iv: number;
    delta?: number;
    gamma?: number;
    theta?: number;
    vega?: number;
    oi: number;
    oiChange: number;
    volume: number;
    bid?: number;
    ask?: number;
  };
  put: {
    ltp: number;
    change: number;
    iv: number;
    delta?: number;
    gamma?: number;
    theta?: number;
    vega?: number;
    oi: number;
    oiChange: number;
    volume: number;
    bid?: number;
    ask?: number;
  };
}

export interface OptionChainData {
  symbol: string;
  ticker: string;
  spotPrice: number;
  expiry: string;
  atmStrike: number;
  totalCallOI: number;
  totalPutOI: number;
  pcr: number;
  maxPainStrike: number;
  atmIV: number;
  ivRank?: number;
  strikes: OptionChainStrike[];
}

export interface VolumeProfileLevel {
  price: number;
  buyVol: number;
  sellVol: number;
  totalVol: number;
  pctOfTotal: number;
  isPOC: boolean;
  inValueArea: boolean;
}

export interface VolumeProfileData {
  symbol: string;
  ticker: string;
  spotPrice: number;
  pocPrice: number;
  vahPrice: number;
  valPrice: number;
  vwap: number;
  stdDev1Upper: number;
  stdDev1Lower: number;
  stdDev2Upper: number;
  stdDev2Lower: number;
  stdDev3Upper: number;
  stdDev3Lower: number;
  totalSessionVolume: number;
  buyPressurePct: number;
  marketRegime: string;
  profileLevels: VolumeProfileLevel[];
}

export interface BasisSpreadItem {
  ticker: string;
  name: string;
  lotSize: number;
  cashLtp: number;
  nearFutLtp: number;
  nextFutLtp: number;
  nearBasisInr: number;
  nearBasisPct: number;
  calendarSpreadInr: number;
  calendarSpreadPct: number;
  annualizedYieldPct: number;
  state: 'CONTANGO' | 'BACKWARDATION';
  arbitrageSignal: string;
}

export interface GttBracketConfig {
  symbol: string;
  ticker: string;
  spotPrice: number;
  action: 'BUY' | 'SELL';
  capitalAllocated: number;
  qty: number;
  entryPrice: number;
  stopLossPrice: number;
  stopLossAmountInr: number;
  stopLossPct: number;
  targetPrice: number;
  targetAmountInr: number;
  targetPct: number;
  trailingStopLossStep: number;
  trailingJumpPct: number;
  riskRewardRatio: number;
  smartApiPayload: any;
}

