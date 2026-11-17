import { describe, expect, it } from 'vitest';
import { isInformationalQuestion } from '../../server/ai/intent';

describe('informational question routing', () => {
  it('accepts a question mark anywhere and a leading conjunction', () => {
    expect(isInformationalQuestion('And what about a trailing stop? One sentence.')).toBe(true);
    expect(isInformationalQuestion('Why use a stop loss?')).toBe(true);
    expect(isInformationalQuestion('But how does RSI work')).toBe(true);
    expect(isInformationalQuestion('Then explain ATR')).toBe(true);
  });

  it('keeps explicit edits as actions', () => {
    expect(isInformationalQuestion('Set a 2% trailing stop')).toBe(false);
    expect(isInformationalQuestion('And change my stop to 4%')).toBe(false);
    expect(isInformationalQuestion('Add a volume filter')).toBe(false);
  });

  it('treats a no-op instruction inside a question as a question', () => {
    expect(isInformationalQuestion('What is RSI? Set nothing.')).toBe(true);
  });
});
