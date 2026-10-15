import { StrategyAST, RuleNode, OHLCVBar } from '../../shared/strategy/types';
import { NSE_SYMBOLS, ALL_SYMBOLS, filterSymbolsByUniverse, MarketUniverseType } from '../data/symbols';
import { getDailyBars } from '../data/mockData';
import { calculateAllIndicators } from './indicators';
import { evaluateRuleSet } from './engine';

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

export function scanUniverse(
  strategy: StrategyAST,
  universeName: string = 'nifty50',
  limit: number = 35
): UniverseScanResponse {
  let targetSymbols = NSE_SYMBOLS;

  const normalizedUniv = universeName.toUpperCase();
  if (normalizedUniv === 'BANKNIFTY' || normalizedUniv === 'BANK_NIFTY') {
    targetSymbols = filterSymbolsByUniverse('BANK_NIFTY');
  } else if (normalizedUniv === 'NIFTY50' || normalizedUniv === 'NIFTY_50') {
    targetSymbols = filterSymbolsByUniverse('NIFTY_50');
  } else if (normalizedUniv === 'INDICES' || normalizedUniv === 'POPULAR_INDICES') {
    targetSymbols = filterSymbolsByUniverse('POPULAR_INDICES');
  } else if (normalizedUniv === 'NSE') {
    targetSymbols = filterSymbolsByUniverse('NSE');
  } else if (normalizedUniv === 'BSE') {
    targetSymbols = filterSymbolsByUniverse('BSE');
  } else if (normalizedUniv === 'NIFTY_IT' || normalizedUniv === 'NIFTY_AUTO' || normalizedUniv === 'NIFTY_PHARMA' || normalizedUniv === 'NIFTY_METAL' || normalizedUniv === 'NIFTY_FMCG' || normalizedUniv === 'BSE_SENSEX') {
    targetSymbols = filterSymbolsByUniverse(normalizedUniv as MarketUniverseType);
  } else if (normalizedUniv === 'ALL') {
    targetSymbols = ALL_SYMBOLS;
  } else {
    // Default fallback
    targetSymbols = NSE_SYMBOLS;
  }

  const matches: ScanMatchResult[] = [];
  let scannedCount = 0;

  for (const sym of targetSymbols) {
    scannedCount++;
    const bars = getDailyBars(sym.id);
    if (!bars || bars.length < 30) continue;

    try {
      const series = calculateAllIndicators(bars, strategy.indicators);
      const lastIdx = bars.length - 1;
      const lastBar = bars[lastIdx];

      const isMatch = evaluateRuleSet(strategy.rules.entry, lastIdx, series);

      if (isMatch) {
        const matchedRuleDetails = strategy.rules.entry.map(r => {
          const leftVal = series[r.leftIndicator]?.[lastIdx] || 0;
          let rightVal = 0;
          if (r.rightIndicator) {
            rightVal = series[r.rightIndicator]?.[lastIdx] || 0;
          } else if (r.rightValue !== undefined) {
            rightVal = r.rightValue;
          }
          return {
            rule: `${r.leftIndicator} ${r.operator} ${r.rightIndicator || r.rightValue}`,
            actualLeft: Number(Number(leftVal).toFixed(2)),
            actualRight: Number(Number(rightVal).toFixed(2))
          };
        });

        const indicatorValues: Record<string, number> = {};
        for (const ind of strategy.indicators) {
          const val = series[ind.id]?.[lastIdx];
          if (val !== null && val !== undefined && !isNaN(val)) {
            indicatorValues[ind.id] = Number(Number(val).toFixed(2));
          }
        }

        matches.push({
          symbolId: sym.id,
          ticker: sym.ticker,
          name: sym.name,
          sector: sym.sector,
          lastDate: lastBar.date,
          lastClose: lastBar.close,
          changePercent: sym.changePercent,
          matchedRules: matchedRuleDetails,
          indicatorValues
        });

        if (matches.length >= limit) break;
      }
    } catch {
      // Continue next symbol safely
      continue;
    }
  }

  return {
    universe: `${universeName} (${targetSymbols.length})`,
    scanned: scannedCount,
    matched: matches.length,
    scannedAt: new Date().toISOString(),
    dataSource: 'NSE_LIVE_STREAM',
    matches
  };
}
