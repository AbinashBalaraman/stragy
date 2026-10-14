import { parentPort, workerData } from 'node:worker_threads';
import { runBacktest } from '../backtest/engine';
import { scanUniverseAsync } from '../backtest/scanner';
import { buildMarketSnapshot } from '../backtest/marketSnapshot';
import { parseBacktestResult } from '../../shared/contracts/research';
import { redact } from '../config';
import { sourceCommit } from '../buildInfo';
import type { ResearchPayload } from './manager';
async function main() {
  const payload = workerData as ResearchPayload;
  parentPort?.postMessage({ type: 'progress', stage: payload.kind ?? 'backtest' });
  if (payload.kind === 'scan') {
    const result = await scanUniverseAsync(payload.strategy, payload.universe, { mode: payload.mode, asOf: payload.asOf, limit: payload.limit, offset: payload.offset });
    parentPort?.postMessage({ type:'result',result }); return;
  }
  if (payload.kind === 'market') {
    const result = await buildMarketSnapshot(payload.universe, payload.asOf, payload.mode);
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
