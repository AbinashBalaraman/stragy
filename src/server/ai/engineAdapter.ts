/**
 * Adapter from OpenCode engine messages to the payload shapes Stragy's chat
 * cards already render. The cards are not modified: a scan tool result becomes
 * a ScanResult, a chart reading becomes a ResearchScreenPlan, a proposal becomes
 * a StrategyProposal, and a backtest becomes a BacktestResponse.
 *
 * Raw engine fields (ids, timings, model, finish reason, tool state) are kept in
 * `raw` so the client can debug without a second endpoint.
 */
import type { ResearchChatResponse, ResearchScreenPlan } from '../../shared/contracts/research-chat';
import type { StrategyAST } from '../../shared/strategy/types';

export type AgentToolStatus = 'called' | 'running' | 'success' | 'failed';
export interface AgentToolActivity {
  type: 'tool';
  name: string;
  status: AgentToolStatus;
  summary?: string;
  durationMs?: number;
  error?: { code: string; message: string };
}
export interface AgentTodoItem { content: string; status: 'pending' | 'in_progress' | 'completed' | 'cancelled' }

export interface AdaptedEngineMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  text?: string;
  timestamp?: number;
  payload?: unknown;
  result?: unknown;
  tool?: string;
  job?: { id: string; kind?: string; status?: string };
  approval?: { id: string; tool?: string; status?: 'pending' | 'approved' | 'rejected'; title?: string; summary?: string[] };
  /** Normalized activity rows for AgentActivity (same shape as the SSE tool events). */
  activities?: AgentToolActivity[];
  /** The latest plan for AgentTodoList, when the turn used todowrite. */
  todos?: AgentTodoItem[];
  activity?: AgentToolActivity;
  seq?: number;
  raw?: Record<string, unknown>;
}

export interface SeqIndex {
  byMessageId: Map<string, number>;
  lastSeq: number;
}

interface RawMessage {
  id?: unknown;
  type?: unknown;
  time?: { created?: unknown; completed?: unknown; streamed?: unknown };
  text?: unknown;
  content?: unknown;
  model?: { providerID?: unknown; id?: unknown };
  finish?: unknown;
  tokens?: unknown;
  cost?: unknown;
  outcome?: unknown;
  error?: { type?: unknown; message?: unknown };
}

interface RawToolPart {
  type?: unknown;
  id?: unknown;
  name?: unknown;
  state?: {
    status?: unknown;
    input?: unknown;
    content?: unknown;
    error?: unknown;
    metadata?: unknown;
  };
  time?: { created?: unknown; completed?: unknown };
}


/** Human tool name for a summary; never a snake_case id in the UI. */
const TOOL_NAMES: Record<string, string> = {
  read_chart: 'chart reading', get_chart_result: 'chart result', scan_market: 'market scan', get_scan_result: 'scan result',
  list_universes: 'universe list', list_indicators: 'indicator list', search_symbols: 'symbol search', get_symbol_info: 'symbol details',
  get_quote: 'quote', get_price_history: 'price history', compute_indicators: 'indicator calculation', market_overview: 'market overview',
  get_market_result: 'market result', check_symbol: 'symbol check', explain_match: 'match explanation',
  get_current_strategy: 'workspace strategy', validate_strategy: 'strategy validation', list_strategy_templates: 'strategy templates',
  list_saved_strategies: 'saved strategies', load_saved_strategy: 'saved strategy', propose_strategy_edit: 'strategy draft',
  run_backtest: 'backtest', get_backtest_result: 'backtest result', remember_preference: 'memory note', get_preferences: 'memory',
  todowrite: 'plan update',
};

export function humanToolName(name: string): string {
  return TOOL_NAMES[name] ?? name.replace(/[_-]+/g, ' ').replace(/\b\w/g, character => character.toUpperCase());
}

function short(value: unknown, limit = 180): string {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return text.length > limit ? text.slice(0, limit - 1) + '…' : text;
}

