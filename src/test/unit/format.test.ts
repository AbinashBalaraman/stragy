import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatINR, formatNumber, formatPercent, truncateAtWord } from '../../shared/format';

describe('formatINR', () => {
  it('uses Indian grouping and two decimals', () => {
    expect(formatINR(874.914)).toBe('₹874.91');
    expect(formatINR(227395.665)).toBe('₹2,27,395.67');
    expect(formatINR(100000)).toBe('₹1,00,000.00');
  });

  it('puts the sign before the currency symbol', () => {
    expect(formatINR(-1149.413)).toBe('-₹1,149.41');
    expect(formatINR(1149.41, { signed: true })).toBe('+₹1,149.41');
    expect(formatINR(0, { signed: true })).toBe('₹0.00');
  });

  it('does not print negative zero or invent values', () => {
    expect(formatINR(-0)).toBe('₹0.00');
    expect(formatINR(-0.001)).toBe('₹0.00');
    expect(formatINR(Number.NaN)).toBe('N/A');
    expect(formatINR(undefined)).toBe('N/A');
  });
});

describe('formatPercent', () => {
  it('rounds to two decimals without exposing floats', () => {
    expect(formatPercent(1.134125124510941, { decimals: 2 })).toBe('1.13%');
    expect(formatPercent(0.6964780466217713, { decimals: 2 })).toBe('0.70%');
  });

  it('never doubles a plus sign', () => {
    expect(formatPercent(1.2, { signed: true })).toBe('+1.2%');
    expect(formatPercent(-1.2, { signed: true })).toBe('-1.2%');
    expect(formatPercent(1.2)).toBe('1.2%');
  });

  it('never prints negative zero', () => {
    expect(formatPercent(-0.04, { signed: true })).toBe('0.0%');
    expect(formatPercent(-0.0001, { decimals: 2 })).toBe('0.00%');
    expect(formatPercent(-0)).toBe('0.0%');
  });

  it('handles unavailable values', () => {
    expect(formatPercent(null)).toBe('N/A');
    expect(formatPercent(Number.POSITIVE_INFINITY)).toBe('N/A');
  });
});

describe('formatNumber', () => {
  it('uses fixed decimals and rounds', () => {
    expect(formatNumber(1.134125, 2)).toBe('1.13');
    expect(formatNumber(2, 0)).toBe('2');
    expect(formatNumber(0.12345)).toBe('0.12');
  });

  it('does not print negative zero', () => {
    expect(formatNumber(-0.001)).toBe('0.00');
  });

  it('returns N/A for unavailable values', () => {
    expect(formatNumber(undefined)).toBe('N/A');
    expect(formatNumber(Number.NaN)).toBe('N/A');
  });
});

describe('dates', () => {
  it('prints an en-IN calendar date instead of ISO', () => {
    expect(formatDate('2026-11-16')).toBe('16 Nov 2026');
    expect(formatDate('2024-11-18')).toBe('18 Nov 2024');
  });

  it('prints a human local date and time', () => {
    expect(formatDateTime(new Date(2026, 10, 16, 9, 4))).toBe('16 Nov 2026, 9:04 am');
    expect(formatDateTime(new Date(2026, 10, 16, 21, 4))).toBe('16 Nov 2026, 9:04 pm');
  });

  it('never leaks an ISO timestamp', () => {
    const text = formatDateTime('2026-11-16T09:04:46.778Z');
    expect(text).toMatch(/^\d{2} [A-Z][a-z]{2} \d{4}, \d{1,2}:\d{2} [ap]m$/);
  });

  it('returns N/A for missing or invalid dates', () => {
    expect(formatDate(undefined)).toBe('N/A');
    expect(formatDate('not a date')).toBe('N/A');
    expect(formatDateTime(null)).toBe('N/A');
  });
});

describe('truncateAtWord', () => {
  it('cuts at a word boundary and never exceeds the limit', () => {
    const title = 'Near range lows with RSI breaking above a falling resistance trendline and price still weak';
    const short = truncateAtWord(title, 70);
    expect(short.length).toBeLessThanOrEqual(70);
    expect(short.endsWith('…')).toBe(true);
    expect(title.startsWith(short.slice(0, -1).trimEnd())).toBe(true);
    expect(short).not.toMatch(/\s…$/);
  });

  it('keeps short titles unchanged and collapses whitespace', () => {
    expect(truncateAtWord('Near range lows · RSI breaking its downtrend', 70)).toBe('Near range lows · RSI breaking its downtrend');
    expect(truncateAtWord('  two   spaces  ', 70)).toBe('two spaces');
  });
});
