import { z } from 'zod';

export type Timeframe = '1m' | '5m' | '15m' | '1H' | '1D' | '1W';

export type IndicatorType = 'SMA' | 'EMA' | 'RSI' | 'BBANDS' | 'MACD' | 'SUPERTREND' | 'ATR' | 'VOLUME_SMA';

export type PriceField = 'open' | 'high' | 'low' | 'close' | 'volume' | 'candleBody' | 'upperWick' | 'lowerWick';

export type RuleOperator = 'gt' | 'lt' | 'gte' | 'lte' | 'eq' | 'crossesAbove' | 'crossesBelow';

export interface IndicatorConfig {
  id: string;
  type: IndicatorType;
  params: Record<string, number>;
}

export interface RuleNode {
  id?: string;
  leftIndicator: string; // indicator ID or PriceField
  operator: RuleOperator;
  rightIndicator?: string;
  rightValue?: number;
}

export interface RiskControls {
  stopLoss: {
    type: 'percent' | 'points' | 'atr';
    value: number;
  };
  takeProfit: {
    type: 'percent' | 'points' | 'rr';
    value: number;
  } | null;
  trailingStop: {
    type: 'percent' | 'points' | 'atr';
    value: number;
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
  simulationsCount: number;
  percentileCurves: {
    p10: number[];
    p25: number[];
    p50: number[];
    p75: number[];
    p90: number[];
  };
  dates: string[];
  medianMaxDrawdown: number;
  probDrawdownOver15: number;
  probDrawdownOver25: number;
  p10TerminalEquity: number;
  p50TerminalEquity: number;
  p90TerminalEquity: number;
}

export interface TrainTestSplitResult {
  trainMetrics: {
    cagr: number;
    sharpe: number;
    maxDrawdown: number;
    winRate: number;
    profitFactor: number;
    tradesCount: number;
  };
  testMetrics: {
    cagr: number;
    sharpe: number;
    maxDrawdown: number;
    winRate: number;
    profitFactor: number;
    tradesCount: number;
  };
  cagrDecayRatio: number; // testCAGR / trainCAGR
  sharpeDecayRatio: number;
  overfittingRisk: 'LOW' | 'MODERATE' | 'HIGH';
  splitDate: string;
}

export interface SensitivityHeatmapCell {
  param1Value: number;
  param2Value: number;
  metricValue: number; // Sharpe or Net PnL %
}

export interface SensitivityHeatmapResult {
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
  initialCapital: number;
  finalEquity: number;
  netPnl: number;
  totalReturnPercent: number;
  cagr: number;
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  maxDrawdownPercent: number;
  maxDrawdownAmount: number;
  winRate: number;
  profitFactor: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  averageTradePnl: number;
  averageWin: number;
  averageLoss: number;
  winLossRatio: number;
  maxConsecutiveLosses: number;
  avgHoldingBars: number;
  benchmarkReturnPercent: number;
  alpha: number;
  beta: number;
}

export interface BacktestResponse {
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
  dataSource: 'ANGEL_ONE_SMARTAPI' | 'NSE_LIVE_RATE';
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
  ceLtp: number;
  ceChange: number;
  ceOi: number;
  ceOiChange: number;
  ceVolume: number;
  ceIv: number;
  peLtp: number;
  peChange: number;
  peOi: number;
  peOiChange: number;
  peVolume: number;
  peIv: number;
  isAtm?: boolean;
}

export interface OptionChainData {
  underlying: string;
  symbolId: number;
  spotPrice: number;
  expiryDate: string;
  availableExpiries: string[];
  totalCeOi: number;
  totalPeOi: number;
  pcr: number;
  maxPain: number;
  strikes: OptionChainStrike[];
  calculatedAt: string;
}

export interface VolumeProfileLevel {
  priceLevel: number;
  volume: number;
  buyVolume: number;
  sellVolume: number;
  percentageOfMax: number;
  isPoc: boolean;
  inValueArea: boolean;
}

export interface VolumeProfileData {
  symbolId: number;
  ticker: string;
  pocPrice: number;
  vahPrice: number;
  valPrice: number;
  totalVolume: number;
  levels: VolumeProfileLevel[];
  calculatedAt: string;
}

export interface BasisSpreadItem {
  symbolId: number;
  ticker: string;
  name: string;
  spotPrice: number;
  futuresPrice: number;
  basisPoints: number;
  basisPercent: number;
  annualizedCostOfCarry: number;
  arbitrageSignal: 'CASH_AND_CARRY' | 'REVERSE_CASH_AND_CARRY' | 'FAIR_VALUE';
  expiryDate: string;
}

export interface GttBracketConfig {
  symbolId: number;
  ticker: string;
  name: string;
  currentLtp: number;
  entryType: 'BUY' | 'SELL';
  entryTriggerPrice: number;
  targetPrice: number;
  targetPercent: number;
  stopLossPrice: number;
  stopLossPercent: number;
  riskRewardRatio: number;
  trailingStopLoss: number;
  quantity: number;
  estimatedMargin: number;
}

