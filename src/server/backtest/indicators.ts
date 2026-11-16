import { OHLCVBar, IndicatorConfig } from '../../shared/strategy/types';
import { IndicatorV2Schema, RESERVED_SERIES, legacyOutputNames } from '../../shared/strategy/registry';
function validPeriod(period: number): void { if (!Number.isInteger(period) || period < 1 || period > 10000) throw new Error('INVALID_INDICATOR_PERIOD'); }


export function calcSMA(bars: OHLCVBar[], period: number): (number | null)[] {
  validPeriod(period);
  const result: (number | null)[] = new Array(bars.length).fill(null);
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    sum += bars[i].close;
    if (i >= period - 1) {
      if (i >= period) {
        sum -= bars[i - period].close;
      }
      result[i] = sum / period;
    }
  }
  return result;
}

export function calcEMA(bars: OHLCVBar[], period: number): (number | null)[] {
  validPeriod(period);
  const result: (number | null)[] = new Array(bars.length).fill(null);
  if (bars.length < period) return result;

  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += bars[i].close;
  }
  let prevEma = sum / period;
  result[period - 1] = prevEma;

  for (let i = period; i < bars.length; i++) {
    const currentEma = bars[i].close * k + prevEma * (1 - k);
    result[i] = currentEma;
    prevEma = currentEma;
  }
  return result;
}

export function calcRSI(bars: OHLCVBar[], period: number = 14): (number | null)[] {
  validPeriod(period);
  const result: (number | null)[] = new Array(bars.length).fill(null);
  if (bars.length <= period) return result;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const change = bars[i].close - bars[i - 1].close;
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  result[period] = avgLoss === 0 ? (avgGain === 0 ? 50 : 100) : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < bars.length; i++) {
    const change = bars[i].close - bars[i - 1].close;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    if (avgLoss === 0) {
      result[i] = avgGain === 0 ? 50 : 100;
    } else {
      const rs = avgGain / avgLoss;
      result[i] = 100 - 100 / (1 + rs);
    }
  }

  return result;
}

/** SMA over arbitrary numeric series; any missing warmup value invalidates the window. */
export function calcSeriesSMA(values: (number | null)[], period: number): (number | null)[] {
  validPeriod(period);
  const result: (number | null)[] = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    let complete = true;
    for (let j = i - period + 1; j <= i; j++) {
      const value = values[j];
      if (typeof value !== 'number' || !Number.isFinite(value)) { complete = false; break; }
      sum += value;
    }
    if (complete) result[i] = sum / period;
  }
  return result;
}

/** TradingView-style RSI signal line: simple moving average of Wilder RSI. */
export function calcRSISMA(bars: OHLCVBar[], rsiPeriod: number = 14, period: number = 14): (number | null)[] {
  return calcSeriesSMA(calcRSI(bars, rsiPeriod), period);
}

export interface RSITrendlineParams { minSpan?: number; maxSpan?: number; anchorMin?: number }

/**
 * Causal falling-resistance line on the RSI panel.
 *
 * At bar i the anchor is the highest RSI in [i-maxSpan, i-minSpan] that is at least
 * anchorMin, using only RSI values from completed bars (indices <= i-1). The slope is
 * the maximum (least negative) slope from the anchor to bars anchor+5 .. i-2. A missing
 * anchor or a non-negative slope yields null, which no comparison can satisfy.
 */
