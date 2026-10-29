import type { SymbolMeta } from '../../shared/strategy/types';

/** Client-side understanding of the narrow, safe follow-up intents Stragy supports. */
export type BacktestIntent =
  | { kind: 'backtest'; stockQuery: string | null }
  | { kind: 'negated'; stockQuery: null }
  | { kind: 'none'; stockQuery: null };

const BACKTEST_WORDS = /\b(?:back[\s-]?test|re[\s-]?run|run\s+(?:a\s+)?(?:test|simulation)|test\s+(?:this|it|that|the\s+(?:screen|strategy|idea))|simulate)\b/i;
const NEGATED_BACKTEST = /\b(?:do\s+not|don't|never|not)\b[^.!?]{0,60}\b(?:back[\s-]?test|run|test|execute)\b/i;

function cleanStockQuery(value: string): string {
  return value
    .replace(/\b(?:please|now|thanks|thank\s+you)\b/gi, ' ')
    .replace(/\b(?:with|using)\s+(?:these|the|current|my)\s+(?:assumptions?|settings?|workspace|costs?)\b/gi, ' ')
    .replace(/\b(?:and|then)\s+(?:show|open|view|tell|explain)\b.*$/gi, ' ')
    .replace(/[.?!,;:]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * "backtest this on RELIANCE" is understood here, not by the free-form model.
 * Anything broader is deliberately left to a specific clarification.
 */
export function parseBacktestIntent(text: string): BacktestIntent {
  const input = text.trim();
  if (!input || !BACKTEST_WORDS.test(input)) return { kind: 'none', stockQuery: null };
  if (NEGATED_BACKTEST.test(input)) return { kind: 'negated', stockQuery: null };
  const prepositional = /\b(?:on|for)\s+([A-Za-z0-9&.'\- ]{1,80})$/i.exec(input);
  const direct = /\b(?:back[\s-]?test|test|simulate|run)\s+([A-Za-z][A-Za-z0-9&.'\- ]{1,80})$/i.exec(input);
  const raw = prepositional?.[1] ?? direct?.[1] ?? null;
  const cleaned = raw ? cleanStockQuery(raw) : '';
  const pronoun = /^(?:this|it|that|them|the\s+(?:screen|strategy|idea|setup))$/i.test(cleaned);
  return { kind: 'backtest', stockQuery: cleaned && !pronoun ? cleaned : null };
}

export type StockResolution =
  | { status: 'resolved'; symbol: SymbolMeta }
  | { status: 'ambiguous'; candidates: SymbolMeta[] }
  | { status: 'missing' };

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function normalizeTicker(value: string): string {
  return value.trim().toUpperCase().replace(/\.(?:NS|NSE|BSE)$/, '').replace(/\s+/g, '');
}

function wholeToken(haystack: string, needle: string): boolean {
  if (!needle) return false;
  return new RegExp('(^|[^A-Z0-9&])' + escape(needle.toUpperCase()) + '([^A-Z0-9&]|$)', 'i').test(haystack);
}

/**
 * Resolve a stock only when the result is unambiguous. Ambiguity is surfaced so
 * a follow-up can ask a specific question instead of guessing an instrument.
 */
export function resolveStock(query: string | null, fullText: string, symbols: SymbolMeta[]): StockResolution {
  if (!symbols.length) return { status: 'missing' };
  const wanted = query ? normalizeTicker(query) : '';
  const text = fullText.toUpperCase();

  if (wanted) {
    const exactTicker = symbols.filter(symbol => normalizeTicker(symbol.ticker) === wanted);
    if (exactTicker.length === 1) return { status: 'resolved', symbol: exactTicker[0] };
    const exactName = symbols.filter(symbol => symbol.name.trim().toUpperCase() === (query ?? '').trim().toUpperCase());
    if (exactName.length === 1) return { status: 'resolved', symbol: exactName[0] };
  }

  const tickerInText = symbols.filter(symbol => wholeToken(text, symbol.ticker));
  if (tickerInText.length === 1) return { status: 'resolved', symbol: tickerInText[0] };
  if (tickerInText.length > 1) return { status: 'ambiguous', candidates: tickerInText.slice(0, 6) };

  if (wanted.length >= 3) {
    const partial = symbols.filter(symbol =>
      normalizeTicker(symbol.ticker).startsWith(wanted) ||
      symbol.name.toUpperCase().includes((query ?? '').toUpperCase())
    );
    if (partial.length === 1) return { status: 'resolved', symbol: partial[0] };
    if (partial.length > 1) return { status: 'ambiguous', candidates: partial.slice(0, 6) };
  }
  return { status: 'missing' };
}

/**
 * Only these explicit replies count as consent. Any negation wins, even when an
 * approval phrase is also present, so "no, don't run it" can never execute.
 */
export type ReviewReply = 'approve' | 'reject' | 'assumptions' | 'none';

const NEGATION = /\b(?:no|nope|nah|not|never|don't|do\s+not|doesn't|cannot|can't|won't|wouldn't|shouldn't|without|except|cancel|stop|abort|hold|wait)\b/i;
const APPROVAL = /^(?:(?:yes|ok|okay|sure|please)[,\s]+)?(?:use\s+(?:these|the)\s+assumptions\s+and\s+run|run\s+(?:it|this|that|the\s+backtest)|go\s+ahead(?:\s+and\s+run)?|approve(?:\s+(?:this|it))?(?:\s+and\s+run)?|confirm(?:\s+(?:this|it))?(?:\s+and\s+run)?|proceed(?:\s+and\s+run)?|start\s+(?:it|the\s+backtest)|execute\s+(?:it|this|the\s+backtest))[\s.!]*$/i;
const ASSUMPTIONS_ONLY = /^(?:(?:yes|ok|okay|sure|please)[,\s]+)?use\s+(?:these|the)\s+assumptions[\s.!]*$/i;
const STANDALONE_REJECT = /^(?:no|nope|nah|cancel|stop|abort|wait|hold|never\s*mind|forget\s*it)[\s.!]*$/i;
/** A reply about execution, not a new strategy or screen request such as "change stop loss to 5%". */
const APPROVAL_LIKE = /\b(?:use\s+(?:these|the)\s+assumptions|run\s+(?:it|this|that|the\s+backtest)|go\s+ahead|approv(?:e|al)|confirm|proceed|start\s+(?:it|the\s+backtest)|execute)\b/i;

export function classifyReviewReply(text: string): ReviewReply {
  const input = text.trim();
  if (!input) return 'none';
  if (APPROVAL.test(input)) return 'approve';
  if (STANDALONE_REJECT.test(input)) return 'reject';
  if (APPROVAL_LIKE.test(input) && NEGATION.test(input)) return 'reject';
  if (ASSUMPTIONS_ONLY.test(input)) return 'assumptions';
  return 'none';
}

/** Keep raw error rows out of the headline while retaining them for inspection. */
export function summarizeProviderFailures(errors: { code?: string; message?: string; ticker?: string; symbolId?: number }[]): string {
  const count = errors.length;
  if (!count) return '';
  const labels = [...new Set(errors.map(error => error.ticker || (error.symbolId ? 'symbol ' + error.symbolId : 'provider')))].slice(0, 3);
  return count + (count === 1 ? ' instrument could not be evaluated' : ' instruments could not be evaluated') +
    (labels.length ? ' (' + labels.join(', ') + (count > labels.length ? ', …' : '') + ')' : '') + '.';
}
