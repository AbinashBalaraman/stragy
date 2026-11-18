import { describe, expect, it } from 'vitest';
import { adaptMessages, buildSeqIndex, idleErrorText } from '../../server/ai/engineAdapter';
import { parseResearchChatResponse } from '../../shared/contracts/research-chat';
import { STRATEGY_TEMPLATES } from '../../shared/strategy/templates';

const strategy = STRATEGY_TEMPLATES[0].strategy;

function userMessage(id: string, text: string, created: number) {
  return { id, type: 'user', text, time: { created } };
}
function assistantToolCall(id: string, created: number, name: string, input: unknown, output: unknown) {
  return {
    id, type: 'assistant', time: { created }, finish: 'tool-calls',
    model: { providerID: 'opencode-go', id: 'hy4-flash-free' },
    content: [
      { type: 'reasoning', text: 'Working.' },
      {
        type: 'tool', id: 'call_' + name, name,
        state: { status: 'completed', input, content: [{ type: 'text', text: JSON.stringify(output) }], metadata: { truncated: false } },
        time: { created, ran: created + 10, completed: created + 20 },
      },
    ],
  };
}
function assistantText(id: string, created: number, text: string) {
  return { id, type: 'assistant', time: { created }, finish: 'stop', content: [{ type: 'text', text }] };
}
const scanResult = {
  universe: 'NIFTY_50', scanned: 3, matched: 2, scannedAt: '2026-01-09T10:00:00.000Z', dataSource: 'PROVENANCE_PER_SYMBOL',
  matches: [
    { symbolId: 1, ticker: 'AAA', name: 'A', sector: 'X', lastDate: '2026-01-09', lastClose: 100, changePercent: 1, score: 1, matchedRules: [{ rule: 'RSI < 30' }], indicatorValues: {}, provenance: {} },
    { symbolId: 2, ticker: 'BBB', name: 'B', sector: 'Y', lastDate: '2026-01-09', lastClose: 200, changePercent: -1, score: 1, matchedRules: [{ rule: 'RSI < 30' }], indicatorValues: {}, provenance: {} },
  ],
  nearMatches: [], requested: 3, attempted: 3, succeeded: 3, unavailable: 0, failed: 0,
  offset: 0, limit: 50, errors: [], sourceCoverage: { 'YAHOO_PUBLIC_CHART': 3 }, warnings: ['Partial coverage'], mode: 'real',
};

