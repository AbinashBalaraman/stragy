import { describe, expect, it } from 'vitest';
import { looksLikeReasoning } from '../../server/ai/validation';

const sentence = "I'd use a stop loss because it caps the loss on one idea; I size the position so a bad trade cannot erase many good ones; I place it below real support so normal noise does not trigger it. ";
const clean500 = sentence.repeat(3).slice(0, 500).trim();
const clean800 = sentence.repeat(5).slice(0, 800).trim();

describe('reasoning detection', () => {
  it('accepts a normal 500-character answer with three I usages', () => {
    expect((clean500.match(/\bI\b/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(clean500.length).toBeGreaterThan(420);
    expect(looksLikeReasoning(clean500)).toBe(false);
  });

  it('accepts an 800-character clean explanation', () => {
    expect(clean800.length).toBe(800);
    expect(looksLikeReasoning(clean800)).toBe(false);
  });

  it('rejects a chain-of-thought plan', () => {
    expect(looksLikeReasoning('The user wants a stop-loss explanation. Step 1: inspect the request. Step 2: decide on an answer.')).toBe(true);
    expect(looksLikeReasoning('Let me think about the best way to answer this.')).toBe(true);
    expect(looksLikeReasoning('I need to check the schema before replying.')).toBe(true);
  });

  it('rejects raw schema and prompt deliberation', () => {
    expect(looksLikeReasoning('The request is to preserve current_strategy and symbolId exactly. The hard schema requires it.')).toBe(true);
    expect(looksLikeReasoning('The user asked for a draft. previous_output failed validation_errors.')).toBe(true);
  });

  it('keeps ordinary prose openers that are not planning', () => {
    expect(looksLikeReasoning('Let me explain why a stop loss matters: it defines the most you can lose on a trade.')).toBe(false);
    expect(looksLikeReasoning("I'd place the stop below support; I would size the position so the loss stays small.")).toBe(false);
  });
});