export function calcRSITrendline(rsi: (number | null)[], params: RSITrendlineParams = {}): (number | null)[] {
  const minSpan = Math.max(2, Math.trunc(params.minSpan ?? 30));
  const maxSpan = Math.max(minSpan + 1, Math.trunc(params.maxSpan ?? 180));
  const anchorMin = Number.isFinite(params.anchorMin) ? params.anchorMin! : 60;
  const result: (number | null)[] = new Array(rsi.length).fill(null);
  const finiteAt = (index: number): number | null => {
    const value = rsi[index];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  };
  for (let i = 0; i < rsi.length; i++) {
    // Completed-bar-only window: never inspect RSI[i].
    const start = Math.max(0, i - maxSpan);
    const end = i - minSpan;
    if (end < start) continue;
    let anchor = -1;
    let anchorValue = -Infinity;
    for (let j = start; j <= end; j++) {
      const value = finiteAt(j);
      // Ties favour the most recent occurrence, matching a "latest highest" reading.
      if (value !== null && value >= anchorMin && value >= anchorValue) { anchor = j; anchorValue = value; }
    }
    if (anchor < 0) continue;
    let slope = -Infinity;
    for (let j = anchor + 5; j <= i - 2; j++) {
      const value = finiteAt(j);
      if (value === null) continue;
      slope = Math.max(slope, (value - anchorValue) / (j - anchor));
    }
    if (!Number.isFinite(slope) || slope >= 0) continue;
    result[i] = anchorValue + slope * (i - anchor);
  }
  return result;
}

/** Close distance above the lowest low of the trailing window, in percent. */
export function calcPctAboveLow(bars: OHLCVBar[], period: number = 250): (number | null)[] {
  validPeriod(period);
  const result: (number | null)[] = new Array(bars.length).fill(null);
  for (let i = period - 1; i < bars.length; i++) {
    let lowest = Infinity;
    for (let j = i - period + 1; j <= i; j++) lowest = Math.min(lowest, bars[j].low);
    if (Number.isFinite(lowest) && lowest > 0) result[i] = ((bars[i].close - lowest) / lowest) * 100;
  }
  return result;
}

/** Percentage change over the trailing window: (close / close[i-period] - 1) * 100. */
export function calcPctChange(bars: OHLCVBar[], period: number = 126): (number | null)[] {
  validPeriod(period);
  const result: (number | null)[] = new Array(bars.length).fill(null);
  for (let i = period; i < bars.length; i++) {
    const base = bars[i - period].close;
    if (Number.isFinite(base) && base > 0) result[i] = (bars[i].close / base - 1) * 100;
  }
  return result;
}

export function calcATR(bars: OHLCVBar[], period: number = 14): (number | null)[] {  validPeriod(period);
  const result: (number | null)[] = new Array(bars.length).fill(null);
  if (bars.length < period) return result;

  const trs: number[] = [];
  for (let i = 0; i < bars.length; i++) {
    if (i === 0) {
      trs.push(bars[i].high - bars[i].low);
    } else {
      const highLow = bars[i].high - bars[i].low;
      const highClosePrev = Math.abs(bars[i].high - bars[i - 1].close);
      const lowClosePrev = Math.abs(bars[i].low - bars[i - 1].close);
      trs.push(Math.max(highLow, highClosePrev, lowClosePrev));
    }
  }

  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += trs[i];
  }
  let prevAtr = sum / period;
  result[period - 1] = prevAtr;

  for (let i = period; i < bars.length; i++) {
    const curAtr = (prevAtr * (period - 1) + trs[i]) / period;
    result[i] = curAtr;
    prevAtr = curAtr;
  }

  return result;
}

