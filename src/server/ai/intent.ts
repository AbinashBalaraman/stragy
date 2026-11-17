/**
 * Shared intent guard: informational questions must not be mistaken for build/edit
 * requests merely because they mention an indicator ("what does RSI measure?").
 */
const QUESTION_WORD = /\b(?:what|how|why|explain|define|meaning|describe)\b/i;
const QUESTION_LEAD = /^(?:(?:and|but|so|also|then)[,;:]?\s*)?(?:in\s+one\s+sentence[,;:]?\s*)?(?:what|how|why|explain|define|meaning|describe|tell\s+me)\b/i;
/** Explicit strategy actions that override the question guard. */
const ACTION_VERB = /\b(?:build|create|backtest|set|change|make|add|remove|edit|update|apply)\b/i;
const NOOP_ACTION = /\b(?:set|change|make|add|remove|edit|update|apply)\s+nothing\b/i;
/** Broader action vocabulary used to keep market grounding from hijacking strategy work. */
const STRATEGY_ACTION_VERB = /\b(?:build|create|backtest|simulate|set|change|make|generate|add|remove|edit|update|switch|run|execute|apply|optimi[sz]e|tune|tighten|loosen|increase|decrease)\b/i;

export function isInformationalQuestion(message: string): boolean {
  const text = String(message ?? '').trim();
  if (!text) return false;
  // "What is RSI? Set nothing." is still a question, not an edit.
  if (ACTION_VERB.test(text) && !(NOOP_ACTION.test(text) && text.includes('?'))) return false;
  if (!QUESTION_WORD.test(text) && !QUESTION_LEAD.test(text) && !text.includes('?')) return false;
  return text.includes('?') || QUESTION_LEAD.test(text);
}

/** True when the text explicitly asks the app to build, edit, run or optimize something. */
export function hasExplicitActionVerb(message: string): boolean {
  return ACTION_VERB.test(String(message ?? ''));
}

/** Broader check for routing: optimization, edits and runs are strategy work, not quotes. */
export function hasStrategyActionVerb(message: string): boolean {
  return STRATEGY_ACTION_VERB.test(String(message ?? ''));
}
