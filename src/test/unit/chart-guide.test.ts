import { describe, expect, it } from 'vitest';
import { ChartObservationsSchema, parseResearchChatResponse } from '../../shared/contracts/research-chat';
import { analyzeChart, buildChartStrategy, mergeChartConditions, resolveChartSymbol, type ChartCondition } from '../../server/ai/chartVision';
import { fakeResponse, openAIBody, recordingFetch, validStrategy } from '../../server/ai/testFixtures';
import { validateStrategy } from '../../shared/strategy/schema';
import type { ChartObservations } from '../../shared/contracts/research-chat';

const visionEnv = {
  AI_PROVIDER: 'openai',
  OPENAI_API_KEY: 'fixture-vision-key',
  AI_MODEL: 'gpt-test',
  AI_COST_POLICY: 'operator-approved',
} as const;

const observations = (overrides: Partial<ChartObservations> = {}): ChartObservations => ({
  timeframe: '1D',
  indicators: [{ name: 'RSI (14, close)', params: [14], legendValues: [45.76, 31.9], legendRoles: ['current', 'ma'] }],
  drawnLines: [],
  priceTrend: 'downtrend',
  nearRange: 'low',
  lastCandle: 'bullish',
  events: [],
  ...overrides,
});

const plan = (conditions: ChartCondition[], overrides: Record<string, unknown> = {}) => ({
  conditions,
  confidence: 0.82,
  summary: 'Chart setup',
  assumptions: [],
  ...overrides,
});

const png = 'data:image/png;base64,' + Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64');
const image = { dataUrl: png, mimeType: 'image/png' as const, base64: png.split(',')[1], bytes: 8 };

describe('chart guide deterministic mapping', () => {
  it('maps a falling RSI line crossed above, a recent dip and a near-low range', () => {
    const merged = mergeChartConditions(observations({
      drawnLines: [{
        panel: 'rsi', direction: 'down', description: 'falling RSI resistance',
        start: { when: 'late Jun', value: 73 }, end: { when: 'early Oct', value: 30 }, lastBarRelation: 'crossed_above',
      }],
      recentBars: { note: 'RSI was below 30 three bars ago', rsiBelow30BarsAgo: 3 },
      rangePosition: { approxPctAboveLow: 11 },
    }));

    expect(merged.conditions).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'rsi_trendline_breakout', period: 14, lookbackBars: 5 }),
      expect.objectContaining({ type: 'rsi_below', value: 30, lookbackBars: 5 }),
      expect.objectContaining({ type: 'rsi_above_signal', period: 14 }),
      expect.objectContaining({ type: 'near_period_low', period: 250, value: 15 }),
    ]));
    expect(merged.assumptions.join(' ')).toMatch(/drawn falling RSI line crossed above/i);
  });

  it('infers the falling RSI breakout when the model marks only the breakout event', () => {
    const merged = mergeChartConditions(observations({
      drawnLines: [{ panel: 'rsi', direction: 'unknown', description: 'falling RSI resistance' }],
      events: ['breakout above the falling RSI resistance'],
      nearRange: 'high',
    }), []);
    expect(merged.conditions).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'rsi_trendline_breakout', period: 14 }),
    ]));
  });

  it('never accepts a legend MA value as a threshold', () => {
    const merged = mergeChartConditions(observations(), [
      { type: 'rsi_around_value', value: 31.9, tolerance: 6 },
      { type: 'rsi_around_value', value: 45.76, tolerance: 6 },
    ]);

    expect(merged.conditions.some(condition => condition.value === 31.9)).toBe(false);
    expect(merged.conditions.some(condition => condition.type === 'rsi_around_value' && condition.value === 45.76)).toBe(true);
  });

  it('treats E/D markers as events, never conditions', () => {
    const merged = mergeChartConditions(observations({ events: ['E earnings', 'D dividend'] }));
    expect(merged.assumptions.join(' ')).toMatch(/calendar markers.*not conditions/i);
    expect(merged.conditions.some(condition => /earn|dividend|event/i.test(condition.type))).toBe(false);
  });

  it('maps a flat price box crossed above to the new N-day-high breakout condition', () => {
    const chart = observations({
      header: { symbol: 'RELIANCE', exchange: 'NSE', lastClose: 1344.8 },
      indicators: [],
      drawnLines: [{ panel: 'price', direction: 'flat', description: 'flat 60-day box', lastBarRelation: 'crossed_above' }],
      priceTrend: 'sideways',
      nearRange: 'high',
    });
    const merged = mergeChartConditions(chart);
    expect(merged.conditions).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'price_breakout_high', period: 60 }),
    ]));
    const built = buildChartStrategy(plan(merged.conditions), validStrategy(), chart);
    expect(built.strategy.indicators.some(indicator => indicator.type === 'HIGHEST' && indicator.params.period === 60)).toBe(true);
    expect(built.strategy.rules.entry.some(rule => rule.operator === 'crossesAbove' && rule.leftIndicator === 'close')).toBe(true);
    expect(validateStrategy(built.strategy).success).toBe(true);
  });

  it('loosens a tight near-low value from the model and reports the drop when capping at five', () => {
    const chart = observations({
      drawnLines: [{ panel: 'rsi', direction: 'down', description: 'falling RSI line', lastBarRelation: 'crossed_above' }],
      recentBars: { note: 'RSI dipped', rsiBelow30BarsAgo: 3 },
      rangePosition: undefined,
      nearRange: 'low',
    });
    const merged = mergeChartConditions(chart, [
      { type: 'near_period_low', period: 250, value: 5 },
      { type: 'rsi_around_value', value: 45.76, tolerance: 6 },
      { type: 'macd_above_signal' },
      { type: 'volume_above_sma', period: 20 },
    ]);
    expect(merged.conditions).toHaveLength(5);
    expect(merged.conditions.find(condition => condition.type === 'near_period_low')?.value).toBe(15);
    expect(merged.assumptions.join(' ')).toMatch(/near-low threshold widened to 15%/i);
    expect(merged.assumptions.join(' ')).toMatch(/dropped to keep the scan findable:/i);
  });

  it('drops a model-only breakout that is not visible as a drawn price box', () => {
    const merged = mergeChartConditions(observations({ drawnLines: [], priceTrend: 'sideways', nearRange: 'high' }), [
      { type: 'price_breakout_high', period: 60 },
    ]);
    expect(merged.conditions.some(condition => condition.type === 'price_breakout_high')).toBe(false);
    expect(merged.assumptions.join(' ')).toMatch(/dropped model conditions that were not visible/i);
  });

  it('maps price above a legend EMA to price_above_ema with the legend period', () => {
    const chart = observations({
      header: { symbol: 'RELIANCE', exchange: 'NSE', lastClose: 1344.8 },
      indicators: [
        { name: 'EMA (50)', params: [50], legendValues: [1260.72], legendRoles: ['ma'] },
        { name: 'RSI (14, close)', params: [14], legendValues: [71.79, 62.55], legendRoles: ['current', 'ma'] },
      ],
      priceTrend: 'uptrend',
      nearRange: 'high',
    });
    const merged = mergeChartConditions(chart);
    expect(merged.conditions).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'price_above_ema', period: 50 }),
    ]));
    const built = buildChartStrategy(plan(merged.conditions), validStrategy(), chart);
    expect(built.strategy.indicators.some(indicator => indicator.type === 'EMA' && indicator.params.period === 50)).toBe(true);
    expect(validateStrategy(built.strategy).success).toBe(true);
  });
});

