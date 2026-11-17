import { z } from 'zod';

const finite = z.number().finite();
const count = finite.int().nonnegative();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const provenance = z.object({
  mode: z.enum(['demo', 'real']), source: z.string().min(1), symbolId: count.positive(), asOf: date,
  fetchedAt: z.string().min(1), requestedRange: z.object({ start: date.optional(), end: date.optional() }),
  actualRange: z.object({ start: date, end: date }), adjustment: z.string(), checksum: z.string().min(1),
  coverage: z.string(), freshness: z.string(), warnings: z.array(z.string()), calendarVersion: z.string(),
}).passthrough();
const trend = z.object({
  id: count.positive(), ticker: z.string().min(1), name: z.string(), sector: z.string(),
  ltp: finite.positive(), changePercent: finite, high: finite, low: finite, volume: finite,
  avg20Volume: finite, volumeRatio: finite, fiftyTwoWeekHigh: finite, fiftyTwoWeekLow: finite,
  distFrom52WHigh: finite, distFrom52WLow: finite, rsi: finite, ema20: finite, sma50: finite, sma200: finite,
  trend: z.enum(['STRONG_BULLISH', 'BULLISH', 'NEUTRAL', 'BEARISH', 'OVERSOLD_REVERSAL']),
  trendLabel: z.string(), momentumScore: finite,
  signal: z.enum(['BUY_BREAKOUT', 'PULLBACK_ENTRY', 'OVERSOLD_RSI', 'GOLDEN_CROSS', 'NEUTRAL']), signalLabel: z.string(),
  openInterest: finite.nullable(), oiChangePercent: finite.nullable(),
  oiInterpretation: z.enum(['LONG_BUILDUP', 'SHORT_COVERING', 'SHORT_BUILDUP', 'LONG_UNWINDING']).nullable(),
  pcrRatio: finite.nullable(), dataSource: z.enum(['DEMO_MODEL', 'OHLCV_ANALYSIS']),
  exchange: z.enum(['NSE', 'BSE']).optional(), indices: z.array(z.string()).optional(),
  date: date.optional(), formattedDate: z.string().optional(), timestamp: finite.optional(),
});
const trends = z.array(trend).max(2500);
const membership = z.object({
  requested: count,
  unmapped: z.array(z.object({ ticker: z.string(), reason: z.string() })),
  source: z.string(), observedAt: z.string(), asOf: z.string().optional(), freshness: z.string(), warnings: z.array(z.string()),
  basis: z.enum(['official-feed', 'bundled-catalog', 'none']).optional(),
  verified: z.boolean().optional(),
  available: count.optional(), selected: count.optional(), cap: count.optional(), truncated: z.boolean().optional(),
  order: z.string().optional(),
  role: z.enum(['official-membership', 'configured-catalog', 'benchmark-only']).optional(),
  unavailableReason: z.string().optional(), recommendations: z.array(z.string()).optional(),
});
const observationDates = z.object({ earliest: date, latest: date, staleSymbols: count });
const coverageStatus = z.enum(['complete', 'partial', 'unavailable']);
const deadline = z.object({ budgetMs: count, reached: z.boolean(), truncated: z.boolean(), elapsedMs: count });
const progress = z.object({ processed: count, total: count, stage: z.string() });
const movers = z.object({
  universe: z.string().optional(), asOfDate: date, formattedDate: z.string(), isHistorical: z.boolean().optional(),
  availableTradingSessions: z.array(z.object({ date, label: z.string(), isLatest: z.boolean() })).optional(),
  totalFilteredCount: count.optional(), topGainers: trends, topLosers: trends, volumeShockers: trends,
  nearFiftyTwoWeekHigh: trends, nearFiftyTwoWeekLow: trends,
  derivativesBuildup: z.object({ longBuildup: trends, shortCovering: trends, shortBuildup: trends, longUnwinding: trends }),
  marketBreadth: z.object({ advances: count, declines: count, unchanged: count, advanceDeclineRatio: finite, bullishPercent: finite }),
  sectorHeatmap: z.array(z.object({ sector: z.string(), avgChangePercent: finite, count, advances: count, declines: count })),
});
export const MarketSnapshotResultSchema = z.object({
  trends, movers: movers.optional(), errors: z.array(z.object({ symbolId: count, code: z.string(), ticker: z.string().optional() })).max(2500),
  provenance: provenance.optional(), coverage: z.object({ requested: count, succeeded: count, unavailable: count }),
  sourceCoverage: z.record(z.string(), count), universe: z.string(), requestedDate: date.optional(), mode: z.enum(['demo', 'real']),
  membership: membership.optional(), observationDates: observationDates.optional(), status: coverageStatus.optional(), warnings: z.array(z.string()).optional(),
  statusReason: z.string().optional(), recommendations: z.array(z.string()).optional(), retryable: z.boolean().optional(),
  deadline: deadline.optional(), progress: progress.optional(),
}).superRefine((value, ctx) => {
  if (value.coverage.succeeded !== value.trends.length || value.coverage.unavailable !== value.errors.length || value.coverage.succeeded + value.coverage.unavailable !== value.coverage.requested)
    ctx.addIssue({ code: 'custom', message: 'Market coverage does not reconcile' });
  if (Object.values(value.sourceCoverage).reduce((sum, n) => sum + n, 0) !== value.coverage.succeeded)
    ctx.addIssue({ code: 'custom', message: 'Market source coverage does not reconcile' });
});
/**
 * A diagnostic value is null when the referenced series genuinely has no value
 * at that bar (for example an RSI trendline with no anchored peaks yet). Null is
 * honest "unknown", never a fabricated number.
 */
