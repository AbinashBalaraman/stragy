import { StrategyAST } from './types';
import { getSymbolByTicker } from '../data/symbols';

const defaultInstrument = getSymbolByTicker('RELIANCE');
if (!defaultInstrument) throw new Error('Template instrument RELIANCE is unavailable');
const DEFAULT_SYMBOL_ID = defaultInstrument.id;

export interface StrategyTemplateItem {
  id: string;
  name: string;
  category: 'Trend Following' | 'Mean Reversion' | 'Momentum' | 'Breakout' | 'Volatility' | 'Institutional';
  description: string;
  suitability: string;
  expectedWinRate: string;
  strategy: StrategyAST;
}

export const STRATEGY_TEMPLATES: StrategyTemplateItem[] = [
  {
    id: 'reliance_supertrend_ema_volume',
    name: 'Reliance Supertrend + EMA + Volume Expansion',
    category: 'Trend Following',
    description: 'Buys while price is above Supertrend and the 200-day average with volume above normal; exits below Supertrend.',
    suitability: 'Reliance and other high-beta Indian large caps',
    expectedWinRate: 'Unverified; run an immutable data snapshot',
    strategy: {
      name: 'Reliance Supertrend + EMA + Volume Expansion',
      description: 'Supertrend(10,3) bullish signal above 200 EMA with 20-day volume expansion and dynamic trailing stop.',
      version: 1,
      universe: { symbolId: DEFAULT_SYMBOL_ID, timeframe: '1D' },
      indicators: [
        { id: 'st1', type: 'SUPERTREND', params: { period: 10, multiplier: 3 } },
        { id: 'ema200', type: 'EMA', params: { period: 200 } },
        { id: 'vol_sma_20', type: 'VOLUME_SMA', params: { period: 20 } }
      ],
      rules: {
        entry: [
          { id: 'r1', leftIndicator: 'close', operator: 'gt', rightIndicator: 'st1' },
          { id: 'r2', leftIndicator: 'close', operator: 'gt', rightIndicator: 'ema200' },
          { id: 'r3', leftIndicator: 'volume', operator: 'gt', rightIndicator: 'vol_sma_20' }
        ],
        exit: [
          { id: 'r4', leftIndicator: 'close', operator: 'lt', rightIndicator: 'st1' }
        ]
      },
      risk: {
        stopLoss: { type: 'percent', value: 3.5 },
        takeProfit: { type: 'percent', value: 14.0 },
        trailingStop: { type: 'percent', value: 2.5 },
        positionSizing: { type: 'fixedFraction', fraction: 0.15 },
        maxDrawdownCutoff: 12
      },
      execution: { allowLong: true, allowShort: false, orderType: 'MARKET' },
      costs: { slippageBps: 5, brokerageFlat: 20, tradeType: 'DELIVERY', applyIndianTaxes: true }
    }
  },
  {
    id: 'supertrend_trend_following',
    name: 'Supertrend Trend Surfer',
    category: 'Trend Following',
    description: 'Follows Supertrend while price stays above the 50-day average, with an ATR trailing stop.',
    suitability: 'High-beta trending stocks (Reliance, Tata Motors, Bank Nifty)',
    expectedWinRate: 'Unverified; run an immutable data snapshot',
    strategy: {
      name: 'Supertrend Trend Surfer',
      description: 'Supertrend(10,3) bullish signal above 50 EMA with ATR trailing stop.',
      version: 1,
      universe: { symbolId: DEFAULT_SYMBOL_ID, timeframe: '1D' },
      indicators: [
        { id: 'st1', type: 'SUPERTREND', params: { period: 10, multiplier: 3 } },
        { id: 'ema50', type: 'EMA', params: { period: 50 } },
        { id: 'atr14', type: 'ATR', params: { period: 14 } }
      ],
      rules: {
        entry: [
          { id: 'r1', leftIndicator: 'close', operator: 'gt', rightIndicator: 'st1' },
          { id: 'r2', leftIndicator: 'close', operator: 'gt', rightIndicator: 'ema50' }
        ],
        exit: [
          { id: 'r3', leftIndicator: 'close', operator: 'lt', rightIndicator: 'st1' }
        ]
      },
      risk: {
        stopLoss: { type: 'percent', value: 2.0 },
        takeProfit: { type: 'percent', value: 6.0 },
        trailingStop: { type: 'atr', value: 1.8 },
        positionSizing: { type: 'fixedFraction', fraction: 0.15 },
        maxDrawdownCutoff: 15
      },
      execution: { allowLong: true, allowShort: false, orderType: 'MARKET' },
      costs: { slippageBps: 5, brokerageFlat: 20, tradeType: 'DELIVERY', applyIndianTaxes: true }
    }
  },
  {
    id: 'golden_cross_sma',
    name: 'Classic Golden Cross & Volume',
    category: 'Trend Following',
    description: 'Buys when the 50-day average crosses above the 200-day average with volume expansion.',
    suitability: 'Long-term equity compounding & swing trading',
    expectedWinRate: 'Unverified; run an immutable data snapshot',
    strategy: {
      name: 'Classic Golden Cross & Volume',
      description: '50 SMA crosses above 200 SMA with trailing protection.',
      version: 1,
      universe: { symbolId: DEFAULT_SYMBOL_ID, timeframe: '1D' },
      indicators: [
        { id: 'sma50', type: 'SMA', params: { period: 50 } },
        { id: 'sma200', type: 'SMA', params: { period: 200 } }
      ],
      rules: {
        entry: [
          { id: 'r1', leftIndicator: 'sma50', operator: 'crossesAbove', rightIndicator: 'sma200' },
          { id: 'r2', leftIndicator: 'close', operator: 'gt', rightIndicator: 'sma50' }
        ],
        exit: [
          { id: 'r3', leftIndicator: 'sma50', operator: 'crossesBelow', rightIndicator: 'sma200' }
        ]
      },
      risk: {
        stopLoss: { type: 'percent', value: 3.5 },
        takeProfit: { type: 'percent', value: 12.0 },
        trailingStop: { type: 'percent', value: 2.5 },
        positionSizing: { type: 'fixedFraction', fraction: 0.2 },
        maxDrawdownCutoff: 18
      },
      execution: { allowLong: true, allowShort: false, orderType: 'MARKET' },
      costs: { slippageBps: 5, brokerageFlat: 20, tradeType: 'DELIVERY', applyIndianTaxes: true }
    }
  },
  {
    id: 'rsi_mean_reversion',
    name: 'RSI Dynamic Mean Reversion',
    category: 'Mean Reversion',
    description: 'Buys oversold pullbacks (RSI below 32) while price is above the 100-day average; exits when RSI is above 68.',
    suitability: 'Consolidating and range-bound indices (Nifty 50, HDFC Bank, TCS)',
    expectedWinRate: 'Unverified; run an immutable data snapshot',
    strategy: {
      name: 'RSI Dynamic Mean Reversion',
      description: 'Enters when RSI(14) < 32 in an overarching bull trend, exits when RSI > 68.',
      version: 1,
      universe: { symbolId: DEFAULT_SYMBOL_ID, timeframe: '1D' },
      indicators: [
        { id: 'rsi14', type: 'RSI', params: { period: 14 } },
        { id: 'sma100', type: 'SMA', params: { period: 100 } }
      ],
      rules: {
        entry: [
          { id: 'r1', leftIndicator: 'rsi14', operator: 'lt', rightValue: 32 },
          { id: 'r2', leftIndicator: 'close', operator: 'gt', rightIndicator: 'sma100' }
        ],
        exit: [
          { id: 'r3', leftIndicator: 'rsi14', operator: 'gt', rightValue: 68 }
        ]
      },
      risk: {
        stopLoss: { type: 'percent', value: 2.5 },
        takeProfit: { type: 'percent', value: 4.5 },
        trailingStop: null,
        positionSizing: { type: 'fixedFraction', fraction: 0.15 },
        maxDrawdownCutoff: 12
      },
      execution: { allowLong: true, allowShort: false, orderType: 'MARKET' },
      costs: { slippageBps: 5, brokerageFlat: 20, tradeType: 'DELIVERY', applyIndianTaxes: true }
    }
  },
  {
    id: 'bollinger_squeeze_breakout',
    name: 'Bollinger Band Squeeze Breakout',
    category: 'Volatility',
    description: 'Buys when price closes above the upper Bollinger band with an expanding candle body.',
    suitability: 'High volatility breakouts & earning season swings',
    expectedWinRate: 'Unverified; run an immutable data snapshot',
    strategy: {
      name: 'Bollinger Band Squeeze Breakout',
      description: 'Price crosses above Upper Band with candleBody > 0 expansion.',
      version: 1,
      universe: { symbolId: DEFAULT_SYMBOL_ID, timeframe: '1D' },
      indicators: [
        { id: 'bb20', type: 'BBANDS', params: { period: 20, stdDev: 2 } },
        { id: 'ema20', type: 'EMA', params: { period: 20 } }
      ],
      rules: {
        entry: [
          { id: 'r1', leftIndicator: 'close', operator: 'crossesAbove', rightIndicator: 'bb20_upper' },
          { id: 'r2', leftIndicator: 'candleBody', operator: 'gt', rightValue: 0 }
        ],
        exit: [
          { id: 'r3', leftIndicator: 'close', operator: 'crossesBelow', rightIndicator: 'bb20_middle' }
        ]
      },
      risk: {
        stopLoss: { type: 'percent', value: 2.2 },
        takeProfit: { type: 'percent', value: 7.0 },
        trailingStop: { type: 'percent', value: 2.0 },
        positionSizing: { type: 'fixedFraction', fraction: 0.12 },
        maxDrawdownCutoff: 15
      },
      execution: { allowLong: true, allowShort: false, orderType: 'MARKET' },
      costs: { slippageBps: 5, brokerageFlat: 20, tradeType: 'DELIVERY', applyIndianTaxes: true }
    }
  },
  {
    id: 'macd_momentum_crossover',
    name: 'MACD Zero-Line Acceleration',
    category: 'Momentum',
    description: 'Buys when the MACD line crosses above its signal line; an ATR stop trails the move.',
    suitability: 'Mid-cap and sector momentum runners',
    expectedWinRate: 'Unverified; run an immutable data snapshot',
    strategy: {
      name: 'MACD Zero-Line Acceleration',
      description: 'MACD Line crosses above Signal Line while MACD Histogram is positive.',
      version: 1,
      universe: { symbolId: DEFAULT_SYMBOL_ID, timeframe: '1D' },
      indicators: [
        { id: 'macd1', type: 'MACD', params: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 } },
        { id: 'ema20', type: 'EMA', params: { period: 20 } }
      ],
      rules: {
        entry: [
          { id: 'r1', leftIndicator: 'macd1_line', operator: 'crossesAbove', rightIndicator: 'macd1_signal' },
          { id: 'r2', leftIndicator: 'macd1_hist', operator: 'gt', rightValue: 0 }
        ],
        exit: [
          { id: 'r3', leftIndicator: 'macd1_line', operator: 'crossesBelow', rightIndicator: 'macd1_signal' }
        ]
      },
      risk: {
        stopLoss: { type: 'percent', value: 2.0 },
        takeProfit: { type: 'percent', value: 5.5 },
        trailingStop: { type: 'percent', value: 1.8 },
        positionSizing: { type: 'fixedFraction', fraction: 0.15 },
        maxDrawdownCutoff: 14
      },
      execution: { allowLong: true, allowShort: false, orderType: 'MARKET' },
      costs: { slippageBps: 5, brokerageFlat: 20, tradeType: 'DELIVERY', applyIndianTaxes: true }
    }
  },
  {
    id: 'atr_volatility_breakout',
    name: 'ATR Keltner Breakout & Channel Surfer',
    category: 'Breakout',
    description: 'Buys when price breaks above the 20-day average plus two ATRs, with a trailing stop.',
    suitability: 'High-momentum Indian market breakouts',
    expectedWinRate: 'Unverified; run an immutable data snapshot',
    strategy: {
      name: 'ATR Volatility Breakout',
      description: 'Close breaks above 20 EMA + 2x ATR(14) volatility expansion.',
      version: 1,
      universe: { symbolId: DEFAULT_SYMBOL_ID, timeframe: '1D' },
      indicators: [
        { id: 'ema20', type: 'EMA', params: { period: 20 } },
        { id: 'atr14', type: 'ATR', params: { period: 14 } }
      ],
      rules: {
        entry: [
          { id: 'r1', leftIndicator: 'close', operator: 'gt', rightIndicator: 'ema20' },
          { id: 'r2', leftIndicator: 'upperWick', operator: 'lt', rightIndicator: 'candleBody' }
        ],
        exit: [
          { id: 'r3', leftIndicator: 'close', operator: 'lt', rightIndicator: 'ema20' }
        ]
      },
      risk: {
        stopLoss: { type: 'percent', value: 2.5 },
        takeProfit: { type: 'percent', value: 8.0 },
        trailingStop: { type: 'atr', value: 2.0 },
        positionSizing: { type: 'fixedFraction', fraction: 0.1 },
        maxDrawdownCutoff: 12
      },
      execution: { allowLong: true, allowShort: false, orderType: 'MARKET' },
      costs: { slippageBps: 5, brokerageFlat: 20, tradeType: 'DELIVERY', applyIndianTaxes: true }
    }
  },
  {
    id: 'nr7_volatility_compression',
    name: 'NR7 Volatility Compression Breakout',
    category: 'Volatility',    description: 'Buys a narrow-range (NR7) breakout after a Bollinger squeeze.',
    suitability: 'NSE Intraday & Next-Day swing volatility expansion',
    expectedWinRate: 'Unverified; run an immutable data snapshot',
    strategy: {
      name: 'NR7 Volatility Compression Breakout',
      description: 'Narrow range contraction leading into an explosive directional breakout.',
      version: 1,
      universe: { symbolId: DEFAULT_SYMBOL_ID, timeframe: '1D' },
      indicators: [
        { id: 'bb1', type: 'BBANDS', params: { period: 20, stdDev: 2 } },
        { id: 'ema20', type: 'EMA', params: { period: 20 } },
        { id: 'rsi14', type: 'RSI', params: { period: 14 } }
      ],
      rules: {
        entry: [
          { id: 'r1', leftIndicator: 'close', operator: 'crossesAbove', rightIndicator: 'bb1_upper' },
          { id: 'r2', leftIndicator: 'rsi14', operator: 'gt', rightValue: 50 }
        ],
        exit: [
          { id: 'r3', leftIndicator: 'close', operator: 'crossesBelow', rightIndicator: 'bb1_middle' }
        ]
      },
      risk: {
        stopLoss: { type: 'percent', value: 1.8 },
        takeProfit: { type: 'percent', value: 5.0 },
        trailingStop: { type: 'percent', value: 1.5 },
        positionSizing: { type: 'fixedFraction', fraction: 0.15 },
        maxDrawdownCutoff: 10
      },
      execution: { allowLong: true, allowShort: false, orderType: 'MARKET' },
      costs: { slippageBps: 5, brokerageFlat: 20, tradeType: 'DELIVERY', applyIndianTaxes: true }
    }
  },
  {
    id: 'rsi_trendline_breakout_near_lows',
    name: 'RSI Downtrend-Line Breakout Near Lows',
    category: 'Mean Reversion',
    description: 'Buys when RSI recovers from below 36, breaks its falling trendline, and price sits near a 250-day low.',
    suitability: 'Daily NIFTY 50 equities in a long downtrend showing an early RSI momentum turn',
    expectedWinRate: 'Unverified; run an immutable data snapshot',
    strategy: {
      name: 'RSI Downtrend-Line Breakout Near Lows',
      description: 'RSI(14) < 36 recently, then closes above a causal falling RSI trendline and above its RSI signal SMA, with price within 15% of its 250-bar low and a 126-bar change below 5%.',
      version: 1,
      universe: { symbolId: DEFAULT_SYMBOL_ID, timeframe: '1D' },
      indicators: [
        { id: 'rsi14', type: 'RSI', params: { period: 14 } },
        { id: 'rsi_sma14', type: 'RSI_SMA', params: { rsiPeriod: 14, period: 14 } },
        { id: 'rsi_tl', type: 'RSI_TRENDLINE', params: { rsiPeriod: 14, minSpan: 30, maxSpan: 180, anchorMin: 60 } },
        { id: 'low250', type: 'PCT_ABOVE_LOW', params: { period: 250 } },
        { id: 'chg126', type: 'PCT_CHANGE', params: { period: 126 } }
      ],
      rules: {
        entry: [
          { id: 'r1', leftIndicator: 'rsi14', operator: 'lt', rightValue: 36, lookback: { bars: 10, includeCurrent: false, match: 'any' } },
          { id: 'r2', leftIndicator: 'rsi14', operator: 'crossesAbove', rightIndicator: 'rsi_tl_line' },
          { id: 'r3', leftIndicator: 'rsi14', operator: 'lt', rightIndicator: 'rsi_tl_line', lookback: { bars: 3, includeCurrent: false, match: 'any' } },
          { id: 'r4', leftIndicator: 'rsi14', operator: 'gt', rightIndicator: 'rsi_sma14' },
          { id: 'r5', leftIndicator: 'low250', operator: 'lt', rightValue: 15 },
          { id: 'r6', leftIndicator: 'chg126', operator: 'lt', rightValue: 5 }
        ],
        exit: [
          { id: 'r7', leftIndicator: 'rsi14', operator: 'gt', rightValue: 65 }
        ]
      },
      risk: {
        stopLoss: { type: 'percent', value: 2.5 },
        takeProfit: { type: 'percent', value: 7.0 },
        trailingStop: null,
        positionSizing: { type: 'fixedFraction', fraction: 0.15 },
        maxDrawdownCutoff: 12
      },
      execution: { allowLong: true, allowShort: false, orderType: 'MARKET' },
      costs: { slippageBps: 5, brokerageFlat: 20, tradeType: 'DELIVERY', applyIndianTaxes: true }
    }
  }
];
