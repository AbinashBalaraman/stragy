/**
 * One formatting source for money, percentages, numbers and dates.
 *
 * Rules that matter to readers of a research screen:
 * - Indian grouping and exactly two decimals for money.
 * - The sign belongs before the currency symbol, e.g. `-₹1,149.41`.
 * - `signed` percentages never produce `++1.2%`, and a value that rounds to
 *   zero is `0.0%`, never `-0.0%`.
 * - Dates are human-readable (`16 Nov 2026, 9:04 am`), not ISO strings.
 */

export interface FormatINROptions {
  /** Fraction digits; defaults to 2 for rupees. */
  decimals?: number;
  /** Prefix a plus sign on positive values. */
  signed?: boolean;
}

export interface FormatPercentOptions {
  /** Prefix a plus sign on positive values. Defaults to false. */
  signed?: boolean;
  /** Fraction digits; defaults to 1. */
  decimals?: number;
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const roundTo = (value: number, decimals: number): number => {
  const sign = value < 0 ? -1 : 1;
  // Exponent shifting avoids the classic 1.005 * 100 -> 100.49999999999999
  // error that makes displayed rupee amounts differ from the printed decimal.
  const shifted = Number(`${Math.abs(value)}e${decimals}`);
  if (!Number.isFinite(shifted)) return value;
  return sign * Number(`${Math.round(shifted)}e-${decimals}`);
};

/** Rounded value with the sign that should actually be printed. */
const withoutNegativeZero = (value: number, decimals: number): number =>
  Math.abs(value) < 0.5 * 10 ** -decimals ? 0 : value;

/**
 * Rupees with Indian digit grouping and two decimals by default.
 * `formatINR(-1149.413)` -> `-₹1,149.41`; `formatINR(-0)` -> `₹0.00`.
 */
export function formatINR(value: number | null | undefined, options: FormatINROptions = {}): string {
  if (!isFiniteNumber(value)) return 'N/A';
  const decimals = Math.max(0, Math.min(6, Math.trunc(options.decimals ?? 2)));
  const rounded = withoutNegativeZero(roundTo(value, decimals), decimals);
  const amount = Math.abs(rounded).toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  const sign = rounded < 0 ? '-' : options.signed && rounded > 0 ? '+' : '';
  return `${sign}₹${amount}`;
}

/**
 * Percentage without the `%` being added twice by callers.
 * Never prints `-0.0%`: values that round to zero print as `0.0%`.
 */
export function formatPercent(value: number | null | undefined, options: FormatPercentOptions = {}): string {
  if (!isFiniteNumber(value)) return 'N/A';
  const decimals = Math.max(0, Math.min(6, Math.trunc(options.decimals ?? 1)));
  const rounded = withoutNegativeZero(roundTo(value, decimals), decimals);
  const sign = rounded < 0 ? '-' : options.signed && rounded > 0 ? '+' : '';
  return `${sign}${Math.abs(rounded).toFixed(decimals)}%`;
}

/**
 * Plain number with fixed decimals (ratios, bar counts, multiples).
 * No grouping, no unit: callers own the label.
 */
export function formatNumber(value: number | null | undefined, decimals = 2): string {
  if (!isFiniteNumber(value)) return 'N/A';
  const digits = Math.max(0, Math.min(6, Math.trunc(decimals)));
  const rounded = withoutNegativeZero(roundTo(value, digits), digits);
  return (rounded === 0 ? 0 : rounded).toFixed(digits);
}

const parseDateInput = (value: string | number | Date): Date | null => {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const text = value.trim();
  if (!text) return null;
  // A date-only value is calendar data, not an instant. Parse it in local time
  // at noon so a UTC offset can never move it to the previous day.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (dateOnly) {
    const date = new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]), 12);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
};

const dateFormatter = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

const dateTimeFormatter = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

/** `16 Nov 2026`. Invalid input returns `N/A`. */
export function formatDate(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined) return 'N/A';
  const date = parseDateInput(value);
  if (!date) return 'N/A';
  return dateFormatter.format(date).replace(/\u202f/g, ' ');
}

/** `16 Nov 2026, 9:04 am`. Invalid input returns `N/A`. */
export function formatDateTime(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined) return 'N/A';
  const date = parseDateInput(value);
  if (!date) return 'N/A';
  return dateTimeFormatter
    .format(date)
    .replace(/\u202f/g, ' ')
    .replace(/\s?(AM|PM)\b/g, match => match.toLowerCase());
}

/**
 * Short card title: trim, collapse whitespace, cut at a word boundary and add
 * an ellipsis. Never returns more than `max` characters, including the ellipsis.
 */
export function truncateAtWord(value: string, max: number): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  const limit = Math.max(2, Math.floor(max));
  if (text.length <= limit) return text;
  const slice = text.slice(0, limit - 1);
  const boundary = slice.lastIndexOf(' ');
  const base = (boundary >= Math.min(20, limit - 2) ? slice.slice(0, boundary) : slice).trimEnd();
  return base.replace(/[\s.,;:·\-–—]+$/u, '') + '…';
}
