import { describe, expect, it } from 'vitest';
import { displayCardTitle } from '../../components/chat/displayTitle';

describe('displayCardTitle', () => {
  it('lifts a lowercase first letter without touching the rest', () => {
    expect(displayCardTitle('near 52-week low · RSI above its average')).toBe('Near 52-week low · RSI above its average');
    expect(displayCardTitle('oversold with an EMA reclaim · RSI below 30')).toBe('Oversold with an EMA reclaim · RSI below 30');
  });

  it('leaves an already capitalised title exactly as it is', () => {
    expect(displayCardTitle('RSI below 30 · Nifty 50')).toBe('RSI below 30 · Nifty 50');
    expect(displayCardTitle('NESTLEIND near its 52-week low')).toBe('NESTLEIND near its 52-week low');
  });

  it('does not capitalise what is not a leading letter', () => {
    expect(displayCardTitle('% above its 52-week low')).toBe('% above its 52-week low');
    expect(displayCardTitle('')).toBe('');
  });
});
