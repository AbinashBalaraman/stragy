import { describe, expect, it, vi } from 'vitest';
import { createEnginePlugin, EngineContextStore, type EngineToolDeps } from '../../server/ai/engineTools';
import { ApprovalStore } from '../../server/ai/engineApprovals';
import { STRATEGY_TEMPLATES } from '../../shared/strategy/templates';
import type { ResearchPayload } from '../../server/jobs/manager';

const strategy = STRATEGY_TEMPLATES[0].strategy;

type Tool = { name: string; execute: (input: unknown, context: unknown) => Promise<{ output?: Record<string, unknown> }> };

async function setup(overrides: Partial<EngineToolDeps> = {}) {
  const tools: Tool[] = [];
  const deps: EngineToolDeps = {
    dataMode: 'demo',
    approvals: new ApprovalStore(),
    contexts: new EngineContextStore(),
    ...overrides,
  };
  const plugin = createEnginePlugin(() => deps);
  await plugin.setup({
    tool: {
      transform: async (callback: (editor: {
        add: (tool: Tool) => void; list: () => Tool[]; get: (id: string) => Tool | undefined;
        namespace: () => void; update: () => void; remove: () => void;
      }) => void) => {
        callback({
          add: tool => tools.push(tool), list: () => tools, get: name => tools.find(tool => tool.name === name),
          namespace: () => undefined, update: () => undefined, remove: () => undefined,
        });
      },
    },
  } as never);
  return { tools, deps, get: (name: string) => tools.find(tool => tool.name === name)! };
}

const context = (sessionID = 's1') => ({ sessionID, agent: 'stragy', messageID: 'm1', id: 'call_1', signal: new AbortController().signal, progress: async () => undefined });

function jobsWith(result?: unknown) {
  const enqueue = vi.fn((_payload: ResearchPayload) => ({ id: 'job1', kind: 'backtest', status: 'queued' }));
  const get = vi.fn(() => result ? { id: 'job1', kind: 'scan', status: 'succeeded', result } : undefined);
  return { jobs: { enqueue, get }, enqueue, get };
}

describe('engine research tools', () => {
  it('gates run_backtest behind a one-time operator approval', async () => {
    const { jobs, enqueue } = jobsWith();
    let prepared: unknown;
    const { get, deps } = await setup({
      jobs,
      prepareBacktest: async body => { prepared = body; return { kind: 'backtest', strategy, bars: [], provenance: {}, options: {} } as unknown as ResearchPayload; },
    });
    const run = get('run_backtest');

    const first = await run.execute({ strategy, initialCapital: 100000 }, context());
    expect(first.output?.status).toBe('approval_required');
    const approvalId = String(first.output?.approvalId);
    expect(approvalId).toMatch(/^apr_/);
    expect(enqueue).not.toHaveBeenCalled();
    expect(prepared).toBeUndefined();
    expect(first.output?.assumptions).toBeInstanceOf(Array);

    deps.approvals.decide(approvalId, 'approve');
    const second = await run.execute({ strategy, initialCapital: 100000 }, context());
    expect(second.output?.status).toBe('queued');
    expect(second.output?.jobId).toBe('job1');
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(prepared).toMatchObject({ initialCapital: 100000 });

    // The token was consumed: a third identical call needs a fresh review.
    const third = await run.execute({ strategy, initialCapital: 100000 }, context());
    expect(third.output?.status).toBe('approval_required');
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it('requires a new review when the assumptions changed', async () => {
    const { jobs } = jobsWith();
    const { get, deps } = await setup({ jobs, prepareBacktest: async () => ({ kind: 'backtest', strategy, bars: [] } as unknown as ResearchPayload) });
    const run = get('run_backtest');
    const first = await run.execute({ strategy, initialCapital: 100000 }, context());
    deps.approvals.decide(String(first.output?.approvalId), 'approve');
    const changed = await run.execute({ strategy, initialCapital: 200000 }, context());
    expect(changed.output?.status).toBe('approval_required');
  });

  it('returns a draft proposal without applying, scanning or backtesting', async () => {
    const { jobs, enqueue } = jobsWith();
    const { get } = await setup({ jobs });
    const propose = get('propose_strategy_edit');
    const result = await propose.execute({
      candidate: strategy,
      rationale: 'Tighten the entry.',
      changes: ['RSI period 14 -> 10'],
    }, context());
    expect(result.output?.status).toBe('ok');
    const proposal = result.output?.proposal as { applied: boolean; executes: boolean; candidate: { name: string }; changeDetails: unknown[] };
    expect(proposal.applied).toBe(false);
    expect(proposal.executes).toBe(false);
    expect(proposal.candidate.name).toBe(strategy.name);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('queues a chart read immediately and polls its job with a bounded wait', async () => {
    const enqueue = vi.fn(() => ({ id: 'chart1', kind: 'chart', status: 'queued' }));
    const { get, deps } = await setup({ jobs: { enqueue, get: () => ({ id: 'chart1', kind: 'chart', status: 'succeeded', result: { kind: 'screen', message: 'Chart read.' } }) } });
    deps.contexts.addAttachment('s1', { dataUrl: 'data:image/png;base64,AAAA', mimeType: 'image/png', name: 'chart.png', currentStrategy: strategy });
    const read = get('read_chart');
    const queued = await read.execute({}, context());
    expect(queued.output?.status).toBe('queued');
    expect(queued.output?.jobId).toBe('chart1');
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ kind: 'chart', image: 'data:image/png;base64,AAAA' }));
    const result = await get('get_chart_result').execute({ jobId: 'chart1' }, context());
    expect(result.output).toMatchObject({ status: 'succeeded', kind: 'chart', readingKind: 'screen' });
  });

  it('reports a missing job and a failed job honestly in get_scan_result', async () => {
    const { get } = await setup({ jobs: { enqueue: vi.fn(), get: () => ({ id: 'j', kind: 'scan', status: 'failed', error: { code: 'PROVIDER_DOWN', message: 'No data.' } }) } });
    const failed = await get('get_scan_result').execute({ jobId: 'j' }, context());
    expect(failed.output).toMatchObject({ status: 'failed', error: { code: 'PROVIDER_DOWN', message: 'No data.' } });
    const missingSetup = await setup({ jobs: { enqueue: vi.fn(), get: () => undefined } });
    const missing = await missingSetup.get('get_scan_result').execute({ jobId: 'gone' }, context());
    expect(missing.output).toMatchObject({ status: 'failed', error: { code: 'JOB_NOT_FOUND' } });
  });
});
