import { afterEach, describe, expect, it } from 'vitest';
import { CHART_JOB_MAX_MS, JobManager, type ResearchPayload, type ResearchResult } from '../../server/jobs/manager';
import { VISION_TOTAL_BUDGET_MS } from '../../server/ai/chartVision';
import type { ResearchChatResponse } from '../../shared/contracts/research-chat';

const PNG = 'data:image/png;base64,' + Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString('base64');
const chartInput = (): ResearchPayload => ({ kind: 'chart', image: PNG, hint: 'RSI trendline break' });
const readOnly = (): ResearchChatResponse => ({
  schemaVersion: 1,
  kind: 'conversation',
  originatingRevision: null,
  message: 'Chart reading is unavailable in this fixture.',
  method: 'unavailable',
  provider: { name: 'none', model: null, aiGenerated: false },
  warnings: [],
});
const managers: JobManager[] = [];
afterEach(async () => { for (const manager of managers.splice(0)) await manager.shutdown(); });
async function terminal(manager: JobManager, id: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const job = manager.get(id)!;
    if (!['queued', 'running'].includes(job.status)) return job;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Chart job did not finish');
}

describe('chart analysis job', () => {
  it('gives chart jobs a cap that covers the whole two-pass model budget', () => {
    expect(VISION_TOTAL_BUDGET_MS).toBe(200_000);
    expect(CHART_JOB_MAX_MS).toBeGreaterThan(VISION_TOTAL_BUDGET_MS);
    // The extra margin lets the worker emit its result after the last pass.
    expect(CHART_JOB_MAX_MS - VISION_TOTAL_BUDGET_MS).toBeGreaterThanOrEqual(10_000);
  });

  it('is not killed by the short backtest/scan cap', async () => {
    const manager = new JobManager({
      maxMs: 20,
      executor: async payload => {
        if (payload.kind === 'chart') await new Promise(resolve => setTimeout(resolve, 120));
        return readOnly();
      },
    });
    managers.push(manager);
    const job = manager.enqueue(chartInput());
    const done = await terminal(manager, job.id);
    expect(done.status).toBe('succeeded');
    expect((done.result as ResearchChatResponse).kind).toBe('conversation');
  });

  it('keeps the chart lane separate from scans and backtests', async () => {
    let releaseChart!: () => void;
    const chartBlocked = new Promise<void>(resolve => { releaseChart = resolve; });
    const manager = new JobManager({
      maxMs: 1_000,
      executor: async payload => {
        if (payload.kind === 'chart') await chartBlocked;
        return readOnly() as ResearchResult;
      },
    });
    managers.push(manager);
    const chart = manager.enqueue(chartInput());
    const scan = manager.enqueue({ kind: 'scan', strategy: chartStrategy(), universe: 'NIFTY_50', mode: 'demo' });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(manager.get(chart.id)?.status).toBe('running');
    // The long chart read never occupies the scan lane.
    expect(manager.get(scan.id)?.status).toMatch(/running|succeeded/);
    releaseChart();
    expect((await terminal(manager, chart.id)).status).toBe('succeeded');
    expect((await terminal(manager, scan.id)).status).toBe('succeeded');
  });

  it('accepts a chart payload larger than the backtest payload budget', () => {
    const manager = new JobManager({ executor: async () => readOnly() });
    managers.push(manager);
    const large = 'data:image/png;base64,' + 'A'.repeat(3_000_000);
    expect(manager.enqueue({ kind: 'chart', image: large }).kind).toBe('chart');
    expect(() => manager.enqueue({ kind: 'chart', image: 'not-a-data-url' })).toThrow(/budget/i);
    expect(() => manager.enqueue({ kind: 'chart', image: 'data:image/png;base64,' + 'A'.repeat(9_000_000) })).toThrow(/budget/i);
  });
});

function chartStrategy() {
  // Only the lane matters here; the executor never validates the strategy.
  return { name: 'fixture', universe: { symbolId: 9, timeframe: '1D' as const }, rules: { entry: [] } } as unknown as Extract<ResearchPayload, { kind: 'scan' }>['strategy'];
}