export function calcSupertrend(
  bars: OHLCVBar[],
  period: number = 10,
  multiplier: number = 3
): { supertrend: (number | null)[]; direction: (1 | -1 | null)[] } {
  const atr = calcATR(bars, period);
  const st: (number | null)[] = new Array(bars.length).fill(null);
  const dir: (1 | -1 | null)[] = new Array(bars.length).fill(null);

  if (bars.length < period) return { supertrend: st, direction: dir };

  let upperBand = 0;
  let lowerBand = 0;
  let prevSupertrend = 0;
  let prevDirection: 1 | -1 = 1;

  for (let i = period - 1; i < bars.length; i++) {
    const curAtr = atr[i] ?? (bars[i].high - bars[i].low);
    const hl2 = (bars[i].high + bars[i].low) / 2;

    let curBasicUpper = hl2 + multiplier * curAtr;
    let curBasicLower = hl2 - multiplier * curAtr;

    if (i === period - 1) {
      upperBand = curBasicUpper;
      lowerBand = curBasicLower;
      prevDirection = bars[i].close > upperBand ? 1 : -1;
      prevSupertrend = prevDirection === 1 ? lowerBand : upperBand;
      st[i] = prevSupertrend;
      dir[i] = prevDirection;
      continue;
    }

    // Upper band logic
    if (curBasicUpper < upperBand || bars[i - 1].close > upperBand) {
      upperBand = curBasicUpper;
    }

    // Lower band logic
    if (curBasicLower > lowerBand || bars[i - 1].close < lowerBand) {
      lowerBand = curBasicLower;
    }

    let currentDirection: 1 | -1 = prevDirection;
    if (prevDirection === 1 && bars[i].close < lowerBand) {
      currentDirection = -1;
    } else if (prevDirection === -1 && bars[i].close > upperBand) {
      currentDirection = 1;
    }

    const currentSupertrend = currentDirection === 1 ? lowerBand : upperBand;
    st[i] = currentSupertrend;
    dir[i] = currentDirection;

    prevDirection = currentDirection;
    prevSupertrend = currentSupertrend;
  }

  return { supertrend: st, direction: dir };
}

export function calcBBANDS(
  bars: OHLCVBar[],
  period: number = 20,
  stdDevMult: number = 2
): {
  upper: (number | null)[];
  middle: (number | null)[];
  lower: (number | null)[];
} {
  const sma = calcSMA(bars, period);
  const upper: (number | null)[] = new Array(bars.length).fill(null);
  const middle = sma;
  const lower: (number | null)[] = new Array(bars.length).fill(null);

  for (let i = period - 1; i < bars.length; i++) {
    const mean = sma[i];
    if (mean === null) continue;

    let varianceSum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      varianceSum += Math.pow(bars[j].close - mean, 2);
    }
    const stdDev = Math.sqrt(varianceSum / period);
    upper[i] = mean + stdDevMult * stdDev;
    lower[i] = mean - stdDevMult * stdDev;
  }

  return { upper, middle, lower };
}