/** One honest human line for a tool activity row (never JSON). */
export function toolActivitySummary(name: string, output?: Record<string, unknown>, status?: AgentToolStatus): string {
  if (status === 'called') return 'Preparing ' + humanToolName(name);
  if (status === 'running') return humanToolName(name).replace(/^./, character => character.toUpperCase()) + ' running';
  if (!output) return humanToolName(name).replace(/^./, character => character.toUpperCase());
  const result = output.result && typeof output.result === 'object' ? output.result as Record<string, unknown> : undefined;
  switch (name) {
    case 'scan_market': return 'Queued a ' + String(output.universe ?? 'market') + ' scan';
    case 'get_scan_result': {
      if (output.status === 'running') return 'Scan still running' + (output.progress ? ' · ' + JSON.stringify(output.progress) : '');
      if (output.status === 'failed') return 'Scan failed';
      const coverage = output.coverage as { requested?: number; succeeded?: number; unavailable?: number } | undefined;
      return String(output.matched ?? 0) + ' matched · ' + String(coverage?.succeeded ?? output.succeeded ?? '?') + '/' + String(coverage?.requested ?? output.requested ?? '?') + ' checked';
    }
    case 'market_overview': return 'Queued a ' + String(output.universe ?? 'market') + ' overview';
    case 'get_market_result': return output.status === 'running' ? 'Market snapshot still building' : 'Market breadth: ' + String((output.breadth as { advances?: number } | undefined)?.advances ?? '?') + ' up / ' + String((output.breadth as { declines?: number } | undefined)?.declines ?? '?') + ' down';
    case 'check_symbol': {
      const conditions = Array.isArray(output.conditions) ? output.conditions as { matched?: boolean }[] : [];
      return String(output.symbol ? (output.symbol as { ticker?: string }).ticker ?? 'Symbol' : 'Symbol') + ': ' + conditions.filter(item => item.matched).length + '/' + conditions.length + ' conditions pass';
    }
    case 'explain_match': return String(output.symbol ?? 'Symbol') + (output.status === 'matched' ? ' matched the scan' : output.status === 'near_match' ? ' was a near-miss' : ' was not retained by the scan');
    case 'get_quote': {
      const quotes = Array.isArray(output.quotes) ? output.quotes : [];
      return 'Read ' + quotes.length + ' delayed quote' + (quotes.length === 1 ? '' : 's') + (Array.isArray(output.errors) && output.errors.length ? ' · ' + output.errors.length + ' unavailable' : '');
    }
    case 'get_price_history': {
      const summary = output.summary as { sessions?: number; lastDate?: string } | undefined;
      return String((output.symbol as { ticker?: string } | undefined)?.ticker ?? 'Symbol') + ': ' + String(summary?.sessions ?? '?') + ' sessions to ' + String(summary?.lastDate ?? '?');
    }
    case 'compute_indicators': return String((output.symbol as { ticker?: string } | undefined)?.ticker ?? 'Symbol') + ': ' + (Array.isArray(output.indicators) ? output.indicators.length : 0) + ' series';
    case 'search_symbols': return String(output.returned ?? 0) + ' of ' + String(output.totalMatched ?? 0) + ' symbols';
    case 'get_symbol_info': return String((output.symbol as { ticker?: string } | undefined)?.ticker ?? 'Symbol') + ' details';
    case 'list_universes': return 'Listed ' + (Array.isArray(output.universes) ? output.universes.length : 0) + ' universes';
    case 'list_indicators': return 'Listed ' + (Array.isArray(output.indicators) ? output.indicators.length : 0) + ' indicators';
    case 'list_strategy_templates': return 'Listed ' + (Array.isArray(output.templates) ? output.templates.length : 0) + ' templates';
    case 'list_saved_strategies': return 'Listed ' + (Array.isArray(output.strategies) ? output.strategies.length : 0) + ' saved strategies';
    case 'load_saved_strategy': return 'Loaded ' + String((output.strategy as { name?: string } | undefined)?.name ?? 'a saved strategy');
    case 'get_current_strategy': return output.status === 'ok' ? 'Read the workspace strategy' : 'No workspace strategy yet';
    case 'validate_strategy': return output.status === 'valid' ? 'Strategy is valid' : 'Strategy has errors';
    case 'propose_strategy_edit': return 'Draft proposal: ' + String((output.proposal as { candidate?: { name?: string } } | undefined)?.candidate?.name ?? 'strategy');
    case 'read_chart': return 'Queued a chart reading';
    case 'get_chart_result': return output.status === 'running' ? 'Chart reading still running' : 'Chart reading finished';
    case 'run_backtest': return output.status === 'approval_required' ? 'Waiting for operator approval' : 'Backtest queued';
    case 'get_backtest_result': {
      if (output.status === 'running') return 'Backtest still running';
      const metrics = output.metrics as { totalReturnPercent?: number; totalTrades?: number } | undefined;
      return String(output.symbol ?? 'Backtest') + ': ' + (typeof metrics?.totalReturnPercent === 'number' ? metrics.totalReturnPercent.toFixed(2) + '%' : '?') + ' return · ' + String(metrics?.totalTrades ?? '?') + ' trades';
    }
    case 'remember_preference': return 'Saved preference: ' + String(output.key ?? 'memory');
    case 'get_preferences': return 'Read ' + (Array.isArray(output.preferences) ? output.preferences.length : 0) + ' preference' + (Array.isArray(output.preferences) && output.preferences.length === 1 ? '' : 's');
    case 'todowrite': {
      const todos = Array.isArray(output.todos) ? output.todos as { status?: string }[] : [];
      return String(todos.filter(todo => todo.status === 'completed').length) + '/' + todos.length + ' plan steps done';
    }
    default:
      return short(result?.message) || humanToolName(name).replace(/^./, character => character.toUpperCase());
  }
}

