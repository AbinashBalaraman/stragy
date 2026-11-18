import { parentPort, workerData } from 'node:worker_threads';
import { runBacktest } from '../backtest/engine';
import { scanUniverseAsync } from '../backtest/scanner';
import { buildMarketSnapshot } from '../backtest/marketSnapshot';
import { analyzeChart, parseChartImageDataUrl } from '../ai/chartVision';
import { runMarketCacheRefresh } from '../data/marketCacheRefresh';
import { parseBacktestResult } from '../../shared/contracts/research';
import { redact } from '../config';
import { sourceCommit } from '../buildInfo';
import type { ResearchPayload } from './manager';
async function main() {
  const payload = workerData as ResearchPayload;
  parentPort?.postMessage({ type: 'progress', stage: payload.kind ?? 'backtest' });
  if (payload.kind === 'chart') {
    // Two bounded vision passes share a 200 s budget; the manager gives chart
    // jobs a 210 s cap so a slow provider chain is never killed mid-read.
    parentPort?.postMessage({ type: 'progress', stage: 'chart_observations' });
    const image = parseChartImageDataUrl(payload.image);
    const result = await analyzeChart({ image, hint: payload.hint, currentStrategy: payload.currentStrategy });
    parentPort?.postMessage({ type:'result',result }); return;
  }
  if (payload.kind === 'scan') {
    const result = await scanUniverseAsync(payload.strategy, payload.universe, { mode: payload.mode, asOf: payload.asOf, limit: payload.limit, offset: payload.offset, maxSymbols: payload.maxSymbols, onProgress: (stage, counts) => parentPort?.postMessage({ type: 'progress', stage, ...(counts ? { processed: counts.processed, total: counts.total } : {}) }) });
    parentPort?.postMessage({ type:'result',result }); return;
  }
  if (payload.kind === 'market') {
    const result = await buildMarketSnapshot(payload.universe, payload.asOf, payload.mode, (stage, progress) => parentPort?.postMessage({ type: 'progress', stage, processed: progress?.processed, total: progress?.total }));
    parentPort?.postMessage({ type:'result',result }); return;
  }
  if (payload.kind === 'cache') {
    // Cache-first warm-up. The service resolves the universe and asks
    // loadMarketSeries for each symbol, which downloads only the missing tail.
    // The manager stops this worker to cancel; termination ends the signal-less run.
    const controller = new AbortController();
    const result = await runMarketCacheRefresh(
      { universe: payload.universe, symbolIds: payload.symbolIds, maxSymbols: payload.maxSymbols },
      {},
      {
        signal: controller.signal,
        onProgress: state => parentPort?.postMessage({ type: 'progress', stage: 'cache ' + state.processed + '/' + state.total, processed: state.processed, total: state.total }),
      },
    );
    parentPort?.postMessage({ type:'result',result }); return;
  }
  const result = runBacktest(payload.strategy, payload.bars, payload.options);
  result.provenance = payload.provenance;
  result.manifest = { schemaVersion: 2, sourceCommit: sourceCommit(), engineVersion: result.engineVersion, executionPolicy: result.executionPolicy,
    strategy: result.strategy, data: payload.provenance, initialCapital: result.metrics.initialCapital, seed: payload.options?.seed ?? 42,
    feeSchedule: payload.options?.feeSchedule?.id ?? 'illustrative-unverified', feeVerified: payload.options?.feeSchedule?.verified ?? false,
    assumptions: result.warnings, reconciliation: result.reconciliation };
  parentPort?.postMessage({ type: 'result', result: parseBacktestResult(result) });
}
main().catch(error => {
  const typed = error as { code?: string; message?: string };
  parentPort?.postMessage({ type: 'error', code: typed.code ?? 'SIMULATION_FAILED', message: redact(typed.message ?? 'Research simulation failed.').slice(0, 500) });
});