describe('chart observation schema compatibility', () => {
  it('keeps the old required observation fields valid and accepts the additive guide fields', () => {
    const old = {
      timeframe: '1D',
      indicators: [{ name: 'RSI', params: [14], legendValues: [45.76, 31.9] }],
      drawnLines: [{ panel: 'rsi', direction: 'down', description: 'falling line' }],
      priceTrend: 'downtrend',
      nearRange: 'low',
      lastCandle: 'bullish',
      events: [],
    };
    expect(ChartObservationsSchema.safeParse(old).success).toBe(true);
    const extended = {
      ...old,
      header: { symbol: 'RELIANCE', exchange: 'NSE', timeframe: '1D', lastClose: 1344.8, lastChangePct: 0.38 },
      indicators: [{ ...old.indicators[0], legendRoles: ['current', 'ma'] }],
      drawnLines: [{ ...old.drawnLines[0], start: { when: 'late Jun', value: 73 }, end: { when: 'early Oct', value: 30 }, lastBarRelation: 'crossed_above' }],
      recentBars: { note: 'RSI dipped', rsiBelow30BarsAgo: 3 },
      rangePosition: { approxPctAboveLow: 11 },
    };
    expect(ChartObservationsSchema.safeParse(extended).success).toBe(true);
  });

  it('coerces small-model number strings and case/vocabulary drift instead of discarding a readable chart', () => {
    const parsed = ChartObservationsSchema.safeParse({
      timeframe: '1D',
      indicators: [{ name: 'RSI', params: '14', legendValues: '45.76, 31.90', legendRoles: ['CURRENT', 'MA'] }],
      drawnLines: [{ panel: 'RSI', direction: 'DOWN', description: 'falling line', lastBarRelation: 'CROSSED_ABOVE' }],
      priceTrend: 'DOWNTREND',
      nearRange: 'LOW',
      lastCandle: 'BULLISH',
      recentBars: { note: 'RSI dipped', rsiBelow30BarsAgo: '13 bars' },
      rangePosition: { approxPctAboveLow: '4%' },
      events: [{ type: 'dividend', label: 'D' }],
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error('expected coerced observations');
    expect(parsed.data.indicators[0].params).toEqual([14]);
    expect(parsed.data.indicators[0].legendValues).toEqual([45.76, 31.9]);
    expect(parsed.data.drawnLines[0].panel).toBe('rsi');
    expect(parsed.data.drawnLines[0].lastBarRelation).toBe('crossed_above');
    expect(parsed.data.recentBars?.rsiBelow30BarsAgo).toBe(13);
    expect(parsed.data.rangePosition?.approxPctAboveLow).toBe(4);
    expect(parsed.data.events).toEqual(['D']);
  });
});

describe('chart self-check', () => {
  it('repairs once with the failing actual values and reports the counted result', async () => {
    const chart: ChartObservations = {
      header: { symbol: 'RELIANCE', exchange: 'NSE', lastClose: 1344.8 },
      timeframe: '1D',
      indicators: [
        { name: 'RSI (14, close)', params: [14], legendValues: [71.79, 62.55], legendRoles: ['current', 'ma'] },
        { name: 'EMA (50)', params: [50], legendValues: [1260.72], legendRoles: ['ma'] },
      ],
      drawnLines: [],
      priceTrend: 'uptrend',
      nearRange: 'high',
      lastCandle: 'bullish',
      events: ['D dividend'],
      rangePosition: { approxPctAboveLow: 16.7 },
    };
    const initialPlan = plan([
      { type: 'rsi_above_signal', period: 14 },
      { type: 'price_above_ema', period: 50 },
      { type: 'near_period_low', period: 250, value: 15 },
    ]);
    const repairedPlan = plan([
      { type: 'rsi_above_signal', period: 14 },
      { type: 'price_above_ema', period: 50 },
      { type: 'near_period_low', period: 250, value: 25 },
    ]);
    let textCalls = 0;
    const f = recordingFetch((_url, init) => {
      const body = JSON.parse(init.body);
      if (Array.isArray(body.messages[1].content)) return fakeResponse({ body: openAIBody(JSON.stringify(chart)) });
      textCalls++;
      return fakeResponse({ body: openAIBody(JSON.stringify(textCalls === 1 ? initialPlan : repairedPlan)) });
    });
    const evaluations: number[] = [];
    const evaluation = await analyzeChart({ image, currentStrategy: validStrategy() }, {
      env: visionEnv,
      fetch: f,
      selfCheck: async ({ symbol, strategy }) => {
        expect(symbol.ticker).toBe('RELIANCE');
        const near = strategy.rules.entry.find(rule => rule.rightValue !== undefined && rule.rightIndicator === undefined && (rule.rightValue === 20 || rule.rightValue === 25));
        evaluations.push(Number(near?.rightValue));
        if (evaluations.length === 1) {
          return { matched: 2, total: 3, failures: ['Close is within 20% of the 250-bar low; actual 16.72 vs 20 on 2026-11-16'] };
        }
        return { matched: 3, total: 3, failures: [] };
      },
    });

    expect(evaluation.kind).toBe('screen');
    if (evaluation.kind !== 'screen') throw new Error('screen expected');
    expect(evaluations).toEqual([20, 25]);
    expect(evaluation.selfCheck).toMatchObject({
      status: 'checked', symbol: 'RELIANCE', matched: 3, total: 3, repaired: true,
      line: 'Checked against RELIANCE: matches 3 of 3 conditions',
    });
    expect(evaluation.strategy.rules.entry.some(rule => rule.rightValue === 25)).toBe(true);
    expect(evaluation.warnings.join(' ')).toMatch(/self-check repair/i);
    expect(parseResearchChatResponse(evaluation)).toEqual(evaluation);
    // Both model passes and the repair call are deterministic.
    expect(f.calls.every(call => JSON.parse(call.init.body).temperature === 0)).toBe(true);
  });

  it('never invents a check for an index or unknown charted symbol', async () => {
    const chart: ChartObservations = observations({
      header: { symbol: 'NIFTY 50 · 1D · NSE', exchange: 'NSE' },
      priceTrend: 'sideways',
      nearRange: 'high',
      drawnLines: [],
    });
    const f = recordingFetch((_url, init) => {
      const body = JSON.parse(init.body);
      if (Array.isArray(body.messages[1].content)) return fakeResponse({ body: openAIBody(JSON.stringify(chart)) });
      return fakeResponse({ body: openAIBody(JSON.stringify(plan([{ type: 'rsi_above_signal', period: 14 }]))) });
    });
    const evaluation = await analyzeChart({ image, currentStrategy: validStrategy() }, {
      env: visionEnv,
      fetch: f,
      selfCheck: async () => { throw new Error('Self-check must not run for an unknown symbol'); },
    });
    expect(evaluation.kind).toBe('screen');
    if (evaluation.kind !== 'screen') throw new Error('screen expected');
    expect(evaluation.selfCheck).toEqual({ status: 'unknown_symbol', line: "Couldn't check against the charted stock" });
    expect(resolveChartSymbol({ symbol: 'NIFTY 50 · 1D · NSE' })).toBeNull();
    expect(resolveChartSymbol({ symbol: 'RELIANCE' })?.ticker).toBe('RELIANCE');
  });
});
