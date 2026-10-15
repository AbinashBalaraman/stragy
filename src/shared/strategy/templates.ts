import { StrategyAST } from './types';

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
    description: 'Institutional trend-following breakout: Supertrend (10, 3) confirmed with 200 EMA regime filter and 20 Volume SMA expansion.',
    suitability: 'Reliance (RELIANCE.NSE) & high-beta Indian market blue-chips',
    expectedWinRate: '58% - 68% (High Profit Factor)',
    strategy: {
      name: 'Reliance Supertrend + EMA + Volume Expansion',
      description: 'Supertrend(10,3) bullish signal above 200 EMA with 20-day volume expansion and dynamic trailing stop.',
      version: 1,
      universe: { symbolId: 1, timeframe: '1D' },
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
    description: 'Rides sustained momentum on NSE large caps using Supertrend(10, 3) confirmed with 50 EMA trend filter.',
    suitability: 'High-beta trending stocks (Reliance, Tata Motors, Bank Nifty)',
    expectedWinRate: '48% - 55% (High Profit Factor)',
    strategy: {
      name: 'Supertrend Trend Surfer',
      description: 'Supertrend(10,3) bullish signal above 50 EMA with ATR trailing stop.',
      version: 1,
      universe: { symbolId: 1, timeframe: '1D' },
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
    description: 'Canonical institutional regime filter: 50 SMA crosses above 200 SMA with volume expansion.',
    suitability: 'Long-term equity compounding & swing trading',
    expectedWinRate: '52% - 60%',
    strategy: {
      name: 'Classic Golden Cross & Volume',
      description: '50 SMA crosses above 200 SMA with trailing protection.',
      version: 1,
      universe: { symbolId: 1, timeframe: '1D' },
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
    description: 'Catches oversold bounces (RSI < 30) on premier blue-chip constituents when above long-term 100 SMA.',
    suitability: 'Consolidating and range-bound indices (Nifty 50, HDFC Bank, TCS)',
    expectedWinRate: '65% - 74%',
    strategy: {
      name: 'RSI Dynamic Mean Reversion',
      description: 'Enters when RSI(14) < 32 in an overarching bull trend, exits when RSI > 68.',
      version: 1,
      universe: { symbolId: 1, timeframe: '1D' },
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
    description: 'Detects volatility compression and explosive breakouts with candlestick body confirmation.',
    suitability: 'High volatility breakouts & earning season swings',
    expectedWinRate: '45% - 53%',
    strategy: {
      name: 'Bollinger Band Squeeze Breakout',
      description: 'Price crosses above Upper Band with candleBody > 0 expansion.',
      version: 1,
      universe: { symbolId: 1, timeframe: '1D' },
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
    description: 'Signals trend acceleration when MACD Line crosses Signal above Zero Line with ATR volatility stop.',
    suitability: 'Mid-cap and sector momentum runners',
    expectedWinRate: '50% - 58%',
    strategy: {
      name: 'MACD Zero-Line Acceleration',
      description: 'MACD Line crosses above Signal Line while MACD Histogram is positive.',
      version: 1,
      universe: { symbolId: 1, timeframe: '1D' },
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
    description: 'Enters when close breaks above ATR-based volatility envelope with strict trailing stop.',
    suitability: 'High-momentum Indian market breakouts',
    expectedWinRate: '46% - 54%',
    strategy: {
      name: 'ATR Volatility Breakout',
      description: 'Close breaks above 20 EMA + 2x ATR(14) volatility expansion.',
      version: 1,
      universe: { symbolId: 1, timeframe: '1D' },
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
    category: 'Institutional',
    description: 'Toby Crabel Narrow Range 7 (NR7) daily compression proxy using Bollinger squeeze and breakout.',
    suitability: 'NSE Intraday & Next-Day swing volatility expansion',
    expectedWinRate: '56% - 64%',
    strategy: {
      name: 'NR7 Volatility Compression Breakout',
      description: 'Narrow range contraction leading into an explosive directional breakout.',
      version: 1,
      universe: { symbolId: 1, timeframe: '1D' },
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
  }
];
