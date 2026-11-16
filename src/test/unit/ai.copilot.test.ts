import { describe, it, expect } from 'vitest';
import {
  applyStrategyEdit, getAIStatus, handleAIChat, normaliseChatReply, optimizeStrategyForProfitability, parseStrategyPrompt, resolveSymbolFromPrompt,
  StrategyValidationError,
} from '../../server/ai/copilot';
import { createRequestBudget } from '../../server/ai/provider';
import { fakeBacktest, fakeResponse, openAIBody, READY_ENV, recordingFetch, validStrategy } from '../../server/ai/testFixtures';
import { getSymbolByTicker } from '../../shared/data/symbols';

const none = { env: { AI_PROVIDER: 'none' } };

describe('optimizer is a validated proposal generator', () => {
  it('only varies existing parameters, adds no rules/controls, labels local_heuristic and in-sample', () => {
    const base = validStrategy(); // takeProfit set, trailingStop null
    const calls: number[] = [];
    const r = optimizeStrategyForProfitability(base, 'make it profitable', { backtest: (s) => { calls.push(1); return fakeBacktest(s); } });
    expect(r.providerUsed).toBe('local_heuristic');
    expect(r.method).toBe('parameter_sweep');
    expect(r.proposalOnly).toBe(true);
    expect(r.inSample).toBe(true);
    expect(r.optimizedStrategy.rules).toEqual(base.rules);
    expect(r.optimizedStrategy.risk.trailingStop).toBeNull();
    expect(r.optimizedStrategy.indicators.map((i) => i.id)).toEqual(base.indicators.map((i) => i.id));
    expect(r.trialsCount).toBeLessThanOrEqual(150);
    expect(calls.length).toBeLessThanOrEqual(151);
    expect(r.warnings.join(' ')).toMatch(/in-sample/);
    expect(r.warnings.join(' ')).toMatch(/Nothing was applied/);
    expect(r.assistantMessage).not.toMatch(/guarantee profit|highest-performing/i);
  });

  it('keeps the baseline when nothing ranks higher', () => {
    const flat = (s: any) => ({ metrics: { netPnl: 100, winRate: 50, profitFactor: 1, maxDrawdownPercent: 5, sharpeRatio: 1, totalTrades: 30 } }) as any;
    const r = optimizeStrategyForProfitability(validStrategy(), 'optimize', { backtest: flat });
    expect(r.noImprovementFound).toBe(true);
    expect(r.optimizedStrategy).toEqual(validStrategy());
  });

  it('throws StrategyValidationError for an invalid strategy instead of repairing', () => {
    expect(() => optimizeStrategyForProfitability({ name: 'bad' } as any, 'x', { backtest: fakeBacktest })).toThrow(StrategyValidationError);
  });
});

describe('applyStrategyEdit', () => {
  it('applies only explicit edits to a copy and does not mutate the input', () => {
    const cur = validStrategy();
    const before = JSON.stringify(cur);
    const r = applyStrategyEdit(cur, 'set stop loss to 1.5%');
    expect(r.changed).toBe(true);
    expect(r.strategy.risk.stopLoss.value).toBe(1.5);
    expect(r.providerUsed).toBe('local_heuristic');
    expect(JSON.stringify(cur)).toBe(before);
  });
  it('unrecognised instruction returns the strategy unchanged', () => {
    const r = applyStrategyEdit(validStrategy(), 'do something clever');
    expect(r.changed).toBe(false);
    expect(r.strategy).toEqual(validStrategy());
  });
  it('whole-word symbol resolution: "switch" is not ITC', () => {
    expect(resolveSymbolFromPrompt('switch to daily')).toBeNull();
    expect(resolveSymbolFromPrompt('test on reliance')).toBe(getSymbolByTicker('RELIANCE')!.id);
    expect(resolveSymbolFromPrompt('test tata consultancy')).toBe(getSymbolByTicker('TCS')!.id);
    expect(resolveSymbolFromPrompt('test hdfc')).toBe(getSymbolByTicker('HDFCBANK')!.id);
  });
});