export function todosFromOutput(output: Record<string, unknown> | undefined): AgentTodoItem[] | undefined {
  if (!output || !Array.isArray(output.todos)) return undefined;
  const statuses = new Set(['pending', 'in_progress', 'completed', 'cancelled']);
  const todos: AgentTodoItem[] = [];
  for (const item of output.todos) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    if (typeof record.content !== 'string') continue;
    todos.push({ content: record.content.slice(0, 500), status: (statuses.has(String(record.status)) ? String(record.status) : 'pending') as AgentTodoItem['status'] });
  }
  return todos.length ? todos.slice(0, 30) : undefined;
}

const CLEAN = ['NIFTY_50', 'BANK_NIFTY', 'NIFTY_IT', 'NIFTY_AUTO', 'NIFTY_PHARMA', 'NIFTY_METAL', 'NIFTY_FMCG', 'NSE'] as const;
type CleanUniverse = typeof CLEAN[number];

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .flatMap(part => part && typeof part === 'object' && (part as { type?: unknown }).type === 'text' && typeof (part as { text?: unknown }).text === 'string'
      ? [(part as { text: string }).text]
      : [])
    .join('\n\n')
    .trim();
}

function clampId(value: string): string {
  return value.length <= 200 ? value : value.slice(0, 200);
}

function parseToolContent(content: unknown): { value: unknown; text: string } {
  const text = textOf(content);
  if (!text) return { value: undefined, text: '' };
  try { return { value: JSON.parse(text) as unknown, text }; }
  catch { return { value: undefined, text }; }
}

/** Parsed tool output object from a durable tool event content array. */
export function toolOutputFromContent(content: unknown): Record<string, unknown> | undefined {
  const parsed = parseToolContent(content).value;
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
}

/** Human line for a failed tool event. */
export function toolErrorText(error: unknown): string {
  if (typeof error === 'string') return error.slice(0, 500);
  if (error && typeof error === 'object') {
    const record = error as { message?: unknown; type?: unknown };
    if (typeof record.message === 'string') return record.message.slice(0, 500);
    if (typeof record.type === 'string') return record.type.replace(/[_-]+/g, ' ') + '.';
  }
  return 'The tool could not finish.';
}

function toolMessageId(parentId: string, toolId: string, index: number): string {
  const base = 'tool_' + parentId + '_' + (toolId || String(index));
  return clampId(base);
}

/** Models sometimes pass the strategy as a JSON string in tool input. */
function strategyValue(value: unknown): StrategyAST | null {
  let candidate = value;
  if (typeof candidate === 'string') {
    try { candidate = JSON.parse(candidate); } catch { return null; }
  }
  if (!candidate || typeof candidate !== 'object') return null;
  const record = candidate as Record<string, unknown>;
  if (!record.rules || typeof record.rules !== 'object' || !Array.isArray(record.indicators)) return null;
  return candidate as StrategyAST;
}