describe('engine message adapter', () => {
  it('maps a scan tool result to the ScanResult card and a screen plan payload', async () => {
    const messages = await adaptMessages([
      userMessage('u1', 'Screen NIFTY 50', 1000),
      assistantToolCall('a1', 2000, 'scan_market', { universe: 'NIFTY_50', strategy }, {
        status: 'succeeded', jobId: 'job1', kind: 'scan', universe: 'NIFTY_50',
        matched: 2, requested: 3, succeeded: 3, unavailable: 0, failed: 0, warnings: ['Partial coverage'],
      }),
      assistantText('a2', 3000, 'Two names matched.'),
    ], {
      seqFor: id => ({ u1: 1000, a1: 2000, a2: 3000 } as Record<string, number>)[id],
      resolveJobResult: jobId => jobId === 'job1' ? scanResult : undefined,
    });

    expect(messages.map(message => message.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
    expect(messages[0]).toMatchObject({ id: 'u1', text: 'Screen NIFTY 50', seq: 1000 });
    const tool = messages[2];
    expect(tool).toMatchObject({ role: 'tool', tool: 'scan_market', job: { id: 'job1', kind: 'scan', status: 'succeeded' } });
    expect(tool.result).toEqual(scanResult);
    // The payload is attached to the answer, not the tool-call step.
    expect(messages[1].payload).toBeUndefined();
    const payload = parseResearchChatResponse(messages[3].payload);
    expect(payload.kind).toBe('screen');
    if (payload.kind === 'screen') {
      expect(payload.universe).toBe('NIFTY_50');
      expect(payload.strategy.name).toBe(strategy.name);
      expect(payload.backtestReady).toBe(false);
      expect(payload.missingBacktestRules.length).toBeGreaterThan(0);
      expect(payload.assumptions.join(' ')).toMatch(/read-only screen/i);
    }
  });

  it('parses a strategy passed as a JSON string into a screen payload', async () => {
    const messages = await adaptMessages([
      userMessage('u1', 'Screen NSE', 1000),
      assistantToolCall('a1', 2000, 'scan_market', { universe: 'NSE', strategy: JSON.stringify(strategy), maxSymbols: 50 }, {
        status: 'succeeded', jobId: 'job2', kind: 'scan', universe: 'NSE',
        matched: 0, requested: 50, succeeded: 50, unavailable: 0, failed: 0, warnings: ['First 50 of 2051.'],
      }),
      assistantText('a2', 3000, 'No matches in the first 50.'),
    ], { resolveJobResult: () => ({ ...scanResult, status: 'partial' }) });
    const payload = parseResearchChatResponse(messages.at(-1)!.payload);
    expect(payload.kind).toBe('screen');
    if (payload.kind === 'screen') expect(payload.universe).toBe('NSE');
  });

  it('attaches a screen card when only the durable scan result is available', async () => {
    const raw = assistantToolCall('a1', 2000, 'scan_market', { universe: 'NSE', strategy: JSON.stringify(strategy) }, { status: 'succeeded' });
    raw.content![0] = { type: 'tool', id: 'call_scan_market', name: 'scan_market', state: { status: 'completed', input: { universe: 'NSE', strategy: JSON.stringify(strategy) }, content: [{ type: 'text', text: 'The scan evaluated 50 symbols.' }], metadata: { truncated: false } } } as never;
    const messages = await adaptMessages([
      userMessage('u1', 'Screen NSE', 1000),
      raw,
      assistantText('a2', 3000, 'No matches in the first 50.'),
    ], { resolveJobResult: () => ({ ...scanResult, status: 'partial' }) });
    const payload = parseResearchChatResponse(messages.at(-1)!.payload);
    expect(payload.kind).toBe('screen');
    if (payload.kind === 'screen') expect(payload.universe).toBe('NSE');
  });

  it('maps a chart reading and a proposal to their card payloads', async () => {
    const chartReading = {
      schemaVersion: 1, originatingRevision: null, message: 'Chart read.', method: 'external_ai',
      provider: { name: 'OpenCode engine', model: null, aiGenerated: true }, warnings: [],
      kind: 'screen', universe: 'NIFTY_50', strategy, assumptions: ['Chart-derived conditions.'],
      missingBacktestRules: ['exits'], backtestReady: false,
    };
    const proposal = {
      schemaVersion: 2, id: 'draft_1', status: 'draft', createdAt: '2026-01-09T10:00:00.000Z', originatingRevision: null,
      method: 'external_ai', provider: { name: 'OpenCode engine', model: null, aiGenerated: true },
      candidate: strategy, rationale: 'Tighten the entry.', warnings: [], changes: ['RSI period 14 -> 10'],
      changeDetails: [], applied: false, executes: false,
    };
    const chartMessages = await adaptMessages([
      userMessage('u1', 'read chart', 1000),
      assistantToolCall('a1', 2000, 'get_chart_result', { jobId: 'chart1' }, { status: 'succeeded', jobId: 'chart1', kind: 'chart', readingKind: 'screen' }),
      assistantText('a2', 3000, 'The chart shows an RSI uptrend.'),
    ], { resolveJobResult: jobId => jobId === 'chart1' ? chartReading : undefined });
    const chartPayload = parseResearchChatResponse(chartMessages.at(-1)!.payload);
    expect(chartPayload.kind).toBe('screen');

    const proposalMessages = await adaptMessages([
      userMessage('u1', 'tighten it', 1000),
      assistantToolCall('a1', 2000, 'propose_strategy_edit', { candidate: strategy, rationale: 'Tighten the entry.', changes: ['RSI 14 -> 10'] }, { status: 'ok', kind: 'proposal', proposal }),
      assistantText('a2', 3000, 'Draft ready for review.'),
    ]);
    const proposalPayload = parseResearchChatResponse(proposalMessages.at(-1)!.payload);
    expect(proposalPayload.kind).toBe('proposal');
    if (proposalPayload.kind === 'proposal') expect(proposalPayload.proposal.applied).toBe(false);
  });

  it('maps an approval gate and a failed tool without inventing a result', async () => {
    const gated = await adaptMessages([
      userMessage('u1', 'run it', 1000),
      assistantToolCall('a1', 2000, 'run_backtest', { strategy }, {
        status: 'approval_required', approvalId: 'apr_1',
        approval: { id: 'apr_1', tool: 'run_backtest', status: 'pending', title: 'Run backtest', summary: ['Stop loss 5%.'] },
        assumptions: ['Stop loss 5%.'], note: 'Wait for the operator.',
      }),
    ]);
    const tool = gated.find(message => message.role === 'tool')!;
    expect(tool.approval).toMatchObject({ id: 'apr_1', tool: 'run_backtest', status: 'pending', title: 'Run backtest' });
    expect(tool.approval?.summary).toEqual(['Stop loss 5%.']);
    expect(tool.result).toBeUndefined();

    const failed = await adaptMessages([{
      id: 'a2', type: 'assistant', time: { created: 4000 },
      content: [{ type: 'tool', id: 'call_x', name: 'get_scan_result', state: { status: 'error', content: [{ type: 'text', text: 'Provider timed out.' }] } }],
    }]);
    const failedTool = failed.find(message => message.role === 'tool')!;
    expect(failedTool.result).toBeUndefined();
    expect(failedTool.text).toMatch(/Provider timed out/);
  });

  it('normalizes tool activity and forwards the plan from todowrite', async () => {
    const messages = await adaptMessages([{
      id: 'a1', type: 'assistant', time: { created: 1000 },
      content: [
        {
          type: 'tool', id: 'call_todo', name: 'todowrite', time: { created: 1000, completed: 1120 },
          state: {
            status: 'completed',
            input: { todos: [{ content: 'Scan the market', status: 'completed' }, { content: 'Run a backtest', status: 'pending' }] },
            content: [{ type: 'text', text: 'Todos updated: 1/2 completed, 1 pending' }],
            metadata: { todos: [{ content: 'Scan the market', status: 'completed' }, { content: 'Run a backtest', status: 'pending' }] },
          },
        },
        {
          type: 'tool', id: 'call_bad', name: 'get_scan_result', time: { created: 1200, completed: 1250 },
          state: { status: 'completed', input: { jobId: 'j1' }, content: [{ type: 'text', text: JSON.stringify({ status: 'failed', error: { code: 'PROVIDER_DOWN', message: 'No data.' } }) }] },
        },
      ],
    }]);
    const assistant = messages.find(message => message.role === 'assistant')!;
    expect(assistant.activities).toHaveLength(2);
    expect(assistant.activities?.[0]).toMatchObject({ type: 'tool', name: 'todowrite', status: 'success', summary: '1/2 plan steps done', durationMs: 120 });
    expect(assistant.activities?.[1]).toMatchObject({ name: 'get_scan_result', status: 'failed', error: { code: 'PROVIDER_DOWN', message: 'No data.' } });
    expect(assistant.todos).toEqual([
      { content: 'Scan the market', status: 'completed' },
      { content: 'Run a backtest', status: 'pending' },
    ]);
    const tool = messages.find(message => message.role === 'tool')!;
    expect(tool.activity).toMatchObject({ name: 'todowrite', status: 'success' });
  });

  it('builds a stable seq index and turns execution errors into readable text', () => {
    const index = buildSeqIndex([
      { type: 'session.inbox.enqueued', durable: { seq: 1 }, data: { inboxID: 'u1' } },
      { type: 'session.execution.started', durable: { seq: 2 }, data: {} },
      { type: 'session.step.started', durable: { seq: 3 }, data: { assistantMessageID: 'a1' } },
      { type: 'session.step.ended', durable: { seq: 4 }, data: { assistantMessageID: 'a1' } },
      { type: 'session.inbox.delivered', durable: { seq: 5 }, data: { inboxID: 'u1' } },
      { type: 'log.synced', seq: 5 },
    ]);
    expect(index.lastSeq).toBe(5);
    expect(index.byMessageId.get('u1')).toBe(5000);
    expect(index.byMessageId.get('a1')).toBe(4000);
    expect(idleErrorText({ type: 'provider.no-route', message: 'No route for this model.' })).toBe('No route for this model.');
    expect(idleErrorText(undefined)).toMatch(/did not complete/i);
  });
});