describe('parseStrategyPrompt', () => {
  it('local library lookup is labelled local_heuristic and aiConnected=false; every variation strictly valid', async () => {
    const r = await parseStrategyPrompt('nr7 narrow range breakout', 1, none);
    expect(r.providerUsed).toBe('local_heuristic');
    expect(r.aiConnected).toBe(false);
    expect(r.assistantMessage).toMatch(/not AI/);
    expect(r.assistantMessage).not.toMatch(/DeepSeek/i);
    expect(r.suggestedAction).not.toBe('run_backtest');
  });
  it('unknown prompt returns no variations rather than inventing a strategy', async () => {
    const r = await parseStrategyPrompt('qwertyuiop zzz', 1, none);
    expect(r.variations).toEqual([]);
  });
});

describe('handleAIChat', () => {
  it('provider none: honest reply, no fetch, not connected', async () => {
    const f = recordingFetch(() => fakeResponse({}));
    const r = await handleAIChat({ message: 'what is the weather and tell me a joke' }, { ...none, fetch: f });
    expect(f.calls).toHaveLength(0);
    expect(r.aiConnected).toBe(false);
    expect(r.providerUsed).toBe('local_heuristic');
    expect(r.reply).toMatch(/disabled/i);
  });

  it('ready provider: exactly one request for plain chat, labelled with provider:model', async () => {
    const f = recordingFetch(() => fakeResponse({ body: openAIBody('Hello there') }));
    const r = await handleAIChat({ message: 'explain ATR', history: [{ role: 'user', text: 'hi' }] }, { env: { ...READY_ENV }, fetch: f, budget: createRequestBudget() });
    expect(f.calls).toHaveLength(1);
    expect(r).toMatchObject({ reply: 'Hello there', providerUsed: 'openai:gpt-test', aiConnected: true, method: 'external_ai' });
  });

  it('labels the answering model and a fallback model honestly', async () => {
    const env = { AI_PROVIDER: 'opencode-go', OPENCODE_API_KEY: 'test-key-opencode-0001', AI_MODEL: 'hy4-flash-free', AI_COST_POLICY: 'free-only' };
    const primary = recordingFetch(() => fakeResponse({ body: openAIBody('Hello from HY4') }));
    const direct = await handleAIChat({ message: 'Hello, what can you help me with?' }, { env, fetch: primary, budget: createRequestBudget() });
    expect(direct.providerUsed).toBe('opencode-go:hy4-flash-free');
    expect(direct.reply).toBe('Hello from HY4');

    const responses = [
      { ok: false, status: 403, headers: { get: () => null }, text: async () => '{}' },
      fakeResponse({ body: openAIBody('Hello from LongCat') }),
    ];
    const fallback = recordingFetch(() => responses.shift());
    const out = await handleAIChat({ message: 'Hello, what can you help me with?' }, {
      env: { ...env, AI_FALLBACK_MODELS: 'opencode-go:longcat-2.5-free' }, fetch: fallback, budget: createRequestBudget(),
    });
    expect(out.providerUsed).toBe('opencode-go:longcat-2.5-free');
    expect(out.reply).toBe('Hello from LongCat');
  });

  it('ready provider failing does not silently become local or another provider', async () => {
    const f = recordingFetch(() => fakeResponse({ status: 503 }));
    const r = await handleAIChat({ message: 'explain ATR' }, { env: { ...READY_ENV, GEMINI_API_KEY: 'gem-other-key-7777' }, fetch: f, budget: createRequestBudget() });
    expect(f.calls).toHaveLength(1);
    expect(new URL(f.calls[0].url).host).toBe('api.openai.com');
    expect(r.aiConnected).toBe(false);
    expect(r.providerUsed).toBe('openai:gpt-test');
    expect(r.reply).toMatch(/failed/);
  });

  it('optimization intent uses local sweep only, makes zero network calls, and never suggests auto-run', async () => {
    const f = recordingFetch(() => fakeResponse({}));
    const r = await handleAIChat({ message: 'optimize this strategy', currentStrategy: validStrategy(), originatingRevision: 3 }, { env: { ...READY_ENV }, fetch: f, backtest: fakeBacktest });
    expect(f.calls).toHaveLength(0);
    expect(r.method).toBe('parameter_sweep');
    expect(r.suggestedAction).toBeUndefined();
    expect(r.proposal).toMatchObject({ originatingRevision: 3, method: 'parameter_sweep', applied: false, executes: false });
  });

  it('ordinary text containing ordinals/phrases does not select or run anything', async () => {
    const r = await handleAIChat({ message: 'first explain the risk', currentStrategy: validStrategy() }, none);
    expect(r.suggestedAction).toBeUndefined();
    expect(r.suggestedStrategy).toBeUndefined();
  });

  it('oversized history is bounded before reaching the provider', async () => {
    const f = recordingFetch(() => fakeResponse({ body: openAIBody('ok') }));
    const history = Array.from({ length: 200 }, () => ({ role: 'user' as const, text: 'q'.repeat(10_000) }));
    await handleAIChat({ message: 'explain ATR', history }, { env: { ...READY_ENV }, fetch: f, budget: createRequestBudget() });
    expect(f.calls[0].init.body.length).toBeLessThan(40_000);
  });

  it('invalid current strategy is refused without repair or network', async () => {
    const f = recordingFetch(() => fakeResponse({}));
    const r = await handleAIChat({ message: 'optimize', currentStrategy: { name: 'x' } as any }, { env: { ...READY_ENV }, fetch: f });
    expect(f.calls).toHaveLength(0);
    expect(r.reply).toMatch(/not valid/);
  });
});