const scanValue = finite.nullable();
const scanRule = z.object({ rule: z.string(), ruleIndex: count.optional(), actualLeft: scanValue, actualRight: scanValue, matchedIndex: count.optional(), matchedDate: date.optional(), currentActualLeft: scanValue.optional(), currentActualRight: scanValue.optional() });
const scanMatch = z.object({
  symbolId: count.positive(), ticker: z.string(), name: z.string(), sector: z.string(), lastDate: date,
  lastClose: finite.positive(), currency: z.literal('INR').optional(), changePercent: finite,
  score: z.number().min(0).max(1).optional(),
  matchedRules: z.array(scanRule),
  unmatchedRules: z.array(scanRule).optional(),
  indicatorValues: z.record(z.string(), finite), provenance,
});
export const ScanResultSchema = z.object({
  universe: z.string(), scanned: count, matched: count, scannedAt: z.string().min(1), dataSource: z.string(),
  matches: z.array(scanMatch).max(500),
  nearMatches: z.array(scanMatch).max(10).optional(),
  requested: count, attempted: count, succeeded: count, unavailable: count, failed: count,
  asOf: date.optional(), offset: count, limit: count.min(1).max(500),
  errors: z.array(z.object({ symbolId: count, code: z.string(), message: z.string(), ticker: z.string().optional() })).max(2500),
  sourceCoverage: z.record(z.string(), count), warnings: z.array(z.string()),
  mode: z.enum(['demo', 'real']).optional(), membership: membership.optional(), observationDates: observationDates.optional(), status: coverageStatus.optional(),
}).superRefine((value, ctx) => {
  if (value.scanned !== value.attempted || value.attempted > value.requested || value.succeeded + value.unavailable + value.failed !== value.requested || value.errors.length !== value.unavailable + value.failed || value.matched > value.succeeded || value.matches.length > value.matched || value.matches.length > value.limit)
    ctx.addIssue({ code: 'custom', message: 'Scan coverage does not reconcile' });
  if (Object.values(value.sourceCoverage).reduce((sum, n) => sum + n, 0) !== value.succeeded)
    ctx.addIssue({ code: 'custom', message: 'Scan source coverage does not reconcile' });
});
export type MarketSnapshotResult = z.infer<typeof MarketSnapshotResultSchema>;
export type ScanResult = z.infer<typeof ScanResultSchema>;
export function parseMarketSnapshotResult(input: unknown): MarketSnapshotResult { return MarketSnapshotResultSchema.parse(input); }
export function parseScanResult(input: unknown): ScanResult { return ScanResultSchema.parse(input); }
