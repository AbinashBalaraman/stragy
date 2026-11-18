/**
 * Plain-language labels for engine tool calls.
 *
 * The activity timeline never shows a raw tool id or JSON: every known tool has a
 * short human noun phrase, and unknown ids get a keyword-based fallback (still a
 * sentence, never `snake_case`). Keep this exhaustive for the ~20 engine tools
 * (discovery, data, chart, scan, strategy, backtest, memory, plan) so Agent B can
 * add a tool without the UI silently degrading to an id.
 */

export type AgentToolCategory =
  | 'discovery'
  | 'data'
  | 'chart'
  | 'scan'
  | 'strategy'
  | 'backtest'
  | 'memory'
  | 'plan'
  | 'other';

const LABELS: Record<string, { label: string; category: AgentToolCategory }> = {
  // Discovery / symbols
  check_symbol: { label: 'Symbol check', category: 'discovery' },
  get_symbol: { label: 'Symbol lookup', category: 'discovery' },
  resolve_symbol: { label: 'Symbol lookup', category: 'discovery' },
  search_symbols: { label: 'Symbol search', category: 'discovery' },
  find_symbol: { label: 'Symbol search', category: 'discovery' },
  list_symbols: { label: 'Symbol list', category: 'discovery' },
  get_universes: { label: 'Universe lookup', category: 'discovery' },
  list_universes: { label: 'Universe lookup', category: 'discovery' },
  // Market data
  get_quote: { label: 'Live quote', category: 'data' },
  get_live_quote: { label: 'Live quote', category: 'data' },
  get_bars: { label: 'Price history', category: 'data' },
  get_candles: { label: 'Price history', category: 'data' },
  get_market_data: { label: 'Market data', category: 'data' },
  load_market_series: { label: 'Price history', category: 'data' },
  get_market_snapshot: { label: 'Market snapshot', category: 'data' },
  market_snapshot: { label: 'Market snapshot', category: 'data' },
  get_market_context: { label: 'Market context', category: 'data' },
  get_market_dates: { label: 'Trading calendar', category: 'data' },
  get_data_cache: { label: 'Data cache', category: 'data' },
  refresh_market_data: { label: 'Market data refresh', category: 'data' },
  get_refresh_result: { label: 'Refresh progress', category: 'data' },
  // Charts
  read_chart: { label: 'Chart reading', category: 'chart' },
  analyze_chart: { label: 'Chart reading', category: 'chart' },
  get_chart_result: { label: 'Chart result', category: 'chart' },
  parse_chart_image: { label: 'Chart reading', category: 'chart' },
  // Scanning / screening
  scan_market: { label: 'Market scan', category: 'scan' },
  run_scan: { label: 'Market scan', category: 'scan' },
  screen_market: { label: 'Market scan', category: 'scan' },
  scan_universe: { label: 'Market scan', category: 'scan' },
  get_scan_result: { label: 'Scan results', category: 'scan' },
  get_scan_status: { label: 'Scan progress', category: 'scan' },
  list_scans: { label: 'Saved scans', category: 'scan' },
  // Strategy
  propose_strategy_edit: { label: 'Strategy draft', category: 'strategy' },
  apply_strategy_edit: { label: 'Strategy edit', category: 'strategy' },
  draft_strategy: { label: 'Strategy draft', category: 'strategy' },
  validate_strategy: { label: 'Strategy check', category: 'strategy' },
  get_strategy: { label: 'Strategy summary', category: 'strategy' },
  describe_strategy: { label: 'Strategy summary', category: 'strategy' },
  list_strategies: { label: 'Saved strategies', category: 'strategy' },
  // Backtest
  run_backtest: { label: 'Backtest', category: 'backtest' },
  get_backtest_result: { label: 'Backtest result', category: 'backtest' },
  get_backtest_status: { label: 'Backtest progress', category: 'backtest' },
  list_backtests: { label: 'Saved backtests', category: 'backtest' },
  // Memory
  recall_memory: { label: 'Memory recall', category: 'memory' },
  search_memory: { label: 'Memory search', category: 'memory' },
  read_memory: { label: 'Memory recall', category: 'memory' },
  remember: { label: 'Memory saved', category: 'memory' },
  save_memory: { label: 'Memory saved', category: 'memory' },
  write_memory: { label: 'Memory saved', category: 'memory' },
  list_memories: { label: 'Saved notes', category: 'memory' },
  // Planning
  todowrite: { label: 'Plan update', category: 'plan' },
  todo_write: { label: 'Plan update', category: 'plan' },
  update_todos: { label: 'Plan update', category: 'plan' },
  plan_tasks: { label: 'Plan update', category: 'plan' },
  get_plan: { label: 'Plan', category: 'plan' },
  // Conversation / generic engine tools (denied ones still degrade gracefully)
  read_session: { label: 'Conversation lookup', category: 'other' },
  list_sessions: { label: 'Conversation lookup', category: 'other' },
  web_search: { label: 'Web lookup', category: 'other' },
  websearch: { label: 'Web lookup', category: 'other' },
  webfetch: { label: 'Web lookup', category: 'other' },
};

const CATEGORY_FALLBACKS: Array<{ test: RegExp; label: string; category: AgentToolCategory }> = [
  { test: /backtest/, label: 'Backtest', category: 'backtest' },
  { test: /scan|screen/, label: 'Market scan', category: 'scan' },
  { test: /chart|image/, label: 'Chart reading', category: 'chart' },
  { test: /memor|recall|remember/, label: 'Memory', category: 'memory' },
  { test: /todo|plan/, label: 'Plan update', category: 'plan' },
  { test: /strateg|proposal|draft/, label: 'Strategy', category: 'strategy' },
  { test: /symbol|universe|ticker/, label: 'Symbol lookup', category: 'discovery' },
  { test: /quote|bar|candle|price|series|market/, label: 'Market data', category: 'data' },
  { test: /search|fetch|web/, label: 'Web lookup', category: 'other' },
];

const normalize = (name: string): string => name.trim().toLowerCase().replace(/[\s.-]+/g, '_');

/** A short human noun phrase for a tool id. Never returns the raw id for known shapes. */
export function toolLabel(name: string): string {
  const key = normalize(name);
  const known = LABELS[key];
  if (known) return known.label;
  const fallback = CATEGORY_FALLBACKS.find(entry => entry.test.test(key));
  if (fallback) return fallback.label;
  const words = key.replace(/_/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Agent step';
}

/** Category used only for tone/ordering decisions; the timeline shows `toolLabel`. */
export function toolCategory(name: string): AgentToolCategory {
  const key = normalize(name);
  return LABELS[key]?.category ?? CATEGORY_FALLBACKS.find(entry => entry.test.test(key))?.category ?? 'other';
}

/** True when a string is a JSON document a model leaked instead of a sentence. */
export function looksLikeJson(text: string): boolean {
  const value = text.trim();
  if (!value || (value[0] !== '{' && value[0] !== '[')) return false;
  try { JSON.parse(value); return true; } catch { return false; }
}

/** One clean line, never JSON, capped so a runaway summary cannot break the layout. */
export function humanSummary(text: string | undefined, maxLength = 180): string | undefined {
  if (!text) return undefined;
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (!collapsed || looksLikeJson(collapsed)) return undefined;
  if (collapsed.length <= maxLength) return collapsed;
  return collapsed.slice(0, maxLength - 1).trimEnd() + '…';
}