describe('informational question intent', () => {
  it.each([
    'In one sentence, what does RSI measure?',
    'Explain how RSI works',
    'What is the meaning of MACD?',
    'Why do breakouts fail?',
  ])('keeps %s in conversation instead of drafting a strategy', async (message) => {
    const r = await handleAIChat({ message, currentStrategy: validStrategy() }, none);
    expect(r.proposal).toBeUndefined();
    expect(r.suggestedStrategy).toBeUndefined();
    expect(r.reply).not.toMatch(/draft/i);
  });

  it('uses the configured provider for the answer, not a proposal request', async () => {
    const f = recordingFetch(() => fakeResponse({ body: openAIBody('RSI measures momentum.') }));
    const r = await handleAIChat({ message: 'In one sentence, what does RSI measure?' }, { env: { ...READY_ENV }, fetch: f, budget: createRequestBudget() });
    expect(f.calls).toHaveLength(1);
    expect(r).toMatchObject({ aiConnected: true, reply: 'RSI measures momentum.' });
    expect(r.proposal).toBeUndefined();
    expect(r.suggestedStrategy).toBeUndefined();
    expect(JSON.parse(f.calls[0].init.body).messages[1].content).toBeTruthy();
    expect(JSON.parse(JSON.parse(f.calls[0].init.body).messages[1].content)).toMatchObject({ task: 'chat' });
  });

  it('still drafts when the user actually asks to build or change something', async () => {
    const build = await handleAIChat({ message: 'Build an RSI strategy' }, none);
    expect(build.proposal?.method).toBe('local_heuristic');
    expect(build.suggestedStrategy).toBeDefined();
    const edit = await handleAIChat({ message: 'Set stop loss to 4%', currentStrategy: validStrategy() }, none);
    expect(edit.proposal).toBeDefined();
    expect(edit.proposal?.candidate.risk.stopLoss.value).toBe(4);
  });
});

describe('status and startup safety', () => {
  it('importing the module and reading status touches no network (fetch denied in setup)', () => {
    expect(() => getAIStatus({ AI_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'k-deepseek-abcdef' })).not.toThrow();
  });
});

