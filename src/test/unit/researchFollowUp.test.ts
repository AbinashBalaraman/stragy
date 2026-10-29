import { describe, expect, it } from 'vitest';
import {
  classifyReviewReply,
  parseBacktestIntent,
  resolveStock,
  summarizeProviderFailures,
} from '../../components/chat/researchFollowUp';
import type { SymbolMeta } from '../../shared/strategy/types';

const symbol = (id: number, ticker: string, name: string): SymbolMeta => ({
  id, ticker, name, exchange: 'NSE', sector: 'Test', currentPrice: 100, changePercent: 0,
});

const symbols = [
  symbol(7, 'RELIANCE', 'Reliance Industries'),
  symbol(8, 'RELIANCEPOWER', 'Reliance Power'),
  symbol(9, 'TCS', 'Tata Consultancy Services'),
];

describe('local follow-up intent parsing', () => {
  it('understands an explicit backtest follow-up and its stock', () => {
    expect(parseBacktestIntent('backtest this on RELIANCE')).toEqual({ kind: 'backtest', stockQuery: 'RELIANCE' });
    expect(parseBacktestIntent('test this for reliance industries please')).toEqual({ kind: 'backtest', stockQuery: 'reliance industries' });
  });

  it('leaves the stock missing when the request only points at the current screen', () => {
    expect(parseBacktestIntent('backtest this')).toEqual({ kind: 'backtest', stockQuery: null });
    expect(parseBacktestIntent('simulate it')).toEqual({ kind: 'backtest', stockQuery: null });
  });

  it('treats negation as negation, not as an instruction that still runs', () => {
    expect(parseBacktestIntent('do not backtest this on RELIANCE')).toEqual({ kind: 'negated', stockQuery: null });
    expect(parseBacktestIntent("don't run a test on RELIANCE")).toEqual({ kind: 'negated', stockQuery: null });
    expect(parseBacktestIntent('never backtest this')).toEqual({ kind: 'negated', stockQuery: null });
  });

  it('does not claim unrelated text is a backtest intent', () => {
    expect(parseBacktestIntent('set my stop loss to 3%')).toEqual({ kind: 'none', stockQuery: null });
    expect(parseBacktestIntent('   ')).toEqual({ kind: 'none', stockQuery: null });
  });
});

describe('unambiguous stock resolution', () => {
  it('resolves an exact ticker or exact name', () => {
    expect(resolveStock('reliance', 'backtest this on reliance', symbols)).toMatchObject({ status: 'resolved', symbol: { id: 7 } });
    expect(resolveStock('Reliance Industries', 'backtest this on Reliance Industries', symbols)).toMatchObject({ status: 'resolved', symbol: { id: 7 } });
    expect(resolveStock('tcs.ns', 'test tcs.ns', symbols)).toMatchObject({ status: 'resolved', symbol: { id: 9 } });
  });

  it('reports ambiguity instead of guessing an instrument', () => {
    const resolution = resolveStock('REL', 'backtest this on REL', symbols);
    expect(resolution.status).toBe('ambiguous');
    if (resolution.status === 'ambiguous') {
      expect(resolution.candidates.map(candidate => candidate.ticker)).toEqual(['RELIANCE', 'RELIANCEPOWER']);
    }
  });

  it('returns missing rather than assuming the first stock', () => {
    expect(resolveStock(null, 'backtest this', symbols)).toEqual({ status: 'missing' });
    expect(resolveStock('NIFTY', 'backtest this on NIFTY', symbols)).toEqual({ status: 'missing' });
    expect(resolveStock('RELIANCE', 'backtest this on RELIANCE', [])).toEqual({ status: 'missing' });
  });
});

describe('explicit review consent', () => {
  it('accepts only explicit approval phrases', () => {
    expect(classifyReviewReply('use these assumptions and run')).toBe('approve');
    expect(classifyReviewReply('Use these assumptions and run!')).toBe('approve');
    expect(classifyReviewReply('yes, run it')).toBe('approve');
    expect(classifyReviewReply('go ahead and run')).toBe('approve');
  });

  it('separates choosing assumptions from approving execution', () => {
    expect(classifyReviewReply('use these assumptions')).toBe('assumptions');
    expect(classifyReviewReply('yes, use these assumptions')).toBe('assumptions');
    expect(classifyReviewReply('use these assumptions and run')).toBe('approve');
  });

  it('rejects a negation even when it also contains approval words', () => {
    expect(classifyReviewReply("no, don't run it")).toBe('reject');
    expect(classifyReviewReply('do not use these assumptions and run')).toBe('reject');
    expect(classifyReviewReply('use these assumptions but do not run')).toBe('reject');
    expect(classifyReviewReply('use these assumptions and run, but do not sell')).toBe('reject');
    expect(classifyReviewReply('wait')).toBe('reject');
    expect(classifyReviewReply('cancel')).toBe('reject');
  });

  it('does not mistake a new strategy change request for a review reply', () => {
    expect(classifyReviewReply('change stop loss to 5%')).toBe('none');
    expect(classifyReviewReply('set stop loss to 5%')).toBe('none');
  });

  it('treats ambiguous chatter as no consent', () => {
    expect(classifyReviewReply('maybe later')).toBe('none');
    expect(classifyReviewReply('use these assumptions and run it on RELIANCE')).toBe('none');
    expect(classifyReviewReply('')).toBe('none');
  });
});

describe('provider failure summary', () => {
  it('keeps a concise count and sample tickers while preserving the total', () => {
    expect(summarizeProviderFailures([])).toBe('');
    expect(summarizeProviderFailures([{ ticker: 'ONE', code: 'HTTP_504' }])).toBe('1 instrument could not be evaluated (ONE).');
    expect(summarizeProviderFailures([
      { ticker: 'ONE' }, { ticker: 'TWO' }, { ticker: 'THREE' }, { symbolId: 42 },
    ])).toBe('4 instruments could not be evaluated (ONE, TWO, THREE, …).');
  });
});