function planForScan(strategy: StrategyAST, universe: string, asOf: string | undefined, warnings: string[]): ResearchScreenPlan | null {
  if (!(CLEAN as readonly string[]).includes(universe)) return null;
  if (!strategy || !strategy.rules || !Array.isArray(strategy.rules.entry) || !Array.isArray(strategy.indicators)) return null;
  const entryCount = strategy.rules.entry.length;
  const assumptions = [
    'Universe: ' + universe + '.',
    'Strategy: ' + strategy.name + ' (v' + strategy.version + ') with ' + entryCount + ' entry rule' + (entryCount === 1 ? '' : 's') + ' and ' + strategy.indicators.length + ' indicator configuration' + (strategy.indicators.length === 1 ? '' : 's') + '.',
    'As of: ' + (asOf ?? 'the latest completed daily session available to the provider') + '.',
    'The scan is a read-only screen. Exits, position sizing, execution and costs belong to the workspace strategy and are applied only if a backtest is prepared and approved.',
    'Coverage may be partial; unavailable symbols are reported as unavailable, never as no-match.',
  ];
  return {
    schemaVersion: 1,
    originatingRevision: null,
    message: 'Screen ' + universe + ' for ' + strategy.name + '.',
    method: 'external_ai',
    provider: { name: 'OpenCode engine', model: null, aiGenerated: true },
    warnings: [...warnings].slice(0, 10),
    kind: 'screen',
    universe: universe as CleanUniverse,
    strategy: strategy as unknown as ResearchScreenPlan['strategy'],
    assumptions,
    missingBacktestRules: ['exits', 'positionSizing', 'executionAndCosts'],
    backtestReady: false,
    ...(asOf ? { asOf } : {}),
  };
}

function proposalPayload(proposal: unknown): ResearchChatResponse | null {
  if (!proposal || typeof proposal !== 'object') return null;
  const record = proposal as Record<string, unknown>;
  const rationale = typeof record.rationale === 'string' ? record.rationale : 'Draft strategy change.';
  return {
    schemaVersion: 1,
    originatingRevision: null,
    message: rationale.slice(0, 12_000),
    method: 'external_ai',
    provider: { name: 'OpenCode engine', model: null, aiGenerated: true },
    warnings: Array.isArray(record.warnings) ? record.warnings.filter((item): item is string => typeof item === 'string') : [],
    kind: 'proposal',
    proposal: record as never,
  };
}