describe('chat replies never show raw JSON', () => {
  const envelope = JSON.stringify({
    rationale: 'The market_data contains a delayed end-of-day close.',
    warnings: ['This is a delayed end-of-day observed close, not a real-time quote.'],
    strategy: null,
    answer: 'Latest observed Nifty 50 (^NSEI) close: 25,144.30, dated 2026-11-13 (source: YAHOO_PUBLIC_CHART, public delayed end-of-day). Previous close 25,299.35, change -0.61%. This is not a real-time quote.',
  });

  it('unwraps the answer field and keeps only new warnings', () => {
    const reply = normaliseChatReply(envelope);
    expect(reply).toMatch(/^Latest observed Nifty 50 \(\^NSEI\) close: 25,144\.30/);
    expect(reply).toContain('2026-11-13');
    expect(reply).toContain('YAHOO_PUBLIC_CHART');
    expect(reply).toContain('Note: This is a delayed end-of-day observed close, not a real-time quote.');
    expect(reply).not.toContain('"answer"');
    expect(reply).not.toContain('"strategy"');
    expect(reply.trim().startsWith('{')).toBe(false);
  });

  it('accepts reply, message and text fields and skips warnings already in the prose', () => {
    expect(normaliseChatReply('{"reply":"Use the screener first."}')).toBe('Use the screener first.');
    expect(normaliseChatReply('{"message":"Hello."}')).toBe('Hello.');
    expect(normaliseChatReply('{"text":"Delayed close only."}')).toBe('Delayed close only.');
    expect(normaliseChatReply(JSON.stringify({ answer: 'Delayed close only.', warnings: ['Delayed close only.', 'Not a live quote.'] }))).toBe('Delayed close only.\n\nNote: Not a live quote.');
  });

  it('unwraps fenced or double-encoded JSON and leaves ordinary Markdown alone', () => {
    expect(normaliseChatReply('```json\n{"answer":"Fenced answer"}\n```')).toBe('Fenced answer');
    expect(normaliseChatReply(JSON.stringify({ answer: JSON.stringify({ answer: 'Nested answer' }) }))).toBe('Nested answer');
    expect(normaliseChatReply('Hello\n- **Bold** item\n- `code` item')).toBe('Hello\n- **Bold** item\n- `code` item');
  });

  it('never falls back to showing an unrecognised JSON object verbatim', () => {
    const reply = normaliseChatReply('{"strategy":{"name":"x"}}');
    expect(reply).toMatch(/structured response/);
    expect(reply).not.toContain('{');
  });

  it('asks the chat model for prose, not the strategy JSON schema', async () => {
    const f = recordingFetch(() => fakeResponse({ body: openAIBody('Hello, I can help.') }));
    const r = await handleAIChat({ message: 'Hello, what can you help me with?' }, { env: { ...READY_ENV }, fetch: f, budget: createRequestBudget() });
    const system = JSON.parse(f.calls[0].init.body).messages[0].content as string;
    expect(system).toContain('Reply in plain conversational text or simple Markdown. Never reply with JSON.');
    expect(system).not.toMatch(/output ONE JSON object/i);
    expect(system).not.toMatch(/Schema:\s*\{/);
    expect(system).not.toMatch(/"strategy"/);
    expect(r.reply).toBe('Hello, I can help.');
  });

  it('sanitises a JSON answer returned by the live chat path', async () => {
    const f = recordingFetch(() => fakeResponse({ body: openAIBody(envelope) }));
    const r = await handleAIChat({ message: 'Hello, what can you help me with?' }, { env: { ...READY_ENV }, fetch: f, budget: createRequestBudget() });
    expect(r.aiConnected).toBe(true);
    expect(r.reply).toMatch(/^Latest observed Nifty 50/);
    expect(r.reply).not.toContain('"rationale"');
    expect(r.reply).not.toContain('"strategy"');
  });
});