export function calcMACD(
  bars: OHLCVBar[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): {
  line: (number | null)[];
  signal: (number | null)[];
  hist: (number | null)[];
} {
  const fastEma = calcEMA(bars, fastPeriod);
  const slowEma = calcEMA(bars, slowPeriod);

  const line: (number | null)[] = new Array(bars.length).fill(null);
  for (let i = 0; i < bars.length; i++) {
    if (fastEma[i] !== null && slowEma[i] !== null) {
      line[i] = fastEma[i]! - slowEma[i]!;
    }
  }

  // Calculate EMA on MACD line for signal
  const signal: (number | null)[] = new Array(bars.length).fill(null);
  const validIdxs = line.map((v, idx) => (v !== null ? idx : -1)).filter(idx => idx !== -1);

  if (validIdxs.length >= signalPeriod) {
    const k = 2 / (signalPeriod + 1);
    let sum = 0;
    const startIdx = validIdxs[0];
    for (let i = startIdx; i < startIdx + signalPeriod; i++) {
      sum += line[i]!;
    }
    let prevSig = sum / signalPeriod;
    signal[startIdx + signalPeriod - 1] = prevSig;

    for (let i = startIdx + signalPeriod; i < bars.length; i++) {
      if (line[i] !== null) {
        const curSig = line[i]! * k + prevSig * (1 - k);
        signal[i] = curSig;
        prevSig = curSig;
      }
    }
  }

  const hist: (number | null)[] = new Array(bars.length).fill(null);
  for (let i = 0; i < bars.length; i++) {
    if (line[i] !== null && signal[i] !== null) {
      hist[i] = line[i]! - signal[i]!;
    }
  }

  return { line, signal, hist };
}

/**
 * Calculates all technical indicators requested in strategy AST
 */
export function calculateAllIndicators(
  bars: OHLCVBar[],
  indicators: IndicatorConfig[]
): Record<string, (number | null)[]> {
  const series: Record<string, (number | null)[]> = {};

  // Base price fields & candle shape metrics
  series['open'] = bars.map(b => b.open);
  series['high'] = bars.map(b => b.high);
  series['low'] = bars.map(b => b.low);
  series['close'] = bars.map(b => b.close);
  series['volume'] = bars.map(b => b.volume);
  series['candleBody'] = bars.map(b => Math.abs(b.close - b.open));
  series['upperWick'] = bars.map(b => b.high - Math.max(b.open, b.close));
  series['lowerWick'] = bars.map(b => Math.min(b.open, b.close) - b.low);

  const namespace = new Set<string>(RESERVED_SERIES);
  for (const raw of indicators) {
    const ind = IndicatorV2Schema.parse(raw);
    for (const name of Object.keys(legacyOutputNames(ind))) { if (namespace.has(name)) throw new Error('INDICATOR_NAMESPACE_COLLISION: ' + name); namespace.add(name); }
    const id = ind.id;
    const type = ind.type;
    const params = ind.params;

    if (ind.type === 'SMA') {
      series[id] = calcSMA(bars, ind.params.period || 20);
    } else if (ind.type === 'VOLUME_SMA') {
      series[id] = calcSMA(bars.map(b => ({ ...b, close: b.volume })), ind.params.period);
    } else if (ind.type === 'EMA') {
      series[id] = calcEMA(bars, ind.params.period || 20);
    } else if (ind.type === 'RSI') {
      series[id] = calcRSI(bars, ind.params.period || 14);
    } else if (ind.type === 'RSI_SMA') {
      series[id] = calcRSISMA(bars, ind.params.rsiPeriod ?? 14, ind.params.period ?? 14);
    } else if (ind.type === 'RSI_TRENDLINE') {
      const rsi = calcRSI(bars, ind.params.rsiPeriod ?? 14);
      series[id] = calcRSITrendline(rsi, { minSpan: ind.params.minSpan ?? 30, maxSpan: ind.params.maxSpan ?? 180, anchorMin: ind.params.anchorMin ?? 60 });
      series[`${id}_line`] = series[id];
    } else if (ind.type === 'PCT_ABOVE_LOW') {
      series[id] = calcPctAboveLow(bars, ind.params.period ?? 250);
    } else if (ind.type === 'PCT_CHANGE') {
      series[id] = calcPctChange(bars, ind.params.period ?? 126);
    } else if (ind.type === 'ATR') {
      series[id] = calcATR(bars, ind.params.period || 14);
    } else if (ind.type === 'SUPERTREND') {
      const { supertrend, direction } = calcSupertrend(bars, ind.params.period || 10, ind.params.multiplier || 3);
      series[id] = supertrend;
      series[`${id}_dir`] = direction;
      series[`${id}_direction`] = direction;
      series[`${id}_line`] = supertrend;
    } else if (ind.type === 'BBANDS') {
      const { upper, middle, lower } = calcBBANDS(bars, ind.params.period || 20, ind.params.stdDev || 2);
      series[id] = middle;
      series[`${id}_upper`] = upper;
      series[`${id}_middle`] = middle;
      series[`${id}_lower`] = lower;
    } else if (ind.type === 'MACD') {
      const { line, signal, hist } = calcMACD(
        bars,
        ind.params.fastPeriod || 12,
        ind.params.slowPeriod || 26,
        ind.params.signalPeriod || 9
      );
      series[id] = line;
      series[`${id}_line`] = line;
      series[`${id}_signal`] = signal;
      series[`${id}_hist`] = hist;
      series[`${id}_histogram`] = hist;
    }
  }

  return series;
}