/** Number of milliseconds the message was created, or undefined. */
function created(message: RawMessage): number | undefined {
  const value = message.time?.created;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export interface AdapterOptions {
  /** Stored seq per engine message id (durable events), multiplied by 1000 by the caller. */
  seqFor?: (messageId: string) => number | undefined;
  /** Fetch the full job result for a tool output that only carries a jobId. */
  resolveJobResult?: (jobId: string) => unknown;
}

/**
 * Map raw engine messages to chat messages. Async because a tool result card
 * may need the full job output, which the tool itself keeps out of the model
 * context to save tokens.
 */
export async function adaptMessages(rawMessages: unknown[], options: AdapterOptions = {}): Promise<AdaptedEngineMessage[]> {
  const output: AdaptedEngineMessage[] = [];
  let turnToolOutputs: { name: string; input: unknown; output: Record<string, unknown>; result: unknown; raw: RawToolPart }[] = [];
  let turnStart = 0;

  const finishTurn = () => {
    if (!turnToolOutputs.length) return;
    try {
    let payload: unknown;
    for (const item of turnToolOutputs) {
      if (item.name === 'get_chart_result' || item.name === 'read_chart') {
        const result = item.result as { kind?: unknown } | undefined;
        if (result && typeof result === 'object' && result.kind === 'screen') { payload = result; break; }
      }
    }
    if (!payload) {
      for (const item of turnToolOutputs) {
        if (item.name === 'propose_strategy_edit' && item.output.kind === 'proposal') {
          payload = proposalPayload(item.output.proposal);
          if (payload) break;
        }
      }
    }
    if (!payload) {
      for (const item of turnToolOutputs) {
        if ((item.name === 'scan_market' || item.name === 'get_scan_result') && item.output.status === 'succeeded') {
          const input = (item.input ?? {}) as Record<string, unknown>;
          const strategy = strategyValue(input.strategy ?? item.output.strategy);
          const plan = strategy ? planForScan(
            strategy,
            String(input.universe ?? item.output.universe ?? ''),
            typeof input.asOf === 'string' ? input.asOf : undefined,
            Array.isArray(item.output.warnings) ? item.output.warnings.filter((line): line is string => typeof line === 'string') : [],
          ) : null;
          if (plan) { payload = plan; break; }
        }
      }
    }
    if (!payload) return;
    // Attach to the last assistant turn that carries text; otherwise the last
    // assistant message in the turn (the tool-call step).
    for (let index = output.length - 1; index >= turnStart; index--) {
      const candidate = output[index];
      if (candidate.role === 'assistant' && (candidate.text ?? '').trim()) { candidate.payload = payload; return; }
    }
    for (let index = output.length - 1; index >= turnStart; index--) {
      const candidate = output[index];
      if (candidate.role === 'assistant') { candidate.payload = payload; return; }
    }
    } catch { /* a malformed tool payload must never break the message list */ }
  };

  for (const raw of rawMessages) {
    const message = (raw ?? {}) as RawMessage;
    if (typeof message.id !== 'string') continue;
    if (message.type === 'user') {
      finishTurn();
      turnToolOutputs = [];
      turnStart = output.length;
      const text = typeof message.text === 'string' ? message.text : '';
      output.push({
        id: clampId(message.id),
        role: 'user',
        ...(text ? { text } : {}),
        ...(created(message) ? { timestamp: created(message) } : {}),
        seq: (options.seqFor?.(message.id) ?? 0),
        raw: { id: message.id, type: 'user', time: message.time },
      });
      continue;
    }
    if (message.type !== 'assistant') continue;
    const content = Array.isArray(message.content) ? message.content as RawToolPart[] : [];
    const text = textOf(content);
    const toolParts = content.filter(part => part && part.type === 'tool');
    const timestamp = created(message);
    const seq = options.seqFor?.(message.id) ?? 0;
    const assistantMessage: AdaptedEngineMessage = {
      id: clampId(message.id),
      role: 'assistant',
      ...(text ? { text } : {}),
      ...(timestamp ? { timestamp } : {}),
      seq,
      raw: {
        id: message.id,
        type: 'assistant',
        time: message.time,
        model: message.model,
        finish: message.finish,
        ...(message.tokens ? { tokens: message.tokens } : {}),
        ...(message.cost !== undefined ? { cost: message.cost } : {}),
        ...(message.error ? { error: message.error } : {}),
      },
    };
    output.push(assistantMessage);
    const activities: AgentToolActivity[] = [];
    let latestTodos: AgentTodoItem[] | undefined;
    for (const [index, part] of toolParts.entries()) {
      const state = part.state ?? {};
      const parsed = parseToolContent(state.content);
      const toolId = typeof part.id === 'string' ? part.id : String(index);
      const name = typeof part.name === 'string' ? part.name : 'tool';
      const metadata = state.metadata && typeof state.metadata === 'object' ? state.metadata as Record<string, unknown> : undefined;
      const failed = state.status !== 'completed' || Boolean(state.error);
      const errorText = failed
        ? (typeof state.error === 'string' ? state.error : textOf(state.content) || 'The tool failed.')
        : '';
      const parsedObject = parsed.value && typeof parsed.value === 'object' && !Array.isArray(parsed.value)
        ? parsed.value as Record<string, unknown>
        : undefined;
      // The built-in todowrite tool returns its structured list in metadata and
      // a human summary in content; keep both paths working.
      const plain = parsedObject || (metadata && Array.isArray(metadata.todos) ? { todos: metadata.todos } : undefined);
      const outputFailed = !failed && plain?.status === 'failed';
      const outputError = outputFailed && plain?.error && typeof plain.error === 'object' ? plain.error as { code?: unknown; message?: unknown } : undefined;
      const errorRecord = state.error && typeof state.error === 'object' ? state.error as { type?: unknown; message?: unknown } : undefined;
      const activityError = failed
        ? { code: typeof errorRecord?.type === 'string' ? errorRecord.type : 'TOOL_FAILED', message: errorText.slice(0, 500) }
        : outputFailed ? { code: typeof outputError?.code === 'string' ? outputError.code : 'TOOL_FAILED', message: typeof outputError?.message === 'string' ? outputError.message.slice(0, 500) : 'The tool reported a failure.' } : undefined;
      const toolStatus: AgentToolStatus = activityError ? 'failed' : plain?.status === 'running' ? 'running' : 'success';
      const activity: AgentToolActivity = {
        type: 'tool',
        name,
        status: toolStatus,
        summary: activityError ? activityError.message.slice(0, 180) : toolActivitySummary(name, plain, toolStatus),
        ...(typeof part.time?.created === 'number' && typeof part.time?.completed === 'number' ? { durationMs: Math.max(0, part.time.completed - part.time.created) } : {}),
        ...(activityError ? { error: activityError } : {}),
      };
      activities.push(activity);
      if (name === 'todowrite') {
        const todos = todosFromOutput(plain);
        if (todos) latestTodos = todos;
      }
      const jobId = plain && typeof plain.jobId === 'string' ? plain.jobId : undefined;
      const jobKind = plain && typeof plain.kind === 'string' ? plain.kind : undefined;
      const jobStatus = plain && typeof plain.status === 'string' ? plain.status : undefined;
      const result = !failed && jobId && options.resolveJobResult ? options.resolveJobResult(jobId) : plain?.result;
      const approvalRecord = plain && plain.approval && typeof plain.approval === 'object' ? plain.approval as Record<string, unknown> : undefined;
      const approvalDeclared = plain?.status === 'approval_required' || Boolean(approvalRecord);
      const summary = plain?.assumptions ?? (approvalRecord?.summary as unknown);
      const toolMessage: AdaptedEngineMessage = {
        id: toolMessageId(message.id, toolId, index),
        role: 'tool',
        tool: name,
        ...(timestamp ? { timestamp: timestamp + index } : {}),
        seq: seq > 0 ? seq + 1 + index : 0,
        ...(result !== undefined ? { result } : {}),
        ...(jobId ? { job: { id: jobId, ...(jobKind ? { kind: jobKind } : {}), ...(jobStatus ? { status: jobStatus } : {}) } } : {}),
        ...(approvalDeclared ? {
          approval: {
            id: String(plain?.approvalId ?? approvalRecord?.id ?? jobId ?? toolId),
            tool: name,
            status: 'pending' as const,
            ...(typeof approvalRecord?.title === 'string' ? { title: approvalRecord.title } : {}),
            ...(Array.isArray(summary) ? { summary: summary.filter((line): line is string => typeof line === 'string').slice(0, 30) } : {}),
          },
        } : {}),
        text: failed
          ? errorText
          : approvalDeclared
            ? 'Waiting for operator approval of the reviewed assumptions.'
            : typeof plain?.note === 'string'
              ? plain.note
              : typeof plain?.status === 'string' && plain.status === 'running'
                ? 'Still running; the assistant can call again.'
                : typeof plain?.status === 'string' && plain.status === 'queued'
                  ? 'Research job queued.'
                  : '',
        activity,
        raw: { id: toolId, name, state: { status: state.status, input: state.input, metadata: state.metadata } },
      };
      if (!toolMessage.text) delete toolMessage.text;
      output.push(toolMessage);
      if (result && (name === 'scan_market' || name === 'get_scan_result') && typeof result === 'object') {
        // The durable scan result is authoritative; the inline tool output may
        // only say "queued". Use the result plus the original input (which
        // carries the strategy) so the screen card can be attached.
        turnToolOutputs.push({ name, input: state.input, output: { ...(result as Record<string, unknown>), status: 'succeeded' }, result, raw: part });
      } else if (plain) turnToolOutputs.push({ name, input: state.input, output: plain, result, raw: part });
    }
    if (activities.length) assistantMessage.activities = activities;
    if (latestTodos) assistantMessage.todos = latestTodos;
  }
  finishTurn();
  return output;
}

/**
 * Map a stored session log to message seq values the client can persist. One
 * durable sequence step maps a whole message to seq * 1000; its tool cards use
 * small offsets inside that block so every event is strictly increasing and the
 * next durable event is always larger.
 */
export function buildSeqIndex(items: unknown[]): SeqIndex {
  const byMessageId = new Map<string, number>();
  let lastSeq = 0;
  for (const raw of items) {
    const item = (raw ?? {}) as { type?: unknown; seq?: unknown; durable?: { seq?: unknown }; data?: Record<string, unknown> };
    if (typeof item.type !== 'string') continue;
    const seq = typeof item.durable?.seq === 'number' ? item.durable.seq : typeof item.seq === 'number' ? item.seq : 0;
    if (seq > lastSeq) lastSeq = seq;
    const data = item.data ?? {};
    const inbox = typeof data.inboxID === 'string' ? data.inboxID : undefined;
    const assistant = typeof data.assistantMessageID === 'string' ? data.assistantMessageID : undefined;
    if (inbox && (item.type === 'session.inbox.delivered' || item.type === 'session.inbox.enqueued')) {
      if (item.type === 'session.inbox.delivered' || !byMessageId.has(inbox)) byMessageId.set(inbox, seq * 1000);
    }
    if (assistant && ['session.step.ended', 'session.step.started', 'session.tool.success', 'session.tool.failed'].includes(item.type)) {
      if (item.type === 'session.step.ended' || !byMessageId.has(assistant)) byMessageId.set(assistant, seq * 1000);
    }
  }
  return { byMessageId, lastSeq };
}

/** Text for an engine execution error, safe to show to the user. */
export function idleErrorText(error: unknown): string {
  if (!error || typeof error !== 'object') return 'The AI engine did not complete this turn.';
  const record = error as { type?: unknown; message?: unknown };
  const detail = typeof record.message === 'string' ? record.message : '';
  return detail || 'The AI engine did not complete this turn.';
}
