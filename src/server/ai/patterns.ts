import { StrategyAST } from '../../shared/strategy/types';
import { STRATEGY_TEMPLATES } from '../../shared/strategy/templates';

export interface PatternDefinition {
  key: string;
  name: string;
  family: 'Candlestick' | 'Volatility' | 'Trend' | 'Momentum' | 'Breakout' | 'Institutional';
  direction: 'BULLISH' | 'BEARISH' | 'BOTH';
  summary: string;
  description: string;
  keywords: string[];
  templateId: string;
}

export const PATTERN_LIBRARY: PatternDefinition[] = [
  {
    key: 'nr7',
    name: 'NR7 (Narrow Range 7)',
    family: 'Volatility',
    direction: 'BOTH',
    summary: 'Toby Crabel 7-day range contraction precedes explosive volatility breakout.',
    description: 'Day with smallest daily range (High - Low) of the last 7 bars. Proxied via Bollinger Band squeeze and directional breakout.',
    keywords: ['nr7', 'narrow range', 'narrow range 7', 'range contraction', 'crabel'],
    templateId: 'nr7_volatility_compression'
  },
  {
    key: 'supertrend',
    name: 'Supertrend Trend Surfer',
    family: 'Trend',
    direction: 'BULLISH',
    summary: 'ATR-based volatility band breakout and trailing stop system.',
    description: 'Enters when close breaks above Supertrend band and 50 EMA trend filter.',
    keywords: ['supertrend', 'super trend', 'super-trend', 'st10', 'st(10,3)'],
    templateId: 'supertrend_trend_following'
  },
  {
    key: 'golden_cross',
    name: 'Golden Cross (50/200 SMA)',
    family: 'Trend',
    direction: 'BULLISH',
    summary: '50-day moving average crossing above 200-day moving average.',
    description: 'Major institutional regime shift signaling sustained multi-month bull market.',
    keywords: ['golden cross', '50 200', 'sma crossover', 'moving average crossover', 'death cross'],
    templateId: 'golden_cross_sma'
  },
  {
    key: 'rsi_oversold',
    name: 'RSI Oversold Mean Reversion',
    family: 'Momentum',
    direction: 'BULLISH',
    summary: 'RSI dropping below 30 in an overarching bull trend to buy extreme dips.',
    description: 'Identifies washed-out selling climax on high-quality index constituents.',
    keywords: ['rsi', 'oversold', 'mean reversion', 'relative strength', 'rsi 30', 'bounce'],
    templateId: 'rsi_mean_reversion'
  },
  {
    key: 'bollinger_squeeze',
    name: 'Bollinger Band Squeeze',
    family: 'Volatility',
    direction: 'BULLISH',
    summary: 'Extreme volatility contraction followed by upper band expansion breakout.',
    description: 'Standard deviation bandwidth compression signaling impending directional momentum.',
    keywords: ['bollinger', 'bbands', 'squeeze', 'volatility squeeze', 'band breakout'],
    templateId: 'bollinger_squeeze_breakout'
  },
  {
    key: 'macd_acceleration',
    name: 'MACD Momentum Acceleration',
    family: 'Momentum',
    direction: 'BULLISH',
    summary: 'MACD line crossing above Signal line with positive histogram confirmation.',
    description: 'Standard Gerald Appel momentum oscillator timing trend acceleration.',
    keywords: ['macd', 'macd crossover', 'histogram', 'signal line'],
    templateId: 'macd_momentum_crossover'
  },
  {
    key: 'atr_breakout',
    name: 'ATR Volatility Channel Breakout',
    family: 'Breakout',
    direction: 'BULLISH',
    summary: 'Price breaking out beyond ATR envelope with candlestick body expansion.',
    description: 'Captures momentum bursts with adaptive ATR trailing stop protections.',
    keywords: ['atr', 'atr breakout', 'keltner', 'volatility breakout'],
    templateId: 'atr_volatility_breakout'
  }
];

export function detectPatternFromPrompt(prompt: string): PatternDefinition | null {
  const lower = prompt.toLowerCase();
  for (const pattern of PATTERN_LIBRARY) {
    for (const kw of pattern.keywords) {
      if (lower.includes(kw)) {
        return pattern;
      }
    }
  }
  return null;
}
