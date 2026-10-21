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

export function calcATR(bars: OHLCVBar[], period: number = 14): (number | null)[] {
  validPeriod(period);
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
