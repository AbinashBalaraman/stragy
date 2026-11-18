import React, { useEffect, useRef, useState } from 'react';
import { Send, X, ImagePlus, MoreHorizontal, Copy, Check, RefreshCw, Mic, MicOff, Volume2, VolumeX } from 'lucide-react';
import { z } from 'zod';
import type { BacktestResponse, StrategyAST, SymbolMeta } from '../../shared/strategy/types';
import { snapshotStrategy } from '../../client/workspace';
import { canonicalStrategySignature, exitRuleCompatibility } from '../../shared/strategy/backtestReview';
import { assertProposalCurrent, parseStrategyProposal, type StrategyProposal } from '../../shared/contracts/ai-proposal';
import { cancelResearchJob, checkBacktestJob, checkScanJob, requestScan, type ResearchPhase, type RunRequestOptions, type ScanResult } from '../../client/api';
import {
  createEngineSession, deleteEngineSession, exportEngineSession, getEngineMessages, getEngineUsage, getJobStatus,
  interruptEngineSession, isEngineUnavailable, listEngineModels, listEngineSessions, postEngineApproval, postEngineMessage,
  readStoredEngineSession, rememberEngineCursor, renameEngineSession, resumeInterruptedJob, subscribeEngineEvents,
  switchEngineModel, writeStoredEngineSession, clearStoredEngineSession,
  normalizeEngineTodos, normalizeToolActivities,
  type EngineEvent, type EngineMessage, type EngineModel, type EngineSessionSummary, type EngineSubscription,
  type EngineToolActivity, type EngineUsage,
} from '../../client/engine';
import {
  cancelSpeech, createVoiceInput, mediaRecorderSupported, readVoicePreferences, speak,
  speechRecognitionSupported, speechSynthesisSupported, writeVoicePreferences,
  type VoiceInputController,
} from '../../client/voice';
import { requestFeatureSetup } from '../../client/featureSetup';
import { FEATURE_PREFILL_EVENT, parseFeaturePrefill, publishFeaturePrefill } from '../../client/featureHandoff';
import { readPreferences, rememberPreference } from '../../client/preferences';
import { getSymbolById } from '../../shared/data/symbols';
import { prepareChartImage, requestChartAnalysis, CHART_IMAGE_ACCEPT, type ChartAnalysisResponse, type ChartImageAttachment, type ChartImageReading } from '../../client/chartAnalysis';
import { chartImageHash, readCachedChartAnalysis, writeCachedChartAnalysis } from '../../client/chartReadingCache';
import { validateStrategy } from '../../shared/strategy/schema';
import { parseResearchChatResponse, type ResearchChatResponse, type ResearchScreenPlan } from '../../shared/contracts/research-chat';
import { parseScanResult } from '../../shared/contracts/scanner-results';
import { parseBacktestResult } from '../../shared/contracts/research';
import { ScreenResultCard } from './ScreenResultCard';
import { ChartReadingCard } from './ChartReadingCard';
import { BacktestResultCard } from './BacktestResultCard';
import { BacktestReviewCard } from './BacktestReviewCard';
import { AssistantPending } from './AssistantPending';
import { MessageText } from './MessageText';
import { AgentActivity, type AgentToolEntry } from './AgentActivity';
import { AgentTodoList, type AgentTodoItem } from './AgentTodoList';
import { EngineErrorCard } from './EngineErrorCard';
import { EngineScanResultCard } from './EngineScanResultCard';
import { ChatHeader } from './ChatHeader';
import { SessionHistoryPanel, sessionTitle } from './SessionHistoryPanel';
import { SystemPanel } from './SystemPanel';
import { DataCachePanel } from './DataCachePanel';
import { downloadTextFile, SlideOver, useDebouncedValue } from './chatUi';
import { toolLabel } from './agentToolLabels';
import type { BacktestReview } from './types';
import { summarizeRunData } from './runSummary';
import { universeLabel } from './universeLabel';
import { ActionRow } from '../common/ActionRow';
import { Sources, type SourceItem } from '../common/Sources';
import { CardShell } from '../common/CardShell';
import { Disclosure } from '../common/Disclosure';
import {
  classifyReviewReply,
  parseBacktestIntent,
  resolveStock,
  type ReviewReply,
} from './researchFollowUp';

export interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: number;
  /** Honest source of the reply. Never labels a local parser as AI. */
  methodLabel?: string;
  /** Full provider/model detail for the label's tooltip. */
  methodTitle?: string;
  warnings?: string[];
  /** Prompt to resend when a provider failure offers Retry. */
  retryPrompt?: string;
  /** An error that belongs in the conversation, announced once (role="alert"). */
  tone?: 'error';
  /** Typed engine failure: code, status and whether Retry can resend the turn. */
  errorCode?: string;
  errorStatus?: number;
  errorRetryable?: boolean;
  /** Completed/restored tool timeline for this assistant turn. */
  activity?: AgentToolEntry[];
  /** Restored engine plan checklist for this turn. */
  todos?: AgentTodoItem[];
}

type MessageExtras = Pick<ChatMessage, 'methodLabel' | 'methodTitle' | 'warnings' | 'retryPrompt' | 'tone' | 'errorCode' | 'errorStatus' | 'errorRetryable' | 'activity' | 'todos'>;

/** The turn currently streaming from the engine (timeline + plan + Stop). */
interface LiveActivity {
  entries: AgentToolEntry[];
  todos: AgentTodoItem[];
  running: boolean;
  currentStep?: string;
  /** Assistant message this turn resolved to; null until its answer arrives. */
  anchorId: string | null;
}

const EMPTY_ACTIVITY = (): LiveActivity => ({ entries: [], todos: [], running: false, anchorId: null });

const TERMINAL_TOOL_STATUS = new Set(['success', 'failed']);

/** A polling tool reports the same job repeatedly; one row is enough. */
const POLLING_TOOL = /^(?:get_scan_result|get_scan_status|get_job_status|check_scan_job|check_backtest_job|check_market_job|scan_progress|get_scan|poll_job|get_job)$/i;

/** One entry per tool call: a running entry is updated in place, done ones append. */
function upsertToolEntry(entries: AgentToolEntry[], entry: AgentToolEntry): AgentToolEntry[] {
  const polling = POLLING_TOOL.test(entry.name);
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const existing = entries[index];
    if (existing.name !== entry.name) continue;
    if (polling) {
      // A scan poll repeated ten times is one step with an attempt count and
      // the latest server summary, not ten identical lines.
      const next = entries.slice();
      next[index] = { ...entry, attempts: (existing.attempts ?? 1) + 1 };
      return next;
    }
    if (!TERMINAL_TOOL_STATUS.has(existing.status) || !TERMINAL_TOOL_STATUS.has(entry.status)) {
      const next = entries.slice();
      next[index] = entry;
      return next;
    }
    break;
  }
  return [...entries, entry].slice(-24);
}

function activityEntry(activity: EngineToolActivity): AgentToolEntry {
  return {
    type: 'tool',
    name: activity.name,
    status: activity.status,
    ...(activity.summary ? { summary: activity.summary } : {}),
    ...(activity.durationMs !== undefined ? { durationMs: activity.durationMs } : {}),
    ...(activity.attempts !== undefined ? { attempts: activity.attempts } : {}),
    ...(activity.error && (activity.error.code || activity.error.message)
      ? { error: { code: activity.error.code ?? 'TOOL_FAILED', message: activity.error.message ?? 'This step could not finish.' } }
      : {}),
  };
}

/** Before Agent B streams normalized activity, a tool message still earns a line. */
function activityFromToolMessage(message: EngineMessage): AgentToolEntry | null {
  const name = message.tool?.trim();
  if (!name) return null;
  const jobStatus = message.job?.status;
  const status: AgentToolEntry['status'] = message.error || jobStatus === 'failed' || jobStatus === 'cancelled'
    ? 'failed'
    : message.approval && message.approval.status !== 'approved' && message.approval.status !== 'rejected'
      ? 'called'
      : jobStatus === 'queued' ? 'called'
        : jobStatus === 'running' ? 'running'
          : jobStatus === 'succeeded' || message.result !== undefined ? 'success'
            : 'running';
  const summary = message.text?.trim();
  return {
    type: 'tool',
    name,
    status,
    ...(summary ? { summary } : {}),
    ...(message.durationMs !== undefined ? { durationMs: message.durationMs } : {}),
    ...(message.error ? { error: { code: message.error.code ?? 'TOOL_FAILED', message: message.error.message ?? 'This step could not finish.' } } : {}),
  };
}

function todosFromToolMessage(message: EngineMessage): AgentTodoItem[] {
  const name = (message.tool ?? '').toLowerCase();
  if (!/todo/.test(name)) return [];
  return normalizeEngineTodos(message.result ?? message.todos);
}

export type CopilotVariant = 'full' | 'dock';

interface Props {
  strategy: StrategyAST;
  onApplyVariation?: (strategy: StrategyAST) => boolean | void | Promise<boolean | void>;
  onClose?: () => void;
  onResearchBacktest?: (strategy: StrategyAST, asOf?: string, options?: RunRequestOptions) => Promise<BacktestResponse | null | void>;
  variant?: CopilotVariant;
  symbols?: SymbolMeta[];
  onOpenDetails?: (result: BacktestResponse) => void;
  newConversationSignal?: number;
  onCancelResearch?: () => void;
  onSaveStrategy?: (strategy: StrategyAST) => Promise<{ name: string } | void>;
  /** Live phase of a run started from this conversation ('waiting' = queued). */
  runPhase?: ResearchPhase | null;
}

/**
 * The first-version chat kept its transcript in this browser. The engine owns
 * history now; these two keys are cleared once on load and never written again.
 */
const LEGACY_HISTORY_KEYS = ['stragy_copilot_review_history_v2', 'stragy_copilot_previous_conversation_v1'] as const;
/** The plan of a scan that was in flight when the page went away. */
export const PENDING_SCAN_KEY = 'stragy_copilot_pending_scan_v1';

/** Only explicit rule sentences enter the async feature-setup call path. */
function wantsFeatureSetup(text: string): boolean {
  // Both feature surfaces accept rules. A scanner sentence must not be treated
  // as a stock-specific chat request, and a tester sentence must not lose its
  // explicit entry/exit rules.
  const asksTester = /\b(?:backtest|strategy\s+tester|test\s+(?:this|the)\s+strategy|run\s+(?:this|the)\s+strategy)\b/i.test(text);
  // Simple "screen/find Nifty 50 ..." sentences stay in research chat so the
  // server's deterministic planner returns a ScreenResultCard. Only an explicit
  // request to open the market scanner hands the setup to the scanner page.
  const asksScanner = /\b(?:open|use|go\s+to)\b[^.;\n]{0,30}\b(?:market\s+)?scanner\b/i.test(text)
    || /\b(?:market\s+scanner)\b/i.test(text);
  if (!asksTester && !asksScanner) return false;

  const rsiRule = /\brsi\b/i.test(text)
    && /(?:below|above|under|over|less\s+than|greater\s+than|<|>)/i.test(text)
    && /\d/.test(text);
  const averageRule = /\b(?:sma|ema)\s*\d{1,3}\b/i.test(text)
    && /\b(?:cross(?:es|ed|ing)?|above|below)\b/i.test(text);
  const breakoutRule = /\b(?:breakout|breaks?\s+(?:out\s+)?(?:above|over)|closes?\s+(?:above|over))\b/i.test(text)
    && /\b\d{1,3}[- ]?(?:day|bar|period|session)?\s*high\b/i.test(text);
  return rsiRule || averageRule || breakoutRule;
}

const SESSION_QUERY = /^[A-Za-z0-9_-]{1,200}$/;

/** The chat in the address bar wins over browser storage: links are shareable. */
function sessionFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = new URL(window.location.href).searchParams.get('session');
    return value && SESSION_QUERY.test(value) ? value : null;
  } catch {
    return null;
  }
}

function writeSessionUrl(sessionId: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    if (sessionId) url.searchParams.set('session', sessionId);
    else url.searchParams.delete('session');
    window.history.replaceState({}, '', url.toString());
  } catch { /* an embed without history still works; only the link is missing */ }
}

type Proposal = StrategyProposal & { sourceSnapshot: string; validatedCandidate: StrategyAST };

/** A completed screen/chart card, kept at the message that produced it. */
interface PastCard {
  id: string;
  messageId: string | null;
  plan: ResearchScreenPlan;
  result: ScanResult | null;
  chartReading: ChartImageReading | null;
  imageUrl?: string;
  imageName?: string;
}

/**
 * A card restored from an engine session: the engine's durable transcript only
 * carries ids and payloads, so these render read-only through the same card
 * components (scan table, chart reading, backtest result, draft summary).
 */
interface RestoredCard {
  id: string;
  messageId: string;
  plan?: ResearchScreenPlan;
  scanResult?: ScanResult | null;
  chartReading?: ChartImageReading | null;
  result?: BacktestResponse;
  proposal?: { name: string; provider: string; changes: string[]; warnings: string[] };
}

/** A gated engine action waiting for the user's explicit approval. */
interface EngineApproval {
  messageId: string;
  approvalId: string;
  title: string;
  summary: string[];
}

/** Parse an adapter payload without ever inventing a card from a broken one. */
function parseEnginePayload(payload: unknown): ResearchChatResponse | null {
  if (!payload || typeof payload !== 'object') return null;
  try { return parseResearchChatResponse(payload); } catch { return null; }
}

type BaseContext = { strategy: StrategyAST; asOf?: string; sourceLabel: string; assumptions: string[] };

const STARTERS = [
  { label: 'RSI oversold after overbought', text: 'Find Nifty 50 RSI oversold stocks after recently overbought' },
  { label: 'Set my stop loss to 3%', text: 'Set my stop loss to 3%' },
  { label: 'Use a 2% trailing stop', text: 'Set my trailing stop to 2%' },
];

/** One shape for all three starters: same padding, same height, equal row. */
const STARTER_CHIP_CLASS = 'flex min-h-11 items-center rounded-[var(--r-inner)] bg-[var(--surface-2)] px-3.5 py-2.5 text-left st-meta text-[var(--text-2)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-1)] sm:min-h-12';

function providerModel(provider: { name: string; model: string | null }): { providerName: string; model: string } {
  const at = provider.name.indexOf(':');
  if (at > 0) return { providerName: provider.name.slice(0, at), model: provider.name.slice(at + 1) };
  return { providerName: provider.name, model: provider.model ?? '' };
}

const modelDisplayName = (providerName: string, model: string): string => {
  if (providerName === 'openrouter') return `OpenRouter free (${model || 'routed model'})`;
  if (model === 'hy4-flash-free') return 'HY4 Flash (free)';
  if (model === 'deepseek-v4.1-flash') return 'DeepSeek V4.1 Flash (paid fallback)';
  if (model === 'longcat-2.5-free') return 'LongCat 2.5 (free)';
  if (model === 'beam-free') return 'Beam (free)';
  return model || 'AI';
};

const methodLabel = (method: string, provider: { name: string; model: string | null; aiGenerated: boolean }): string => {
  if (provider.aiGenerated) {
    const used = providerModel(provider);
    return 'AI · ' + modelDisplayName(used.providerName, used.model);
  }
  if (method === 'local_heuristic') return 'Local keyword rules · not AI';
  // Sector and market answers are parsed from the live quote feed, not the rule parser.
  if (/angel one live quotes/i.test(provider.name)) return 'Angel One live quotes · not AI';
  if (method === 'rule_parser') return 'Built-in rule parser · not AI';
  return 'Unavailable · no result was invented';
};

/**
 * A run failure in plain language. The raw provider text never reaches the
 * transcript; the code (when the server sends one) picks the sentence.
 */
function backtestFailureLine(caught: unknown): string {
  const error = caught as { code?: string; message?: string; status?: number };
  const code = (error?.code ?? '').toUpperCase();
  const message = error?.message ?? '';
  if (/RATE_LIMIT|RATE_LIMITED/.test(code) || error?.status === 429 || /rate limit/i.test(message)) {
    return "The backtest didn't finish: Angel One is busy. Try again in a minute.";
  }
  if (/DEADLINE|TIMEOUT|JOB_TIMEOUT/.test(code) || /timed out|deadline/i.test(message)) {
    return "The backtest didn't finish in time. Try again in a minute.";
  }
  if (/UNAVAILABLE|PROVIDER|NETWORK|FETCH/.test(code) || /unavailable|network|failed to fetch/i.test(message)) {
    return "The backtest didn't finish: the market data source is unavailable. Try again in a minute.";
  }
  return "The backtest didn't finish. Try again in a minute.";
}

/** Turn a provider failure into one actionable bubble message; the raw detail stays under Warnings. */
function providerFailureFor(message: string): { text: string; detail: string } | null {
  if (!/External AI request failed/i.test(message)) return null;
  const status = /HTTP (\d{3})/.exec(message)?.[1];
  if (status === '429' || /rate limit/i.test(message)) {
    return { text: 'The AI model is busy (rate limit). Try again in a minute.', detail: message };
  }
  if (status === '403' || /refused access/i.test(message)) {
    return { text: 'The AI model refused the request.', detail: message };
  }
  if (/timed out|timeout/i.test(message)) {
    return { text: 'The AI model took too long to respond. Try again.', detail: message };
  }
  return { text: 'The AI model is unavailable right now. Try again.', detail: message };
}

const fileSizeLabel = (bytes: number): string => bytes >= 1024 * 1024
  ? (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  : Math.max(1, Math.round(bytes / 1024)) + ' KB';

/**
 * Server diffs are technical strings ("risk.stopLoss.value: 3.5 -> 3"). A chat
 * edit only reaches a handful of fields, so those get plain language for the
 * card title and list; id-only diffs are never shown as a "change".
 */
interface DraftChange {
  label: string;
  value: string;
  plain: boolean;
}

const RISK_FIELDS: Record<string, { label: string; suffix?: '%' }> = {
  'risk.stopLoss.value': { label: 'Stop loss', suffix: '%' },
  'risk.takeProfit.value': { label: 'Target', suffix: '%' },
  'risk.trailingStop.value': { label: 'Trailing stop', suffix: '%' },
  'risk.positionSizePercent': { label: 'Position size', suffix: '%' },
  'risk.maxPositions': { label: 'Max positions' },
  'risk.initialCapital': { label: 'Initial capital' },
};

/**
 * A change arrives either as plain language from the server
 * ("Stop loss: 3.5% → 3%") or, from older builds, as a technical diff
 * ("risk.stopLoss.value: 3.5 -> 3"). Both are understood; an id-only diff is
 * never shown as a change.
 */
const describeDraftChange = (change: string): DraftChange | null => {
  const text = change.trim();
  if (!text) return null;
  const technical = /^([\w.[\]]+):\s*(.+) -> (.+)$/.exec(text);
  if (!technical) {
    if (/(?:^|\.)id\s*:/.test(text)) return null;
    return { label: text, value: '', plain: true };
  }
  const [, path, before, after] = technical;
  if (/(?:^|\.)id$/.test(path)) return null;
  const parse = (value: string) => {
    try { return JSON.parse(value) as unknown; } catch { return value; }
  };
  const known = RISK_FIELDS[path];
  const render = (value: unknown) => typeof value === 'number' ? String(value) : String(value).replace(/^"|"$/g, '');
  if (!known) return { label: text, value: '', plain: false };
  const suffix = known.suffix ?? '';
  return { label: known.label, value: render(parse(before)) + suffix + ' → ' + render(parse(after)) + suffix, plain: true };
};

/** The card title is the primary change, read as a headline ("Stop loss 3.5% → 3%"). */
const changeTitle = (change: DraftChange): string => change.value
  ? change.label + ' ' + change.value
  : change.label.replace(/^([^:]{1,60}):\s*(.+)$/, '$1 $2');

const RISK_TYPE: Record<string, 'stopLoss' | 'takeProfit' | 'trailingStop'> = {
  'Stop loss': 'stopLoss',
  Target: 'takeProfit',
  'Trailing stop': 'trailingStop',
};

/** A stop or target is a percent only when the workspace risk model says so. */
const withPercentSuffix = (change: DraftChange, strategy: StrategyAST): DraftChange => {
  const key = RISK_TYPE[change.label];
  if (!key) return change;
  const type = strategy.risk?.[key]?.type;
  if (type === 'percent') return change;
  return { ...change, value: change.value.replace(/%/g, '') };
};

/**
 * Citation chips come from the URLs the answer actually contains: a markdown
 * link keeps its label, a bare URL shows its host. No URL, no chip row.
 */
const SOURCE_URL = /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)|https?:\/\/[^\s<>()[\]]+/g;

function sourcesFor(text: string): SourceItem[] {
  const seen = new Set<string>();
  const items: SourceItem[] = [];
  for (const match of text.matchAll(SOURCE_URL)) {
    const href = (match[2] ?? match[0]).replace(/[.,;:!?]+$/, '').replace(/\)+$/, '');
    if (!/^https?:\/\//i.test(href) || seen.has(href)) continue;
    seen.add(href);
    let host = href;
    try { host = new URL(href).hostname.replace(/^www\./, ''); } catch { /* keep the href as its own label */ }
    items.push({ label: match[1] ?? host, href, title: href });
    if (items.length >= 6) break;
  }
  return items;
}

const DRAFT_MENU_ITEM = 'st-meta flex w-full items-center gap-2 rounded-[var(--r-btn)] px-2.5 py-2 text-left text-[var(--text-2)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-1)] disabled:cursor-not-allowed disabled:text-[var(--text-disabled)]';

/** A screen response can carry the contract-validated chart fields directly. */
function chartReadingFromScreen(plan: ResearchScreenPlan): ChartImageReading | null {
  if (plan.source !== 'chart_image' || !plan.observations || plan.confidence === undefined || plan.summary === undefined) return null;
  return { source: plan.source, observations: plan.observations, confidence: plan.confidence, summary: plan.summary };
}

/** A calendar day (YYYY-MM-DD), or null when the value is not a date. */
export function reviewDay(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = String(value).trim();
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(trimmed);
  if (iso) return iso[1];
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

/**
 * A run may only complete the exact reviewed strategy on the same instrument.
 * `review.asOf` is a cutoff, not a promise that data exists for that day: a
 * dataset that ends earlier is valid, anything observed after it is not.
 */
export function isCurrentReviewResult(result: BacktestResponse | null | void | undefined, review: BacktestReview): result is BacktestResponse {
  if (!result || typeof result !== 'object') return false;
  if (typeof result.backtestId !== 'string'
    || !result.metrics || typeof result.metrics !== 'object'
    || !Array.isArray(result.bars) || !Array.isArray(result.trades)) return false;
  if (result.symbol?.ticker !== review.symbol.ticker || result.symbol?.id !== review.symbol.id) return false;
  if (result.strategy?.universe?.symbolId !== review.symbol.id) return false;
  const resultSignature = canonicalStrategySignature(result.strategy);
  if (!resultSignature || resultSignature !== review.strategySignature) return false;
  const cutoff = reviewDay(review.asOf);
  const observed = reviewDay(summarizeRunData(result).observedThrough);
  if (cutoff && observed && observed > cutoff) return false;
  return true;
}

/**
 * The primary Stragy research conversation. It reuses the validated proposal and
 * screen contracts, keeps apply/save/run separate, and only executes a backtest
 * after an explicit review of the exact frozen assumptions.
 */
export const AiCopilotDock: React.FC<Props> = ({
  strategy,
  onApplyVariation,
  onClose,
  onResearchBacktest,
  variant = 'dock',
  symbols = [],
  onOpenDetails,
  newConversationSignal,
  onCancelResearch,
  onSaveStrategy,
  runPhase = null,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [prompt, setPrompt] = useState('');
  const [chartImage, setChartImage] = useState<ChartImageAttachment | null>(null);
  const [chartReading, setChartReading] = useState<ChartImageReading | null>(null);
  /** The failed chart request, kept so Try again can re-read the same image and hint. */
  const [chartRetry, setChartRetry] = useState<{ image: ChartImageAttachment; hint: string; messageId: string } | null>(null);
  /**
   * Completed cards from earlier in this conversation. A later request clears
   * the live card state, but the answer that produced a table stays readable.
   */
  const [pastCards, setPastCards] = useState<PastCard[]>([]);
  const [preparingImage, setPreparingImage] = useState(false);
  const [imageError, setImageError] = useState('');
  const [dragActive, setDragActive] = useState(false);
  /** The last image that was sent, kept so the chart card can show it (P1-3). */
  const [sentChartImage, setSentChartImage] = useState<ChartImageAttachment | null>(null);
  /** Auto-scroll only while the reader is at the bottom (P0-6). */
  const [pinned, setPinned] = useState(true);
  /** "Jump to latest" appears once the newest content is clearly out of view. */
  const [jumpVisible, setJumpVisible] = useState(false);
  /** Apply-and-backtest: the draft id plus the exact strategy the workspace must hold. */
  const [pendingDraftBacktest, setPendingDraftBacktest] = useState<{ id: string; snapshot: string } | null>(null);
  /** One absolute deadline per apply: re-renders can neither postpone nor cancel it. */
  const pendingBacktestDeadline = useRef(0);
  /** The workspace as last rendered, read when that deadline fires. */
  const latestWorkspace = useRef<{ applied: string | null; snapshot: string }>({ applied: null, snapshot: '' });
  /** Last request text, so a failed apply-to-review can offer its retry. */
  const lastPromptRef = useRef('');
  /** A send asks for the answer: follow it until the reader scrolls by hand. */
  const followAnswer = useRef(false);
  /** Cards render right after the message that produced them, not at the end. */
  const [workingAnchorId, setWorkingAnchorId] = useState<string | null>(null);
  const [resultAnchorId, setResultAnchorId] = useState<string | null>(null);
  /** The assistant message whose provenance the visible card already states. */
  const [cardMessageId, setCardMessageId] = useState<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  /** A reply that lands in under 300 ms never shows a skeleton (cache hits). */
  const [showPending, setShowPending] = useState(false);
  const [screenPlan, setScreenPlan] = useState<ResearchScreenPlan | null>(null);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scanPending, setScanPending] = useState(false);
  /** A queued scan is waiting behind another job, not evaluating yet. */
  const [scanWaiting, setScanWaiting] = useState(false);
  /** "scan 42/50" from the job stage, shown while the scan runs. */
  const [scanProgress, setScanProgress] = useState<{ done: number; total: number } | null>(null);
  /** A client deadline no longer discards the job: it is still running server-side. */
  const [stalledScan, setStalledScan] = useState<string | null>(null);
  const [stalledRun, setStalledRun] = useState<string | null>(null);
  const scanPendingRef = useRef(false);
  const [scanError, setScanError] = useState('');
  /** A chart reading must be confirmed/edited before any scan starts. */
  const [awaitingChartConfirm, setAwaitingChartConfirm] = useState(false);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  /** Local keyword fallback is always available; the advanced toggle was removed to keep the composer simple. */
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [applied, setApplied] = useState<string | null>(null);
  const [applyStatus, setApplyStatus] = useState('');
  const [clipboardStatus, setClipboardStatus] = useState('');
  const [saveStatus, setSaveStatus] = useState('');
  const [review, setReview] = useState<BacktestReview | null>(null);
  const [reviewStatus, setReviewStatus] = useState<'idle' | 'running' | 'complete' | 'cancelled'>('idle');
  const [reviewError, setReviewError] = useState('');
  const [validatedResult, setValidatedResult] = useState<BacktestResponse | null>(null);
  const [awaitingSymbolFor, setAwaitingSymbolFor] = useState<'screen' | 'draft' | 'workspace' | null>(null);
  const [backtestChoice, setBacktestChoice] = useState<{ symbol: SymbolMeta; asOf?: string } | null>(null);
  const [lastContext, setLastContext] = useState<'screen' | 'draft' | null>(null);
  const pendingApply = useRef<{ id: string; snapshot: string } | null>(null);
  const clipboardGeneration = useRef(0);
  const revision = useRef(0);
  const generation = useRef(0);
  const runGeneration = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const seenNewChat = useRef(newConversationSignal ?? 0);
  const reviewRef = useRef<BacktestReview | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);
  const lastMessageRef = useRef<HTMLDivElement | null>(null);
  const revealedCard = useRef<Element | null>(null);
  const revealedBusy = useRef(false);
  const revealIntent = useRef<'send' | 'scan' | 'run' | null>(null);
  const pinnedRef = useRef(true);
  const draftMenuRef = useRef<HTMLDetailsElement | null>(null);
  const messageSeq = useRef(0);
  /** Engine session state: the durable OpenCode chat (Agent B's REST block). */
  const [engineStatus, setEngineStatus] = useState<'detecting' | 'ready' | 'unavailable'>('detecting');
  const [engineSessionId, setEngineSessionId] = useState<string | null>(null);
  const engineSessionRef = useRef<string | null>(null);
  const engineSeqRef = useRef(0);
  const engineSeenIds = useRef<Set<string>>(new Set());
  const engineSubscription = useRef<EngineSubscription | null>(null);
  const engineGeneration = useRef(0);
  /** The optimistic user turn waiting for the engine to echo its durable id. */
  const pendingUserText = useRef<string | null>(null);
  const pendingUserMessageId = useRef<string | null>(null);
  const [engineNote, setEngineNote] = useState('');
  const [engineLink, setEngineLink] = useState<'connecting' | 'live' | 'reconnecting'>('connecting');
  const [engineApproval, setEngineApproval] = useState<EngineApproval | null>(null);
  const [interruptedJob, setInterruptedJob] = useState<{ jobId: string } | null>(null);
  const [restoredCards, setRestoredCards] = useState<RestoredCard[]>([]);
  /** Engine history: sessions, models, usage and the management panels. */
  const [sessionList, setSessionList] = useState<EngineSessionSummary[] | null>(null);
  const [sessionListStatus, setSessionListStatus] = useState('');
  const [sessionListLoading, setSessionListLoading] = useState(false);
  const [sessionListError, setSessionListError] = useState('');
  const [activeSession, setActiveSession] = useState<EngineSessionSummary | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState('');
  const historyQueryDebounced = useDebouncedValue(historyQuery, 250);
  const [dataOpen, setDataOpen] = useState(false);
  const [systemOpen, setSystemOpen] = useState(false);
  const [models, setModels] = useState<EngineModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState('');
  const [modelsBusy, setModelsBusy] = useState(false);
  const [selectedModel, setSelectedModel] = useState<{ providerID: string; id: string } | null>(null);
  const [engineUsage, setEngineUsage] = useState<EngineUsage | null>(null);
  /** Long turns: 90 s is a note, 20 min is "still running" without fake completion. */
  const [turnLong, setTurnLong] = useState(false);
  const [turnExpired, setTurnExpired] = useState(false);
  const [retryingEngine, setRetryingEngine] = useState(false);
  const lastEngineTurn = useRef<{ text: string; image: ChartImageAttachment | null }>({ text: '', image: null });
  const turnTimers = useRef<{ long: number | null; expire: number | null }>({ long: null, expire: null });
  const historyRequest = useRef(0);
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    try { return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(max-width: 767px)').matches : false; } catch { return false; }
  });
  /** The live engine turn's tool timeline and plan (per assistant turn). */
  const [liveActivity, setLiveActivity] = useState<LiveActivity>(EMPTY_ACTIVITY);
  const liveActivityRef = useRef<LiveActivity>(liveActivity);
  const previousActivityAnchor = useRef<string | null>(null);
  /** A scan result that arrived before the screen plan in the same engine turn. */
  const turnScanResult = useRef<ScanResult | null>(null);
  /** Voice composer state. Text always works; voice is additive and honest. */
  const [voiceMode, setVoiceMode] = useState(() => readVoicePreferences().voiceMode);
  const [listening, setListening] = useState(false);
  const [voiceNote, setVoiceNote] = useState('');
  const voiceController = useRef<VoiceInputController | null>(null);
  const voiceBase = useRef('');
  const spokenMessageId = useRef<string | null>(null);
  const voiceInputSupported = speechRecognitionSupported() || mediaRecorderSupported();
  const voiceOutputSupported = speechSynthesisSupported();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const imageGeneration = useRef(0);
  const snapshot = JSON.stringify(strategy);
  if (pendingDraftBacktest) {
    // Only while an apply is waiting: the deadline timer needs the workspace as
    // of the newest render, which may commit after the timer was armed.
    try {
      latestWorkspace.current = { applied, snapshot: JSON.stringify(snapshotStrategy(strategy)) };
    } catch {
      latestWorkspace.current = { applied, snapshot: '' };
    }
  }
  const full = variant === 'full';
  const busy = loading || scanPending || reviewStatus === 'running';
  /** This conversation is durable on the server, not just in this browser. */
  const engineConversation = engineStatus === 'ready' && !!engineSessionId;
  /** An engine turn owns the busy slot; its Stop lives in the activity strip. */
  const engineTurnInFlight = loading && engineConversation;
  /** The timeline is the loading state once the engine reports a tool step. */
  const turnHasActivity = liveActivity.entries.length > 0 || liveActivity.todos.length > 0;
  const canSubmit = !loading && reviewStatus !== 'running' && !preparingImage && !pendingApply.current && (!!prompt.trim() || !!chartImage);

  useEffect(() => {
    reviewRef.current = review;
  }, [review]);

  useEffect(() => {
    if (pendingApply.current) {
      const pending = pendingApply.current;
      let matches = false;
      try { matches = JSON.stringify(snapshotStrategy(strategy)) === pending.snapshot; } catch { /* Invalid workspaces cannot confirm an apply. */ }
      if (matches) {
        setApplied(pending.id);
        setApplyStatus('Draft applied to the workspace. The assumptions are in the builder; no backtest or broker order was executed.');
      } else {
        setApplyStatus('Workspace changed, but applying this draft was not confirmed.');
      }
      pendingApply.current = null;
    }
    revision.current++;
    generation.current++;
    clipboardGeneration.current++;
    runGeneration.current++;
    if (reviewRef.current) {
      reviewRef.current = null;
      setReview(null);
      setReviewStatus('idle');
      setReviewError('');
      append('assistant', 'The workspace changed, so the previous backtest review was set aside. Prepare a fresh review. Nothing was run.');
    }
    setValidatedResult(null);
    setChartReading(null);
    setAwaitingChartConfirm(false);
    abort.current?.abort();
    setLoading(false);
    scanPendingRef.current = false;
    setScanPending(false);
    setScanWaiting(false);
    setScanProgress(null);
    setScanError('');
    if (!pendingApply.current) setProposal(null);
    setClipboardStatus('');
    setSaveStatus('');
  }, [snapshot]);

  // A reload during a scan used to leave a promise and nothing to act on.
  useEffect(() => {
    let stored: { plan?: ResearchScreenPlan; startedAt?: number } | null = null;
    try { stored = JSON.parse(localStorage.getItem(PENDING_SCAN_KEY) ?? 'null'); } catch { stored = null; }
    const plan = stored?.plan;
    if (!plan || typeof plan !== 'object' || !plan.strategy) return;
    setScreenPlan(plan);
    setAwaitingChartConfirm(false);
    setScanPending(false);
    setScanResult(null);
    setScanError('The page reloaded while the scan was running. Run the scan again.');
  }, []);

  useEffect(() => () => {
    generation.current++;
    clipboardGeneration.current++;
    runGeneration.current++;
    imageGeneration.current++;
    pendingApply.current = null;
    abort.current?.abort();
  }, []);

  // One-time cleanup of the first-version browser transcript. It is never
  // read again: a fresh load with no engine session starts empty.
  useEffect(() => {
    try { for (const key of LEGACY_HISTORY_KEYS) localStorage.removeItem(key); } catch { /* storage may be unavailable */ }
  }, []);

  // X-3: "Describe in chat" hands over a validated ChatDraft. Fill the composer
  // and focus it; never send automatically.
  useEffect(() => {
    const receive = (event: Event) => {
      const prefill = parseFeaturePrefill((event as CustomEvent).detail);
      if (!prefill || prefill.feature !== 'chat_draft') return;
      setPrompt(prefill.prompt);
      setTimeout(() => promptRef.current?.focus(), 0);
    };
    window.addEventListener(FEATURE_PREFILL_EVENT, receive);
    return () => window.removeEventListener(FEATURE_PREFILL_EVENT, receive);
  }, []);

  useEffect(() => {
    if ((newConversationSignal ?? 0) !== seenNewChat.current) {
      seenNewChat.current = newConversationSignal ?? 0;
      clearConversation();
    }
    // clearConversation intentionally reads the latest state through function scope.
  }, [newConversationSignal]);

  /**
   * Scroll helpers. The reader owns the viewport: new content only moves it
   * while they are already at the bottom (within 48px); otherwise the "Jump to
   * latest" button appears. A card taller than the log opens at its start so its
   * header is never clipped.
   */
  const NEAR_BOTTOM = 48;
  /** The newest content this far below the fold earns a "Jump to latest" pill. */
  const JUMP_AFTER = 240;

  const scrollToLatest = (behavior: ScrollBehavior = 'smooth') => {
    const log = logRef.current;
    if (!log) return;
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (typeof log.scrollTo === 'function') log.scrollTo({ top: log.scrollHeight, behavior: reduce ? 'auto' : behavior });
    else log.scrollTop = log.scrollHeight;
    pinnedRef.current = true;
    setPinned(true);
    setJumpVisible(false);
  };

  /**
   * Bring a card into view. Content that arrives on its own only follows a
   * reader who is already at the bottom; content the user asked for (Send,
   * "Scan with these", "Use these assumptions and run") always does.
   */
  const revealCard = (card: Element | null, force = false) => {
    const log = logRef.current;
    if (!log || !(card instanceof HTMLElement)) return;
    if (!pinnedRef.current && !force) return;
    const logBox = log.getBoundingClientRect();
    const box = card.getBoundingClientRect();
    if (box.height > log.clientHeight - 16) {
      log.scrollTop += box.top - logBox.top - 8;
      pinnedRef.current = false;
      setPinned(false);
      return;
    }
    scrollToLatest('auto');
  };

  /**
   * Bring a message into view. Its start goes near the top of the log so a
   * long answer is read from the beginning, whatever sits below it (cards
   * render after the message list, so the log's end is not the answer's end).
   */
  const revealMessage = (element: HTMLElement, log: HTMLDivElement) => {
    const logBox = log.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    if (box.top >= logBox.top && box.bottom <= logBox.bottom) return;
    log.scrollTop += box.top - logBox.top - 12;
  };

  /** The next card is one the user asked for: its start must come into view. */
  const requestReveal = (reason: 'send' | 'scan' | 'run') => {
    revealIntent.current = reason;
  };

  /** A wheel, touch or key scroll means the reader is steering; stop following. */
  const onLogIntent = () => { followAnswer.current = false; };

  const onLogScroll = () => {
    const log = logRef.current;
    if (!log) return;
    const away = log.scrollHeight - log.scrollTop - log.clientHeight;
    const next = away <= NEAR_BOTTOM;
    if (next !== pinnedRef.current) {
      pinnedRef.current = next;
      setPinned(next);
    }
    // A few lines below the fold are not worth a button; a quarter screen is:
    // the newest card is then out of view and would have to be hunted for.
    const show = away > Math.max(120, Math.min(JUMP_AFTER, log.clientHeight * 0.6));
    setJumpVisible(current => (current === show ? current : show));
  };

  // After a send the prompt sits at the top of the log with room for the answer;
  // a reply only follows the reader when they are already at the bottom.
  useEffect(() => {
    const last = messages[messages.length - 1];
    const element = lastMessageRef.current;
    const log = logRef.current;
    if (!last || !element || !log) return;
    if (last.sender === 'user') {
      log.scrollTop += element.getBoundingClientRect().top - log.getBoundingClientRect().top - 12;
      pinnedRef.current = true;
      setPinned(true);
      return;
    }
    // The answer to a question the reader just asked is always followed, even
    // when placing that question left the log short of the bottom. Cards render
    // after the message list, so scroll the answer itself into view, not the end.
    if (followAnswer.current || pinnedRef.current) {
      revealMessage(element, log);
      return;
    }
    // Reading higher up: offer the jump only when the new answer is out of view.
    if (element.getBoundingClientRect().bottom > log.getBoundingClientRect().bottom + 8) setJumpVisible(true);
  }, [messages]);

  // Reveal the newest card once per state change. A user-triggered card is
  // revealed even when the reader has scrolled away, pending state first and
  // again when its result replaces the pending state.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const cards = logRef.current?.querySelectorAll('article[aria-label="Research screen"], article[aria-label="Chart reading"], article[aria-label="Backtest review"], article[aria-label="Backtest result"], article[aria-label="Draft proposal"]');
      const card = cards && cards.length ? cards[cards.length - 1] : null;
      if (!card) return;
      const busyNow = card.getAttribute('aria-busy') === 'true';
      const sameCard = card === revealedCard.current;
      const wasBusy = revealedBusy.current;
      // Pending -> ready is new content; ready -> busy (a run starting) is not.
      const changed = !sameCard || (wasBusy && !busyNow);
      if (!changed) return;
      const forced = !!revealIntent.current;
      if (!forced && !pinnedRef.current) {
        if (card.getBoundingClientRect().top > (logRef.current?.getBoundingClientRect().bottom ?? 0) + 8) setJumpVisible(true);
        return;
      }
      revealedCard.current = card;
      revealedBusy.current = busyNow;
      revealCard(card, forced);
      if (!busyNow) revealIntent.current = null;
    }, 80);
    return () => window.clearTimeout(timer);
  }, [messages, scanResult, review, validatedResult, chartReading, proposal, scanPending, awaitingChartConfirm, screenPlan, reviewStatus]);

  // Hold the placeholder back briefly: a cached answer must not flash a skeleton.
  useEffect(() => {
    if (!loading) {
      setShowPending(false);
      return;
    }
    const timer = window.setTimeout(() => setShowPending(true), 300);
    return () => window.clearTimeout(timer);
  }, [loading]);

  // The composer grows with the prompt up to five rows (P2-1) and never moves the log.
  useEffect(() => {
    const element = promptRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = Math.min(Math.max(element.scrollHeight || 0, 44), 136) + 'px';
  }, [prompt]);

  const append = (sender: ChatMessage['sender'], text: string, extras: MessageExtras = {}): string => {
    const id = Date.now() + '-' + (messageSeq.current++);
    setMessages(old => [...old, {
      id,
      sender,
      text,
      timestamp: Date.now(),
      ...extras,
    }].slice(-40));
    return id;
  };

  /**
   * Append a message whose id the server chose. A message id is the dedupe key
   * across reconnect and restore; an id seen before is never rendered twice.
   */
  const appendWithId = (id: string, sender: ChatMessage['sender'], text: string, extras: MessageExtras = {}, limit = 40): string => {
    setMessages(old => old.some(message => message.id === id)
      ? old
      : [...old, { id, sender, text, timestamp: Date.now(), ...extras }].slice(-limit));
    return id;
  };

  /** The engine turn's tool timeline lives in one place and is updated in order. */
  const updateActivity = (update: (current: LiveActivity) => LiveActivity) => {
    const next = update(liveActivityRef.current);
    liveActivityRef.current = next;
    setLiveActivity(next);
  };

  const resetActivity = (running = false) => {
    previousActivityAnchor.current = null;
    updateActivity(() => ({ ...EMPTY_ACTIVITY(), running }));
  };

  const addActivityEntries = (entries: AgentToolEntry[]) => {
    if (!entries.length) return;
    updateActivity(current => {
      let next = current.entries;
      for (const entry of entries) next = upsertToolEntry(next, entry);
      const active = [...next].reverse().find(entry => entry.status === 'running' || entry.status === 'called');
      return {
        ...current,
        entries: next,
        running: current.running || active !== undefined,
        ...(active ? { currentStep: active.summary ?? toolLabel(active.name) } : {}),
      };
    });
  };

  const addTodos = (todos: AgentTodoItem[]) => {
    if (!todos.length) return;
    updateActivity(current => ({ ...current, todos }));
  };

  /**
   * A live engine event. Messages are deduped by id, the cursor by the engine
   * client; status/idle events own the pending state, tool messages feed the
   * same cards the legacy path uses.
   */
  const handleEngineEvent = (event: EngineEvent) => {
    if (event.type === 'status') {
      const working = /working|running|busy|retrying/i.test(event.status ?? '');
      setLoading(working);
      if (working) setTurnExpired(false);
      updateActivity(current => ({ ...current, running: working }));
      return;
    }
    if (event.type === 'idle') {
      setLoading(false);
      setTurnLong(false);
      setTurnExpired(false);
      updateActivity(current => ({ ...current, running: false, currentStep: undefined }));
      void refreshSessionMeta();
      return;
    }
    if (event.type === 'error') {
      setLoading(false);
      setTurnLong(false);
      setTurnExpired(false);
      updateActivity(current => ({ ...current, running: false, currentStep: undefined }));
      if (event.error) append('assistant', event.error, { tone: 'error', methodLabel: 'Engine error' });
      return;
    }
    if (event.type === 'tool' || event.type === 'todo') {
      const activities = event.activities?.length ? event.activities : event.activity ? [event.activity] : [];
      if (activities.length) addActivityEntries(activities.map(activityEntry));
      if (event.todos?.length) addTodos(event.todos);
      // A tool event may also carry the durable tool message itself.
      if (event.message && !engineSeenIds.current.has(event.message.id)) {
        engineSeenIds.current.add(event.message.id);
        if (event.message.role === 'tool') applyEngineTool(event.message);
        else if (event.message.role === 'assistant') applyEngineAssistant(event.message);
        else appendWithId(event.message.id, 'user', event.message.text ?? '');
      }
      return;
    }
    const streamedActivities = event.activities?.length ? event.activities : event.activity ? [event.activity] : [];
    if (streamedActivities.length) addActivityEntries(streamedActivities.map(activityEntry));
    if (event.todos?.length) addTodos(event.todos);
    if (event.job?.status === 'interrupted' && event.job.id) {
      setInterruptedJob({ jobId: event.job.id });
      setLoading(false);
      updateActivity(current => ({ ...current, running: false, currentStep: undefined }));
      return;
    }
    const message = event.message;
    if (!message) return;
    if (engineSeenIds.current.has(message.id)) return;
    engineSeenIds.current.add(message.id);
    if (message.role === 'user') {
      const expected = pendingUserText.current;
      const echoed = (message.text ?? '').trim();
      // An image turn is echoed with the hint text (or none); it is the same turn.
      const matches = !!expected && (echoed === expected.trim() || expected === '[chart image attached]');
      if (matches) {
        // The server's durable user message replaces the optimistic turn in place.
        pendingUserText.current = null;
        const localId = pendingUserMessageId.current;
        pendingUserMessageId.current = null;
        if (localId) setMessages(old => old.map(item => item.id === localId ? { ...item, id: message.id } : item));
      } else {
        appendWithId(message.id, 'user', message.text ?? '[chart image attached]');
      }
      return;
    }
    if (message.role === 'tool') { applyEngineTool(message); return; }
    applyEngineAssistant(message);
  };
  const engineEventRef = useRef(handleEngineEvent);
  engineEventRef.current = handleEngineEvent;

  /** One assistant turn: text plus, when present, the adapter payload's card. */
  const applyEngineAssistant = (message: EngineMessage) => {
    const explicitActivities = normalizeToolActivities(message.activity);
    if (explicitActivities.length) addActivityEntries(explicitActivities.map(activityEntry));
    const explicitTodos = normalizeEngineTodos(message.todos);
    if (explicitTodos.length) addTodos(explicitTodos);
    const parsed = parseEnginePayload(message.payload);
    const deterministic = parsed?.method === 'unavailable'
      && parsed.warnings.some(warning => warning.startsWith('Deterministic answer'));
    const providerFailure = parsed && parsed.method === 'unavailable' && !deterministic
      ? providerFailureFor(parsed.message)
      : null;
    const text = providerFailure?.text
      ?? ((message.text ?? '').trim() || parsed?.message || '');
    if (!text && !parsed) return;
    const warnings = [...(parsed?.warnings ?? []), ...(providerFailure ? [providerFailure.detail] : [])];
    const id = appendWithId(message.id, 'assistant', text, {
      ...(parsed ? { methodLabel: providerFailure ? 'AI unavailable' : methodLabel(parsed.method, parsed.provider) } : { methodLabel: 'AI engine' }),
      ...(parsed?.provider.aiGenerated ? { methodTitle: 'Answered by ' + parsed.provider.name + '. Verify factual claims with data.' } : {}),
      ...(warnings.length ? { warnings } : {}),
      ...(parsed?.method === 'unavailable' && !providerFailure ? { tone: 'error' as const } : {}),
    }, 80);
    setLoading(false);
    setTurnLong(false);
    setTurnExpired(false);
    // The latest answer of this turn carries the timeline. A later step's tool
    // event reopens it; the finished answer keeps the same turn's entries.
    updateActivity(current => ({ ...current, anchorId: id, running: false, currentStep: undefined }));
    if (parsed) applyEnginePayload(id, parsed);
  };

  /**
   * The engine carries the same payload shapes as the legacy chat. Screen plans
   * own the existing ScreenResultCard; scan results arrive as a scan_market tool
   * message and fill that card; drafts reuse the proposal card.
   */
  const applyEnginePayload = (messageId: string, parsed: ResearchChatResponse) => {
    if (parsed.kind === 'proposal') {
      try {
        const proposal = parseStrategyProposal(parsed.proposal);
        assertProposalCurrent(parsed, revision.current, JSON.stringify(strategy), JSON.stringify(strategy));
        archiveCompletedCard();
        // The draft card states the provider once; the message label is redundant.
        setCardMessageId(messageId);
        setWorkingAnchorId(messageId);
        setProposal({ ...proposal, sourceSnapshot: JSON.stringify(strategy), validatedCandidate: proposal.candidate });
        setScreenPlan(null);
        setScanResult(null);
        setScanError('');
        setChartReading(null);
        scanPendingRef.current = false;
        setScanPending(false);
        setReview(null);
        setReviewStatus('idle');
        setAwaitingSymbolFor(null);
        setLastContext('draft');
        setApplied(null);
      } catch (error) {
        append('assistant', 'The engine draft could not be validated: ' + (error as Error).message + ' Nothing is shown as a proposal.', { tone: 'error' });
      }
      return;
    }
    if (parsed.kind === 'screen') {
      archiveCompletedCard();
      setCardMessageId(null);
      setWorkingAnchorId(messageId);
      setScreenPlan(parsed);
      setChartReading(chartReadingFromScreen(parsed));
      setAwaitingChartConfirm(false);
      // The engine plans a screen and then runs scan_market; the card shows
      // the pending scan until that tool result (or error) arrives. If the tool
      // result already arrived in this turn, show it immediately (no spinner).
      const resultAlreadyHere = turnScanResult.current !== null;
      scanPendingRef.current = !resultAlreadyHere;
      setScanPending(!resultAlreadyHere);
      setScanWaiting(false);
      setScanProgress(null);
      setApplied(null);
      setProposal(null);
      setReview(null);
      setReviewStatus('idle');
      setAwaitingSymbolFor(null);
      setLastContext('screen');
      // The adapter attaches the screen plan to the final assistant message,
      // after the tool events. Keep a scan result that arrived earlier in this
      // same turn instead of wiping the card the user just waited for.
      setScanResult(turnScanResult.current);
      setScanError('');
    }
  };

  /** A tool result keeps its card: scan rows, a backtest result, or a gate. */
  const applyEngineTool = (message: EngineMessage) => {
    setLoading(false);
    const explicitActivities = normalizeToolActivities(message.activity);
    if (explicitActivities.length) {
      addActivityEntries(explicitActivities.map(activityEntry));
    } else {
      const entry = activityFromToolMessage(message);
      if (entry) addActivityEntries([entry]);
    }
    const explicitTodos = normalizeEngineTodos(message.todos);
    if (explicitTodos.length) addTodos(explicitTodos);
    else {
      const toolTodos = todosFromToolMessage(message);
      if (toolTodos.length) addTodos(toolTodos);
    }
    if (message.job?.status === 'interrupted' && message.job.id) setInterruptedJob({ jobId: message.job.id });
    if (message.approval && (message.approval.status === undefined || message.approval.status === 'pending')) {
      setEngineApproval({
        messageId: message.id,
        approvalId: message.approval.id,
        title: message.approval.title ?? 'Approve this research step?',
        summary: message.approval.summary ?? [],
      });
    }
    const tool = (message.tool ?? '').toLowerCase();
    if (message.error && /scan|market|screen/.test(tool)) {
      scanPendingRef.current = false;
      setScanPending(false);
      setScanWaiting(false);
      setScanProgress(null);
      if (message.error.code === 'CLIENT_DEADLINE' && message.error.jobId) {
        setScanError('');
        setStalledScan(message.error.jobId);
      } else {
        setScanError(scanFailureLine({ code: message.error.code, message: message.error.message }));
      }
      setLoading(false);
    }
    let consumed = false;
    if (message.result !== undefined) {
      if (/scan|market|screen/.test(tool) || !/backtest|run/.test(tool)) {
        try {
          const result = parseScanResult(message.result);
          if (result.mode !== 'real') {
            setScanResult(null);
            setScanError(result.mode === 'demo'
              ? 'Real current data is unavailable right now. Nothing was presented as a match.'
              : "The scan didn't confirm real observed data. Nothing was presented as a match.");
            setScanPending(false);
            setScanWaiting(false);
            scanPendingRef.current = false;
            setLoading(false);
            consumed = true;
          } else {
          turnScanResult.current = result;
          setScanResult(result);
          setScanError('');
          setScanPending(false);
          setScanWaiting(false);
          setScanProgress(null);
          scanPendingRef.current = false;
          rememberPendingScan(null);
          consumed = true;
          }
        } catch { /* not a scan result */ }
      }
      if (!consumed) {
        try {
          const result = parseBacktestResult(message.result);
          setValidatedResult(result);
          setReview(null);
          setReviewStatus('complete');
          setResultAnchorId(message.id);
          consumed = true;
        } catch { /* not a backtest result */ }
      }
    }
    if (!consumed && message.text) {
      appendWithId(message.id, 'assistant', message.text, { methodLabel: 'Engine tool · ' + (message.tool ?? 'result') }, 80);
    }
  };

  /**
   * Restore a stored engine session into the existing chat: user/assistant
   * turns become messages, screen and backtest tool results become read-only
   * cards under the message that produced them. The newest assistant answer is
   * marked as already spoken, so a reload never reads old answers aloud.
   */
  const applyRestoredMessages = (engineMessages: EngineMessage[]) => {
    const mapped: ChatMessage[] = [];
    const cards: RestoredCard[] = [];
    let lastScreen: RestoredCard | null = null;
    let lastAssistantTurn: ChatMessage | null = null;
    // Tool results are listed before the assistant message that carries the
    // screen payload, so hold the newest scan until its card is created.
    let pendingScanResult: ScanResult | null = null;
    for (const message of engineMessages) {
      if (engineSeenIds.current.has(message.id)) continue;
      engineSeenIds.current.add(message.id);
      const timestamp = message.timestamp ?? Date.now();
      if (message.role === 'user') {
        mapped.push({ id: message.id, sender: 'user', text: message.text ?? '[chart image attached]', timestamp });
        lastAssistantTurn = null;
        lastScreen = null;
        pendingScanResult = null;
        continue;
      }
      if (message.role === 'tool') {
        if (message.job?.status === 'interrupted' && message.job.id) setInterruptedJob({ jobId: message.job.id });
        if (message.approval && (message.approval.status === undefined || message.approval.status === 'pending')) {
          setEngineApproval({
            messageId: message.id,
            approvalId: message.approval.id,
            title: message.approval.title ?? 'Approve this research step?',
            summary: message.approval.summary ?? [],
          });
        }
        // Tool activity without a dedicated assistant activity array is attached
        // to the assistant turn that requested the tool.
        if (lastAssistantTurn) {
          const explicit = normalizeToolActivities(message.activity);
          const entry = !explicit.length ? activityFromToolMessage(message) : null;
          const activities = explicit.map(activityEntry);
          if (entry) activities.push(entry);
          if (activities.length) {
            let merged = lastAssistantTurn.activity ?? [];
            for (const item of activities) merged = upsertToolEntry(merged, item);
            lastAssistantTurn.activity = merged;
          }
          const todoItems = normalizeEngineTodos(message.todos ?? todosFromToolMessage(message));
          if (todoItems.length) lastAssistantTurn.todos = todoItems;
        }
        if (message.result !== undefined) {
          const tool = (message.tool ?? '').toLowerCase();
          let handled = false;
          if (/scan|market|screen/.test(tool)) {
            try {
              const parsedScan = parseScanResult(message.result);
              if (lastScreen) lastScreen.scanResult = parsedScan;
              else pendingScanResult = parsedScan;
              handled = true;
            } catch { handled = false; }
          }
          if (!handled) {
            try {
              const result = parseBacktestResult(message.result);
              cards.push({ id: 'restored-result-' + message.id, messageId: message.id, result });
              handled = true;
            } catch { /* not a backtest result */ }
          }
          if (!handled && message.text) mapped.push({ id: message.id, sender: 'assistant', text: message.text, timestamp, methodLabel: 'Engine tool · ' + (message.tool ?? 'result') });
        }
        continue;
      }
      const parsed = parseEnginePayload(message.payload);
      const text = (message.text ?? '').trim() || parsed?.message || '';
      const restoredActivity = normalizeToolActivities(message.activity).map(activityEntry);
      const restoredTodos = normalizeEngineTodos(message.todos);
      if (text || parsed) {
        const mappedMessage: ChatMessage = {
          id: message.id,
          sender: 'assistant',
          text,
          timestamp,
          ...(parsed ? { methodLabel: methodLabel(parsed.method, parsed.provider) } : { methodLabel: 'AI engine' }),
          ...(parsed?.warnings?.length ? { warnings: parsed.warnings } : {}),
          ...(restoredActivity.length ? { activity: restoredActivity } : {}),
          ...(restoredTodos.length ? { todos: restoredTodos } : {}),
        };
        mapped.push(mappedMessage);
        lastAssistantTurn = mappedMessage;
      }
      if (parsed?.kind === 'screen') {
        const card: RestoredCard = {
          id: 'restored-screen-' + message.id,
          messageId: message.id,
          plan: parsed,
          chartReading: chartReadingFromScreen(parsed),
          scanResult: pendingScanResult,
        };
        pendingScanResult = null;
        cards.push(card);
        lastScreen = card;
      } else if (parsed?.kind === 'proposal') {
        try {
          const proposal = parseStrategyProposal(parsed.proposal);
          cards.push({
            id: 'restored-proposal-' + message.id,
            messageId: message.id,
            proposal: {
              name: proposal.candidate.name,
              provider: parsed.provider.aiGenerated ? 'AI · ' + parsed.provider.name : 'Local rules · not AI',
              changes: proposal.changes,
              warnings: proposal.warnings,
            },
          });
        } catch { /* the answer text is still shown */ }
      }
    }
    if (pendingScanResult) {
      const anchor = [...mapped].reverse().find(message => message.sender === 'assistant') ?? mapped[mapped.length - 1];
      cards.push({
        id: 'restored-scan-' + (anchor?.id ?? 'only'),
        messageId: anchor?.id ?? '',
        scanResult: pendingScanResult,
      });
      pendingScanResult = null;
    }
    setMessages(mapped.slice(-80));
    setRestoredCards(cards.slice(-20));
    const lastAssistant = [...mapped].reverse().find(message => message.sender === 'assistant');
    spokenMessageId.current = lastAssistant?.id ?? null;
    setLoading(false);
  };

  /** Subscribe with the persisted cursor; the client owns reconnect/dedupe. */
  const connectEngine = (sessionId: string, afterSeq: number) => {
    engineSubscription.current?.close();
    engineSeqRef.current = Math.max(engineSeqRef.current, afterSeq);
    setEngineLink('connecting');
    engineSubscription.current = subscribeEngineEvents(sessionId, engineSeqRef.current, {
      onEvent: event => engineEventRef.current(event),
      onState: state => setEngineLink(state === 'open' ? 'live' : state === 'reconnecting' ? 'reconnecting' : 'connecting'),
      onCursor: seq => { engineSeqRef.current = seq; rememberEngineCursor(sessionId, seq); },
    });
  };

  /** Load the model list once; only models the server reports are shown. */
  const loadModels = async () => {
    setModelsLoading(true);
    try {
      const result = await listEngineModels();
      setModels(result.models);
      setModelsError('');
      setSelectedModel(current => {
        if (current && result.models.some(model => model.providerID === current.providerID && model.id === current.id)) return current;
        const preferred = result.models.find(model => model.default)
          ?? (result.default ? result.models.find(model => model.providerID === result.default!.providerID && model.id === result.default!.model) : undefined)
          ?? result.models[0];
        return preferred ? { providerID: preferred.providerID, id: preferred.id } : null;
      });
    } catch (error) {
      setModels([]);
      const status = (error as { status?: number }).status;
      setModelsError(isEngineUnavailable(error)
        ? 'Models are not available on this server yet' + (status ? ' (' + status + ')' : '') + '.'
        : 'Models could not be loaded. ' + (error instanceof Error ? error.message : 'Try again.'));
    } finally {
      setModelsLoading(false);
    }
  };

  useEffect(() => { void loadModels(); }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia('(max-width: 767px)');
    const update = () => setIsMobile(query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);

  /** Re-read the active session's title/model/cost once a turn settles. */
  const refreshSessionMeta = async () => {
    const sessionId = engineSessionRef.current;
    if (!sessionId) return;
    const [usageResult, sessionsResult] = await Promise.allSettled([getEngineUsage(), listEngineSessions()]);
    if (usageResult.status === 'fulfilled') {
      setEngineUsage(usageResult.value);
      const match = usageResult.value.sessions.find(item => item.sessionId === sessionId);
      if (match) {
        setActiveSession(current => ({
          ...(current ?? { sessionId }),
          sessionId,
          ...(match.title ? { title: match.title } : {}),
          ...(match.cost !== undefined ? { cost: match.cost } : {}),
          ...(match.tokens ? { tokens: match.tokens } : {}),
        }));
      }
    }
    if (sessionsResult.status === 'fulfilled') {
      setSessionList(sessionsResult.value);
      const match = sessionsResult.value.find(item => item.sessionId === sessionId);
      if (match) {
        setActiveSession(current => ({ ...(current ?? { sessionId }), ...match }));
        if (match.model?.providerID && match.model.id) {
          setSelectedModel({ providerID: match.model.providerID, id: match.model.id });
        }
      }
    }
  };

  /** History list, server-filtered; a stale response can never replace a new one. */
  const refreshHistory = async (query: string) => {
    const request = ++historyRequest.current;
    setSessionListLoading(true);
    try {
      const sessions = await listEngineSessions(query.trim() || undefined);
      if (historyRequest.current !== request) return;
      setSessionList(sessions);
      setSessionListError('');
      setSessionListStatus(sessions.length || query.trim() ? '' : 'No earlier conversations yet.');
    } catch (error) {
      if (historyRequest.current !== request) return;
      setSessionList([]);
      setSessionListError(isEngineUnavailable(error)
        ? 'Saved conversations are not available on this server yet.'
        : 'Conversations could not be loaded. ' + (error instanceof Error ? error.message : 'Try again.'));
    } finally {
      if (historyRequest.current === request) setSessionListLoading(false);
    }
  };

  // Opening history loads it; typing searches the server after 250 ms. Changing
  // the query never switches or reloads the active chat.
  useEffect(() => {
    if (!historyOpen) return;
    void refreshHistory(historyQueryDebounced);
  }, [historyOpen, historyQueryDebounced]);

  const adoptSession = (sessionId: string) => {
    engineSessionRef.current = sessionId;
    setEngineSessionId(sessionId);
    setEngineStatus('ready');
    setActiveSession(current => current?.sessionId === sessionId ? current : { sessionId });
    writeSessionUrl(sessionId);
  };

  // On load the address bar wins over browser storage, so a shared link opens
  // the same durable chat. If the linked chat is gone, the last local chat is
  // tried once and the note says what happened.
  useEffect(() => {
    let cancelled = false;
    const linked = sessionFromUrl();
    const stored = readStoredEngineSession();
    const restore = async (sessionId: string, lastSeq: number): Promise<boolean> => {
      const page = await getEngineMessages(sessionId);
      if (cancelled) return true;
      adoptSession(sessionId);
      engineSeqRef.current = Math.max(lastSeq, page.lastSeq);
      if (page.messages.length) applyRestoredMessages(page.messages);
      writeStoredEngineSession({ sessionId, lastSeq: engineSeqRef.current });
      connectEngine(sessionId, engineSeqRef.current);
      void refreshSessionMeta();
      return true;
    };
    const target = linked ?? stored?.sessionId ?? null;
    if (!target) return;
    void (async () => {
      try {
        await restore(target, linked ? 0 : stored?.lastSeq ?? 0);
      } catch (error) {
        if (cancelled) return;
        if (linked && stored && stored.sessionId !== linked) {
          try {
            await restore(stored.sessionId, stored.lastSeq);
            setEngineNote('That shared chat is no longer on the server. The last chat on this browser was opened instead.');
            return;
          } catch { /* fall through to the honest note */ }
        }
        setEngineNote(isEngineUnavailable(error)
          ? 'Engine sessions are not available on this server yet. Nothing was hidden; retry when the server is updated.'
          : 'The saved chat could not be loaded. ' + (error instanceof Error ? error.message : 'Try again.'));
      }
    })();
    return () => {
      cancelled = true;
      engineSubscription.current?.close();
      engineSubscription.current = null;
    };
    // Mount-only: the subscription owns all later state.
  }, []);

  /**
   * Send this turn through the engine. The engine is the only chat path: a
   * failure appends a typed, retryable error card and never calls another
   * route. Returns true when the engine accepted the turn.
   */
  const sendThroughEngine = async (text: string, image: ChartImageAttachment | null): Promise<boolean> => {
    const owned = ++engineGeneration.current;
    lastEngineTurn.current = { text, image };
    try {
      let sessionId = engineSessionRef.current;
      if (!sessionId) {
        const chosen = selectedModel ?? (() => {
          const fallback = models.find(model => model.default) ?? models[0];
          return fallback ? { providerID: fallback.providerID, id: fallback.id } : null;
        })();
        sessionId = await createEngineSession(
          undefined,
          chosen ? { providerID: chosen.providerID, model: chosen.id } : undefined,
        );
        if (engineGeneration.current !== owned) return true;
        adoptSession(sessionId);
        engineSeqRef.current = 0;
        writeStoredEngineSession({ sessionId, lastSeq: 0 });
        connectEngine(sessionId, 0);
      }
      setEngineStatus('ready');
      setEngineNote('');
      setTurnLong(false);
      setTurnExpired(false);
      resetActivity(true);
      // Keep the previous turn's finished card before this turn replaces it.
      archiveCompletedCard();
      turnScanResult.current = null;
      setScanResult(null);
      setScanError('');
      setLoading(true);
      await postEngineMessage(sessionId, {
        ...(text ? { text } : {}),
        ...(image ? { image: { dataUrl: image.dataUrl, mimeType: image.mimeType, name: image.name }, hint: text } : {}),
        currentStrategy: snapshotStrategy(strategy),
        ...(screenPlan ? { screenContext: { strategy: screenPlan.strategy, universe: screenPlan.universe } } : {}),
        ...(messages.length ? { history: messages.slice(-20).map(message => ({ role: message.sender, text: message.text })) } : {}),
      });
      return true;
    } catch (error) {
      if (engineGeneration.current !== owned) return true;
      setLoading(false);
      setTurnLong(false);
      setTurnExpired(false);
      const code = (error as { code?: string }).code ?? 'ENGINE_UNREACHABLE';
      const status = (error as { status?: number }).status ?? 0;
      const message = error instanceof Error ? error.message : 'The engine did not answer this turn.';
      setEngineNote('The engine did not answer. Nothing was sent; the conversation is kept.');
      append('assistant', message, {
        tone: 'error',
        errorCode: code,
        ...(status ? { errorStatus: status } : {}),
        errorRetryable: true,
        retryPrompt: text,
      });
      pendingUserText.current = null;
      pendingUserMessageId.current = null;
      return false;
    }
  };

  /** Retry the same turn after a typed engine failure; no duplicate user turn. */
  const retryEngineTurn = async (failed: ChatMessage) => {
    if (loading) return;
    const turn = lastEngineTurn.current;
    const text = failed.retryPrompt ?? turn.text;
    const image = turn.text === text ? turn.image : null;
    if (!text && !image) return;
    const lastUser = [...messages].reverse().find(message => message.sender === 'user');
    pendingUserText.current = image ? '[chart image attached]' : text.trim();
    pendingUserMessageId.current = lastUser?.id ?? null;
    setRetryingEngine(true);
    const accepted = await sendThroughEngine(text, image);
    setRetryingEngine(false);
    if (accepted) setMessages(current => current.filter(message => message.id !== failed.id));
  };

  /** The activity Stop button interrupts the engine turn that owns the timeline. */
  const stopEngineTurn = () => {
    const sessionId = engineSessionRef.current;
    updateActivity(current => ({ ...current, running: false, currentStep: undefined }));
    setLoading(false);
    setTurnLong(false);
    setTurnExpired(false);
    if (sessionId) void interruptEngineSession(sessionId).catch(() => {});
    setEngineNote('Stop requested. The engine was asked to interrupt this turn.');
  };

  /** The engine approval gate: approve, then send the confirm message. */
  const decideEngineApproval = async (decision: 'approve' | 'reject') => {
    const approval = engineApproval;
    const sessionId = engineSessionRef.current;
    if (!approval || !sessionId) return;
    setEngineApproval(null);
    setLoading(true);
    try {
      await postEngineApproval({ sessionId, approvalId: approval.approvalId, decision });
      await postEngineMessage(sessionId, { text: decision === 'approve' ? 'Use these assumptions and run' : 'Cancel this step — do not run it.' });
      setEngineNote(decision === 'approve' ? 'Approval sent. The engine owns the run; nothing else changed.' : 'Cancellation sent. Nothing was run.');
    } catch (error) {
      setLoading(false);
      setError(error instanceof Error ? error.message : 'The approval could not be sent.');
    }
  };

  /** Resume a scan interrupted by a server restart (Agent A's durable job). */
  const resumeInterrupted = async () => {
    const job = interruptedJob;
    if (!job) return;
    setInterruptedJob(null);
    setLoading(true);
    try {
      const status = await getJobStatus(job.jobId);
      if (status.status === 'succeeded' || status.status === 'failed' || status.status === 'cancelled') {
        setError('That scan is already finished and cannot be resumed. Open its saved result in the session.');
        return;
      }
      await resumeInterruptedJob(job.jobId);
      setEngineNote('Resume requested. The scan continues from its saved bars.');
    } catch (error) {
      const code = (error as { code?: string }).code ?? '';
      setError(code === 'JOB_NOT_FOUND'
        ? 'That scan is no longer on the server. Run the scan again.'
        : 'The scan could not be resumed. ' + (error instanceof Error ? error.message : 'Try again.'));
    } finally {
      setLoading(false);
    }
  };

  /** Switch to a durable chat: load its transcript, then resubscribe. */
  const loadEngineSession = async (sessionId: string) => {
    if (sessionId === engineSessionRef.current) { setHistoryOpen(false); return; }
    setSessionListStatus('');
    setLoading(true);
    try {
      const page = await getEngineMessages(sessionId);
      engineSubscription.current?.close();
      engineGeneration.current++;
      adoptSession(sessionId);
      const summary = sessionList?.find(session => session.sessionId === sessionId);
      if (summary) setActiveSession(summary);
      engineSeqRef.current = page.lastSeq;
      engineSeenIds.current = new Set();
      setEngineApproval(null);
      setInterruptedJob(null);
      resetActivity();
      applyRestoredMessages(page.messages);
      writeStoredEngineSession({ sessionId, lastSeq: page.lastSeq });
      connectEngine(sessionId, page.lastSeq);
      setEngineNote('');
      setHistoryOpen(false);
      void refreshSessionMeta();
    } catch (error) {
      setSessionListError(isEngineUnavailable(error)
        ? 'Saved conversations are not available on this server yet.'
        : 'That conversation could not be loaded. ' + (error instanceof Error ? error.message : 'Try again.'));
    } finally {
      setLoading(false);
    }
  };

  const renameSession = async (sessionId: string, title: string): Promise<boolean> => {
    try {
      const updated = await renameEngineSession(sessionId, title);
      const next = updated ?? { sessionId, title };
      setSessionList(current => current ? current.map(session => session.sessionId === sessionId ? { ...session, ...next } : session) : current);
      setActiveSession(current => current && current.sessionId === sessionId ? { ...current, ...next } : current);
      setSessionListStatus('Chat renamed.');
      return true;
    } catch (error) {
      setSessionListStatus('');
      setSessionListError('The chat could not be renamed. ' + (error instanceof Error ? error.message : 'Try again.'));
      return false;
    }
  };

  const deleteSession = async (sessionId: string): Promise<boolean> => {
    try {
      await deleteEngineSession(sessionId);
      setSessionList(current => current ? current.filter(session => session.sessionId !== sessionId) : current);
      setSessionListStatus('Chat deleted from the server.');
      if (engineSessionRef.current === sessionId) clearConversation();
      return true;
    } catch (error) {
      setSessionListStatus('');
      setSessionListError('The chat could not be deleted. ' + (error instanceof Error ? error.message : 'Try again.'));
      return false;
    }
  };

  const exportSession = async (sessionId: string, format: 'md' | 'json') => {
    setSessionListStatus('Preparing the export…');
    try {
      const file = await exportEngineSession(sessionId, format);
      const saved = downloadTextFile(file.filename, file.content, format === 'json' ? 'application/json' : 'text/markdown');
      setSessionListStatus(saved
        ? 'Exported ' + file.filename + '.'
        : 'The export was prepared but this browser blocked the download. Try again.');
    } catch (error) {
      setSessionListStatus('');
      setSessionListError('The export could not be prepared. ' + (error instanceof Error ? error.message : 'Try again.'));
    }
  };

  /** Model switching: POST the session route, or carry the choice into create. */
  const chooseModel = async (model: EngineModel) => {
    const choice = { providerID: model.providerID, id: model.id };
    setSelectedModel(choice);
    setModelsError('');
    const sessionId = engineSessionRef.current;
    if (!sessionId) return;
    setModelsBusy(true);
    try {
      const updated = await switchEngineModel(sessionId, { providerID: model.providerID, model: model.id });
      setEngineNote('Model changed to ' + model.label + ' for this chat.');
      setActiveSession(current => current ? {
        ...current,
        model: updated?.model ?? { providerID: model.providerID, id: model.id },
      } : { sessionId, model: { providerID: model.providerID, id: model.id } });
    } catch (error) {
      const status = (error as { status?: number }).status;
      setModelsError('The model could not be changed' + (status ? ' (' + status + ')' : '') + '. ' + (error instanceof Error ? error.message : 'Try again.'));
      await loadModels();
    } finally {
      setModelsBusy(false);
    }
  };

  /** Push-to-talk: transcript goes into the textarea for review; never auto-sent. */
  const ensureVoiceInput = (): VoiceInputController => {
    if (voiceController.current) return voiceController.current;
    const controller = createVoiceInput({
      onTranscript: (text, final) => {
        const base = voiceBase.current.trim();
        setPrompt(base ? base + ' ' + text : text);
        if (final) {
          setListening(false);
          voiceBase.current = '';
          window.setTimeout(() => promptRef.current?.focus(), 0);
        }
      },
      onState: state => {
        setListening(state === 'listening');
      },
      onError: message => {
        setListening(false);
        setVoiceNote(message);
      },
    });
    voiceController.current = controller;
    return controller;
  };

  const toggleVoiceInput = async () => {
    setVoiceNote('');
    if (listening) {
      voiceController.current?.stop();
      setListening(false);
      return;
    }
    if (!voiceInputSupported) {
      setVoiceNote('Voice input is not available in this browser. Type your message instead.');
      return;
    }
    cancelSpeech();
    voiceBase.current = prompt;
    const started = await ensureVoiceInput().start();
    setListening(started);
  };

  const toggleVoiceMode = () => {
    const next = !voiceMode;
    setVoiceMode(next);
    writeVoicePreferences({ voiceMode: next });
    if (!next) {
      cancelSpeech();
      const last = messages[messages.length - 1];
      spokenMessageId.current = last?.id ?? null;
    }
  };

  // Speak a completed assistant answer once, only while voice mode is on.
  useEffect(() => {
    if (!voiceMode || !voiceOutputSupported || loading) return;
    const last = messages[messages.length - 1];
    if (!last || last.sender !== 'assistant' || last.tone === 'error') return;
    if (spokenMessageId.current === last.id) return;
    spokenMessageId.current = last.id;
    speak(last.text);
  }, [messages, voiceMode, loading, voiceOutputSupported]);

  useEffect(() => () => {
    voiceController.current?.dispose();
    voiceController.current = null;
    cancelSpeech();
  }, []);

  // Persist the live turn's timeline onto its latest assistant message, and
  // clear the copy from the previous anchor when an intermediate step's message
  // is superseded by the turn's final answer.
  useEffect(() => {
    const anchor = liveActivity.anchorId;
    if (!anchor) {
      previousActivityAnchor.current = null;
      return;
    }
    const previous = previousActivityAnchor.current;
    previousActivityAnchor.current = anchor;
    setMessages(old => {
      let changed = false;
      const next = old.map(message => {
        if (message.id === anchor) {
          if (message.activity === liveActivity.entries && message.todos === liveActivity.todos) return message;
          changed = true;
          return { ...message, activity: liveActivity.entries, todos: liveActivity.todos };
        }
        if (previous && previous !== anchor && message.id === previous && (message.activity || message.todos)) {
          changed = true;
          return { ...message, activity: undefined, todos: undefined };
        }
        return message;
      });
      return changed ? next : old;
    });
  }, [liveActivity]);

  /**
   * Long turns are real: an NSE scan can run for minutes. At 90 s the turn
   * stays alive (cursor + Stop) with a calm note; at 20 min the spinner stops
   * with "still running on the server" and the session/activity are kept.
   * Completion is only ever reported by the engine.
   */
  useEffect(() => {
    if (!loading) return undefined;
    setTurnLong(false);
    setTurnExpired(false);
    const long = window.setTimeout(() => {
      setTurnLong(true);
      setEngineNote('Still working on the server · reconnecting');
    }, 90_000);
    const expire = window.setTimeout(() => {
      setTurnExpired(true);
      setTurnLong(false);
      setLoading(false);
      updateActivity(current => ({ ...current, running: false, currentStep: undefined }));
      setEngineNote('Still running on the server — reload to resync');
    }, 20 * 60_000);
    turnTimers.current = { long, expire };
    return () => {
      window.clearTimeout(long);
      window.clearTimeout(expire);
      turnTimers.current = { long: null, expire: null };
    };
    // updateActivity is stable by closure over a ref; the timer is keyed to the turn.
  }, [loading]);

  useEffect(() => {
    if (!turnLong && !turnExpired) return;
    if (pinnedRef.current) scrollToLatest('auto');
    // The note belongs to the reader only while they are at the bottom.
  }, [turnLong, turnExpired]);

  const copyMessage = async (message: ChatMessage) => {
    try {
      await navigator.clipboard?.writeText(message.text);
      setCopiedMessageId(message.id);
      window.setTimeout(() => setCopiedMessageId(current => current === message.id ? null : current), 1600);
    } catch {
      setCopiedMessageId(null);
    }
  };

  /** The prompt behind an answer: its own retry prompt, else the user turn before it. */
  const promptForMessage = (index: number): string => {
    const direct = messages[index]?.retryPrompt;
    if (direct) return direct;
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const candidate = messages[cursor];
      if (candidate.sender !== 'user') continue;
      return candidate.text === '[chart image attached]' ? '' : candidate.text;
    }
    return '';
  };

  const discardChartImage = () => {
    imageGeneration.current++;
    setChartImage(null);
    setPreparingImage(false);
    setImageError('');
    setDragActive(false);
  };

  const clearConversation = () => {
    rememberPendingScan(null);
    generation.current++;
    runGeneration.current++;
    clipboardGeneration.current++;
    abort.current?.abort();
    onCancelResearch?.();
    discardChartImage();
    setMessages([]);
    setPrompt('');
    setLoading(false);
    scanPendingRef.current = false;
    setScanPending(false);
    setScanResult(null);
    setScanError('');
    setScreenPlan(null);
    setChartReading(null);
    setAwaitingChartConfirm(false);
    setProposal(null);
    setReview(null);
    setReviewStatus('idle');
    setReviewError('');
    setValidatedResult(null);
    setAwaitingSymbolFor(null);
    setLastContext(null);
    setBacktestChoice(null);
    setError('');
    setApplied(null);
    setApplyStatus('');
    setClipboardStatus('');
    setSaveStatus('');
    setSentChartImage(null);
    setPendingDraftBacktest(null);
    setCardMessageId(null);
    setCopiedMessageId(null);
    setPastCards([]);
    setWorkingAnchorId(null);
    setResultAnchorId(null);
    setStalledScan(null);
    setStalledRun(null);
    revealIntent.current = null;
    followAnswer.current = false;
    setJumpVisible(false);
    pendingApply.current = null;
    // A new chat starts a new engine session; the old cursor is not reused.
    engineSubscription.current?.close();
    engineSubscription.current = null;
    engineGeneration.current++;
    engineSessionRef.current = null;
    setEngineSessionId(null);
    engineSeqRef.current = 0;
    engineSeenIds.current = new Set();
    pendingUserText.current = null;
    pendingUserMessageId.current = null;
    clearStoredEngineSession();
    writeSessionUrl(null);
    setActiveSession(null);
    setEngineUsage(null);
    setTurnLong(false);
    setTurnExpired(false);
    setEngineApproval(null);
    setInterruptedJob(null);
    setRestoredCards([]);
    setSessionListStatus('');
    setEngineNote('');
    setHistoryOpen(false);
    resetActivity();
  };

  const cancelPendingRequest = () => {
    rememberPendingScan(null);
    generation.current++;
    abort.current?.abort();
    if (engineSessionRef.current) {
      // The engine owns a running turn; interrupt it rather than pretending it stopped.
      void interruptEngineSession(engineSessionRef.current).catch(() => {});
      setEngineNote('Stop requested. The engine was asked to interrupt this turn.');
    }
    setLoading(false);
    scanPendingRef.current = false;
    setScanPending(false);
    setScanError('Cancelled. No results were confirmed.');
  };

  /**
   * A completed card is the record of the answer that produced it. Before a new
   * request clears or replaces the live card, keep the finished one (last five).
   */
  const archiveCompletedCard = () => {
    if (!screenPlan || (!scanResult && !chartReading)) return;
    const anchor = workingAnchorId ?? cardMessageId;
    const image = chartImage ?? sentChartImage;
    const card: PastCard = {
      id: anchor ?? 'card-' + Date.now(),
      messageId: anchor,
      plan: screenPlan,
      result: scanResult,
      chartReading,
      ...(image ? { imageUrl: image.dataUrl, imageName: image.name } : {}),
    };
    setPastCards(previous => previous.some(item => item.id === card.id) ? previous : [...previous, card].slice(-5));
  };

  const pastBase = (card: PastCard): BaseContext => ({
    strategy: card.plan.strategy,
    asOf: card.result?.observationDates?.latest ?? card.result?.asOf ?? card.plan.asOf,
    sourceLabel: 'Read-only screen “' + card.plan.strategy.name + '” plus your current workspace exits, sizing, execution and costs',
    assumptions: card.plan.assumptions,
  });

  function selectBaseContext(sourceType: 'screen' | 'draft' | 'workspace'): BaseContext | null {
    if (sourceType === 'screen' && screenPlan) {
      return {
        strategy: screenPlan.strategy,
        asOf: scanResult?.observationDates?.latest ?? scanResult?.asOf ?? screenPlan.asOf,
        sourceLabel: 'Read-only screen “' + screenPlan.strategy.name + '” plus your current workspace exits, sizing, execution and costs',
        assumptions: screenPlan.assumptions,
      };
    }
    if (sourceType === 'draft' && proposal) {
      return {
        strategy: proposal.validatedCandidate,
        sourceLabel: 'Reviewed draft “' + proposal.validatedCandidate.name + '”',
        assumptions: [...proposal.changes, ...proposal.warnings],
      };
    }
    if (sourceType === 'workspace') {
      return { strategy, sourceLabel: 'Your workspace strategy “' + strategy.name + '”', assumptions: [] };
    }
    return null;
  }

  const currentBaseType = (): 'screen' | 'draft' | null => {
    if (lastContext === 'screen' && screenPlan) return 'screen';
    if (lastContext === 'draft' && proposal) return 'draft';
    if (screenPlan) return 'screen';
    if (proposal) return 'draft';
    return null;
  };

  /** A new strategy, screen, change or backtest request supersedes an unapproved review. */
  /**
   * Only a review that is still waiting for approval is set aside. A run that
   * finished, failed or is in flight is already its own record; superseding it
   * would claim nothing was run when the result is on screen.
   */
  const supersedeReview = () => {
    // Only a review that has not been run is set aside. A run that failed,
    // completed or was cancelled is the record of what happened; it stays.
    if (!reviewRef.current || reviewStatus !== 'idle' || reviewError) return;
    runGeneration.current++;
    reviewRef.current = null;
    setReview(null);
    setReviewStatus('idle');
    setReviewError('');
    append('assistant', 'I set aside the backtest review that was waiting for approval.');
  };

  const prepareReview = (sourceType: 'screen' | 'draft' | 'workspace', symbol: SymbolMeta, asOfOverride?: string, baseOverride?: BaseContext) => {
    supersedeReview();
    const base = baseOverride ?? selectBaseContext(sourceType);
    if (!base) {
      append('assistant', sourceType === 'workspace' ? 'The workspace strategy is not available to review.' : 'There is no reviewed screen or draft to test. Describe a screen first, then ask to backtest it on a stock.');
      return;
    }
    try {
      let candidate: StrategyAST;
      if (sourceType === 'screen') {
        const incompatible = exitRuleCompatibility(strategy.rules.exit, base.strategy.indicators, strategy.indicators);
        if (incompatible) throw new Error(incompatible);
        candidate = snapshotStrategy({
          ...base.strategy,
          universe: { ...base.strategy.universe, symbolId: symbol.id, instrumentId: 'legacy:' + symbol.id, ticker: symbol.ticker },
          rules: { ...base.strategy.rules, exit: strategy.rules.exit },
          risk: strategy.risk,
          execution: strategy.execution,
          costs: strategy.costs,
        }, symbol.id);
      } else {
        candidate = snapshotStrategy(base.strategy, symbol.id);
      }
      const strategySignature = canonicalStrategySignature(candidate);
      if (!strategySignature) throw new Error('The reviewed strategy did not pass canonical validation. Nothing was run.');
      const next: BacktestReview = {
        id: 'review_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        strategy: candidate,
        symbol,
        asOf: asOfOverride ?? base.asOf,
        sourceLabel: base.sourceLabel,
        sourceType,
        assumptions: base.assumptions,
        originSnapshot: JSON.stringify(strategy),
        strategySignature,
      };
      setReview(next);
      setReviewStatus('idle');
      setReviewError('');
      setAwaitingSymbolFor(null);
      rememberPreference({
        symbolId: symbol.id,
        ticker: symbol.ticker,
        riskPercent: candidate.risk.stopLoss?.type === 'percent' ? candidate.risk.stopLoss.value : undefined,
      });
      const reviewMessageId = append('assistant', 'I prepared a backtest review for ' + symbol.ticker + '. Nothing has been applied or run. Review the assumptions, then choose “Use these assumptions and run”.');
      setWorkingAnchorId(reviewMessageId);
    } catch (caught) {
      setReviewError((caught as Error).message);
      setReviewStatus('idle');
      setReview(null);
      append('assistant', 'The backtest review could not be prepared: ' + (caught as Error).message + ' Nothing was run.');
    }
  };

  const askForSymbol = (sourceType: 'screen' | 'draft' | 'workspace', detail: string) => {
    setAwaitingSymbolFor(sourceType);
    append('assistant', detail);
  };

  const handleBacktestFollowUp = (text: string, stockQuery: string | null) => {
    supersedeReview();
    const explicitWorkspace = /\b(?:my|the)\s+(?:current\s+)?(?:workspace\s+)?strategy\b|\bworkspace\s+strategy\b/i.test(text);
    const explicitScreen = /\b(?:screen|screener)\b/i.test(text);
    const sourceType: 'screen' | 'draft' | 'workspace' = explicitWorkspace
      ? 'workspace'
      : explicitScreen && screenPlan
        ? 'screen'
        : currentBaseType() ?? 'workspace';
    if (!symbols.length) {
      append('assistant', 'The NSE symbol list is unavailable, so I cannot safely identify that stock. Reload after the symbol service is available.');
      return;
    }
    const resolution = resolveStock(stockQuery, text, symbols);
    if (resolution.status === 'resolved') {
      // An explicit "my strategy" must never be silently replaced by the last screen.
      if (sourceType === 'workspace' && explicitWorkspace && screenPlan) {
        setBacktestChoice({ symbol: resolution.symbol });
        setWorkingAnchorId(append('assistant', 'Choose which strategy to backtest on ' + resolution.symbol.ticker + ': the screen or your workspace strategy. Nothing has been run.'));
        return;
      }
      prepareReview(sourceType, resolution.symbol);
      return;
    }
    if (resolution.status === 'ambiguous') {
      askForSymbol(sourceType, 'I found more than one possible stock: ' +
        resolution.candidates.map(candidate => candidate.ticker + ' (' + candidate.name + ')').join(', ') +
        '. Reply with the exact NSE ticker to use. Nothing was run.');
      return;
    }
    /**
     * "Backtest the top match" needs no ticker when the finished scan still
     * owns the conversation: the first row is the answer, and it goes through
     * the same review path as that row's Backtest button.
     */
    const refersToTopRow = /\b(?:top|first|number\s*one)\b|\b#\s*1\b|\b1st\b/i.test(text);
    if (refersToTopRow && !explicitWorkspace && screenPlan && scanResult) {
      const best = scanResult.matches[0];
      if (!best) {
        append('assistant', 'This screen found no matches, so there is nothing to backtest. Widen a condition or run a new screen.');
        return;
      }
      const symbol = symbols.find(candidate => candidate.id === best.symbolId);
      if (symbol) {
        prepareReview('screen', symbol, best.lastDate || scanResult.asOf);
        return;
      }
      append('assistant', 'The symbol list is unavailable, so I cannot prepare a backtest for that match.');
      return;
    }
    const label = sourceType === 'workspace' ? strategy.name : selectBaseContext(sourceType)?.strategy.name;
    askForSymbol(sourceType, 'Which stock should I test “' + label + '” on? Reply with an NSE ticker such as RELIANCE. Nothing was run.');
  };

  const handleAwaitingSymbol = (text: string): boolean => {
    if (!awaitingSymbolFor) return false;
    if (/\b(?:cancel|never\s+mind|stop|forget\s+it)\b/i.test(text) || /^(?:no|nope|nah)\b/i.test(text)) {
      setAwaitingSymbolFor(null);
      append('assistant', 'No backtest was prepared. Nothing was run.');
      return true;
    }
    if (!symbols.length) {
      append('assistant', 'The NSE symbol list is unavailable, so I cannot safely identify that stock.');
      return true;
    }
    const resolution = resolveStock(text, text, symbols);
    if (resolution.status === 'resolved') {
      prepareReview(awaitingSymbolFor, resolution.symbol);
      return true;
    }
    if (resolution.status === 'ambiguous') {
      askForSymbol(awaitingSymbolFor, 'Which one did you mean? ' +
        resolution.candidates.map(candidate => candidate.ticker + ' (' + candidate.name + ')').join(', ') +
        '. Reply with the exact NSE ticker. Nothing was run.');
      return true;
    }
    setAwaitingSymbolFor(null);
    return false;
  };

  /** The result card is the record of a finished run; the review is spent. */
  const completeRun = (outcome: BacktestResponse) => {
    setValidatedResult(outcome);
    setReviewStatus('complete');
    setStalledRun(null);
    reviewRef.current = null;
    setReview(null);
    const completedMessageId = append('assistant', 'Backtest completed. The headline below comes from the validated run response; open details for trades, costs and provenance.');
    setResultAnchorId(completedMessageId);
  };

  const checkAgainRun = async () => {
    if (!stalledRun || !review) return;
    try {
      const outcome = await Promise.resolve(checkBacktestJob(stalledRun));
      if (!outcome || typeof outcome !== 'object') return;
      if (outcome.state === 'running') return;
      if (!isCurrentReviewResult(outcome.result, review)) {
        setStalledRun(null);
        setReviewError('');
        append('assistant', 'The backtest returned a result for a different strategy or cutoff. Nothing is presented as complete.', { tone: 'error' });
        return;
      }
      completeRun(outcome.result);
    } catch (caught) {
      setStalledRun(null);
      const code = (caught as { code?: string }).code ?? '';
      setReviewError('');
      setWorkingAnchorId(append('assistant', code === 'JOB_NOT_FOUND'
        ? 'The backtest was lost when the server restarted. Run it again.'
        : backtestFailureLine(caught), { tone: 'error' }));
    }
  };

  const cancelStalledRun = async () => {
    if (!stalledRun) return;
    const jobId = stalledRun;
    setStalledRun(null);
    await Promise.resolve(cancelResearchJob(jobId)).catch(() => {});
    setReviewStatus('cancelled');
    append('assistant', 'Research cancelled. No result was applied or saved.');
  };

  const runReview = async () => {
    if (!review || reviewStatus === 'running' || !onResearchBacktest) return;
    requestReveal('run');
    if (review.originSnapshot !== JSON.stringify(strategy)) {
      setReviewError('The workspace changed after this review was prepared. Prepare a fresh review so the assumptions match. Nothing was run.');
      return;
    }
    const owned = ++runGeneration.current;
    setReviewStatus('running');
    setReviewError('');
    setValidatedResult(null);
    try {
      const outcome = review.runOptions
        ? await onResearchBacktest(review.strategy, review.runOptions.asOf ?? review.asOf, review.runOptions)
        : await onResearchBacktest(review.strategy, review.asOf);
      if (runGeneration.current !== owned) return;
      if (reviewRef.current?.id !== review.id || !isCurrentReviewResult(outcome, review)) {
        setReviewStatus('idle');
        setReviewError('The run did not return a current validated result. Nothing is presented as complete.');
        append('assistant', 'The backtest did not return a current validated result. No headline was shown and nothing was marked complete.');
        return;
      }
      completeRun(outcome);
    } catch (caught) {
      if (runGeneration.current !== owned) return;
      const deadline = caught as { code?: string; jobId?: string };
      if (deadline?.code === 'CLIENT_DEADLINE' && deadline.jobId) {
        setReviewStatus('idle');
        setReviewError('');
        setStalledRun(deadline.jobId);
        return;
      }
      const plain = backtestFailureLine(caught);
      setReviewStatus('idle');
      setReviewError(plain);
      // The card moves under the failure line so its Retry sits with the reason.
      setWorkingAnchorId(append('assistant', plain, { tone: 'error' }));
    }
  };

  const cancelRun = () => {
    if (reviewStatus !== 'running') return;
    runGeneration.current++;
    onCancelResearch?.();
    setReviewStatus('cancelled');
    append('assistant', 'Research cancelled. No result was applied or saved.');
  };

  const dismissReview = () => {
    if (reviewStatus === 'running') cancelRun();
    setReview(null);
    setReviewStatus('idle');
    setReviewError('');
    append('assistant', 'Review dismissed. Nothing was run.');
  };

  const handleApproval = (reply: ReviewReply, text: string): boolean => {
    if (reply === 'assumptions') {
      append('assistant', review
        ? 'The assumptions are selected, but nothing was run. Choose “Use these assumptions and run” or reply with that exact instruction to start the backtest.'
        : 'There is no current backtest review. Describe a screen and ask to backtest it on a stock first. Nothing was run.');
      return true;
    }
    if (!review) {
      if (reply === 'approve') {
        append('assistant', 'There is no current backtest review to approve. Describe a screen and ask to backtest it on a stock first. Nothing was run.');
        return true;
      }
      return false;
    }
    if (reply === 'approve') {
      append('assistant', 'Running the reviewed assumptions now.');
      void runReview();
      return true;
    }
    if (reply === 'reject') {
      if (/\b(?:cancel|dismiss|stop|abort|never\s+mind)\b/i.test(text)) {
        dismissReview();
      } else {
        append('assistant', 'Nothing was run. The review is still open; reply with “use these assumptions and run” only when you want to start it.');
      }
      return true;
    }
    return false;
  };

  const attachChartFile = async (file?: File | null) => {
    if (!file) return;
    const owned = ++imageGeneration.current;
    setImageError('');
    setPreparingImage(true);
    try {
      const prepared = await prepareChartImage(file);
      if (imageGeneration.current !== owned) return;
      setChartImage(prepared);
    } catch (caught) {
      if (imageGeneration.current === owned) setImageError((caught as Error).message);
    } finally {
      if (imageGeneration.current === owned) setPreparingImage(false);
    }
  };

  const pasteChartImage = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = event.clipboardData?.items;
    if (!items) return;
    const item = Array.from(items).find(entry => entry.kind === 'file' && entry.type.startsWith('image/'));
    if (!item) return;
    const file = item.getAsFile();
    if (!file) return;
    event.preventDefault();
    void attachChartFile(file);
  };

  const dropChartImage = (event: React.DragEvent<HTMLFormElement>) => {
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) void attachChartFile(file);
  };

  const rememberPendingScan = (plan: ResearchScreenPlan | null) => {
    try {
      if (!plan) localStorage.removeItem(PENDING_SCAN_KEY);
      else localStorage.setItem(PENDING_SCAN_KEY, JSON.stringify({ plan, startedAt: Date.now() }));
    } catch { /* Storage may be unavailable; the scan still runs. */ }
  };

  async function runScreenScan(plan: ResearchScreenPlan, controller: AbortController, owned: number) {
    rememberPendingScan(plan);
    const scanned = await requestScan({
      universe: plan.universe,
      strategy: plan.strategy,
      limit: 100,
      ...(plan.asOf ? { asOf: plan.asOf } : {}),
    }, controller.signal, phase => {
      if (generation.current === owned) setScanWaiting(phase === 'waiting');
    }, progress => {
      if (generation.current !== owned) return;
      const match = /(\d+)\s*\/\s*(\d+)/.exec(progress.stage ?? '');
      const done = match ? Number(match[1]) : NaN;
      const total = match ? Number(match[2]) : NaN;
      setScanProgress(Number.isFinite(done) && Number.isFinite(total) && total > 0 ? { done, total } : null);
    });
    if (generation.current !== owned) return;
    if (scanned.mode === 'demo') {
      throw new Error('Real current data is unavailable. Demo results were not presented as stock matches.');
    }
    if (scanned.mode !== 'real') {
      throw new Error('Data source unverified: the scan did not confirm real observed data. Results were not presented as stock matches.');
    }
    if (scanned.matches.some(match => match.provenance.mode !== 'real') || /demo/i.test(scanned.dataSource)) {
      throw new Error('Real current data is unavailable. Demo results were not presented as stock matches.');
    }
    setScanResult(scanned);
    rememberPendingScan(null);
    rememberPreference({ universe: 'NIFTY_50' });
  }

  /** One place for scan failures: a deadline keeps the job, anything else is plain. */
  const handleScanFailure = (caught: unknown) => {
    const error = caught as { code?: string; jobId?: string };
    if (error?.code === 'CLIENT_DEADLINE' && error.jobId) {
      setScanError('');
      setStalledScan(error.jobId);
      setScanPending(false);
      return;
    }
    setStalledScan(null);
    rememberPendingScan(null);
    setScanError(scanFailureLine(caught));
  };

  const stageProgress = (stage: string | undefined) => {
    const match = /(\d+)\s*\/\s*(\d+)/.exec(stage ?? '');
    const done = match ? Number(match[1]) : NaN;
    const total = match ? Number(match[2]) : NaN;
    return Number.isFinite(done) && Number.isFinite(total) && total > 0 ? { done, total } : null;
  };

  const checkAgainScan = async () => {
    if (!stalledScan) return;
    try {
      const outcome = await Promise.resolve(checkScanJob(stalledScan));
      if (!outcome || typeof outcome !== 'object') return;
      if (outcome.state === 'done') {
        setScanResult(outcome.result);
        setStalledScan(null);
        setScanProgress(null);
        rememberPendingScan(null);
        return;
      }
      setScanProgress(stageProgress(outcome.stage));
    } catch (caught) {
      setStalledScan(null);
      setScanError(scanFailureLine(caught));
    }
  };

  const cancelStalledScan = async () => {
    if (!stalledScan) return;
    const jobId = stalledScan;
    rememberPendingScan(null);
    setStalledScan(null);
    setScanProgress(null);
    await Promise.resolve(cancelResearchJob(jobId)).catch(() => {});
    setScanError('Scan cancelled. Nothing was matched.');
  };

  /** A scan failure in plain language: no transport text, no JSON parser detail. */
  const scanFailureLine = (caught: unknown): string => {
    const error = caught as { code?: string; message?: string; status?: number };
    const code = (error?.code ?? '').toUpperCase();
    const message = error?.message ?? '';
    if (/JOB_LOST|JOB_NOT_FOUND/.test(code)) return 'The server restarted and the scan was lost. Try again.';
    if (/DEADLINE|TIMEOUT/.test(code) || /timed out|deadline/i.test(message)) return "The scan didn't finish in time. Try again.";
    if (/RATE_LIMIT|RATE_LIMITED/.test(code) || error?.status === 429 || /rate limit/i.test(message)) {
      return 'Angel One is busy right now. Try the scan again in a minute.';
    }
    if (/INVALID_RESPONSE|FETCH|NETWORK/.test(code) || /did not return JSON|failed to fetch|network/i.test(message)) {
      return "The scan couldn't reach the server. Try again.";
    }
    if (/data source unverified|did not confirm real observed/i.test(message)) {
      return "The scan didn't confirm real observed data. Nothing was presented as a match.";
    }
    if (/demo results|demo/i.test(message)) return 'Real current data is unavailable right now. Nothing was presented as a match.';
    if (/real current data is unavailable/i.test(message)) return 'Real current data is unavailable right now. Nothing was presented as a match.';
    return "The scan didn't finish. Try again.";
  };

  const confirmChartScan = async (edited: StrategyAST) => {
    if (!screenPlan || scanPendingRef.current) return;
    requestReveal('scan');
    const validated = validateStrategy(edited);
    if (!validated.success || !validated.data) {
      setScanError('The edited chart conditions did not pass validation: ' + (validated.errors?.[0] ?? 'unknown rule error') + '. Nothing was scanned.');
      return;
    }
    const plan: ResearchScreenPlan = { ...screenPlan, strategy: validated.data as ResearchScreenPlan['strategy'] };
    setScreenPlan(plan);
    setAwaitingChartConfirm(false);
    const owned = ++generation.current;
    const controller = new AbortController();
    abort.current = controller;
    scanPendingRef.current = true;
    setScanPending(true);
    setScanError('');
    setScanResult(null);
    try {
      await runScreenScan(plan, controller, owned);
    } catch (caught) {
      if (generation.current === owned && !controller.signal.aborted) handleScanFailure(caught);
    } finally {
      if (generation.current === owned) {
        scanPendingRef.current = false;
        setScanPending(false);
      }
    }
  };

  const retryScreenScan = async () => {
    const plan = screenPlan;
    if (!plan || scanPendingRef.current) return;
    requestReveal('scan');
    const owned = ++generation.current;
    const controller = new AbortController();
    abort.current = controller;
    scanPendingRef.current = true;
    setScanPending(true);
    setScanError('');
    setScanResult(null);
    try {
      await runScreenScan(plan, controller, owned);
    } catch (caught) {
      if (generation.current === owned && !controller.signal.aborted) handleScanFailure(caught);
    } finally {
      if (generation.current === owned) {
        scanPendingRef.current = false;
        setScanPending(false);
      }
    }
  };

  /**
   * The copilot fills the Strategy tester from explicit rules in the message,
   * using the feature registry. The filled setup is validated server-side against
   * the same schema; a missing field yields exactly one question, never an
   * invented symbol or rule.
   */
  const prepareFromFeatureSetup = async (text: string): Promise<boolean> => {
    setLoading(true);
    setError('');
    try {
      const data = await requestFeatureSetup({ message: text, currentStrategy: strategy, preferences: readPreferences() });
      if (data.status === 'needs-input') {
        append('assistant', data.question);
        return true;
      }
      if (data.setup.feature === 'strategy_tester') {
        const setup = data.setup;
        const symbol = symbols.find(candidate => candidate.id === setup.strategy.universe.symbolId)
          ?? getSymbolById(setup.strategy.universe.symbolId);
        const candidate = snapshotStrategy(setup.strategy);
        const signature = canonicalStrategySignature(candidate);
        if (!signature) throw new Error('The filled strategy did not pass canonical validation. Nothing was run.');
        const next: BacktestReview = {
          id: 'review_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
          strategy: candidate,
          symbol,
          asOf: setup.asOf ?? setup.end,
          sourceLabel: 'AI-filled strategy tester setup from your message',
          sourceType: 'draft',
          assumptions: setup.assumptions,
          originSnapshot: JSON.stringify(strategy),
          strategySignature: signature,
          runOptions: { start: setup.start, end: setup.end, asOf: setup.asOf, initialCapital: setup.initialCapital, seed: setup.seed, robustness: setup.robustness },
        };
        supersedeReview();
        setReview(next);
        setReviewStatus('idle');
        setReviewError('');
        setAwaitingSymbolFor(null);
        setLastContext('draft');
        rememberPreference({
          symbolId: symbol.id,
          ticker: symbol.ticker,
          riskPercent: candidate.risk.stopLoss?.type === 'percent' ? candidate.risk.stopLoss.value : undefined,
        });
        append('assistant', 'I filled the strategy tester for ' + symbol.ticker + ' from your message. Review the assumptions below; nothing has been run or applied.');
        return true;
      }
      if (data.setup.feature === 'market_scanner') {
        publishFeaturePrefill(data.setup);
        append('assistant', 'I filled a ' + data.setup.universe + ' scan setup. Open Market scanner to review it; nothing has been run.');
        return true;
      }
      return false;
    } catch (caught) {
      append('assistant', 'The setup could not be filled from your message: ' + (caught as Error).message + ' Nothing was run.', { tone: 'error', retryPrompt: text });
      return true;
    } finally {
      setLoading(false);
    }
  };

  const submitText = async (raw: string, attachedImage: ChartImageAttachment | null = null) => {
    const text = raw.trim();
    if ((!text && !attachedImage) || loading || reviewStatus === 'running' || pendingApply.current) return;
    // A new user turn stops any answer being read aloud.
    cancelSpeech();
    setChartRetry(null);
    const userMessageId = append('user', attachedImage ? '[chart image attached]' : text);
    setError('');
    setApplyStatus('');
    setSaveStatus('');
    setClipboardStatus('');
    clipboardGeneration.current++;

    if (!attachedImage) {
      const reply = classifyReviewReply(text);
      if (handleApproval(reply, text)) return;
      if (handleAwaitingSymbol(text)) return;
      if (wantsFeatureSetup(text) && await prepareFromFeatureSetup(text)) return;

      const intent = parseBacktestIntent(text);
      if (intent.kind === 'negated') {
        append('assistant', 'Nothing was run. A negative instruction is never treated as approval.');
        return;
      }
      if (intent.kind === 'backtest') {
        handleBacktestFollowUp(text, intent.stockQuery);
        return;
      }
    }

    // Clear an unapproved review before the request is sent, so a later failed
    // request can never leave an obsolete review available for approval.
    supersedeReview();

    if (attachedImage) {
      // A new image is a new screen, not a continuation of the previous one.
      archiveCompletedCard();
      setChartReading(null);
      setScreenPlan(null);
      setAwaitingChartConfirm(false);
      setLastContext(null);
    setBacktestChoice(null);
    }

    // The OpenCode engine is the only chat path. A fresh chart upload stays on
    // the dedicated chart-analysis job (202 + polling): probing an engine
    // session first would change that route's ordering. Once a session exists,
    // the image rides with the engine prompt.
    if (!attachedImage || engineSessionRef.current) {
      pendingUserText.current = attachedImage ? '[chart image attached]' : text;
      pendingUserMessageId.current = userMessageId;
      if (attachedImage) {
        archiveCompletedCard();
        setChartReading(null);
        setScreenPlan(null);
        setAwaitingChartConfirm(false);
        setLastContext(null);
        setBacktestChoice(null);
      }
      // A failure is shown as a typed, retryable card; it never falls through
      // to another chat route.
      await sendThroughEngine(text, attachedImage);
      return;
    }

    let current: StrategyAST;
    try { current = snapshotStrategy(strategy); } catch (caught) {
      append('assistant', 'Your workspace strategy cannot be validated: ' + (caught as Error).message + ' Nothing was sent.', { tone: 'error' });
      return;
    }
    const sourceSnapshot = JSON.stringify(strategy);
    const originatingRevision = revision.current;
    const owned = ++generation.current;
    abort.current?.abort();
    // A new request supersedes any in-flight scan. The old scan's finally block
    // is generation-guarded, so explicitly clear its pending state here.
    const hadPendingScan = scanPendingRef.current;
    scanPendingRef.current = false;
    setScanPending(false);
    setScanWaiting(false);
    setScanProgress(null);
    setScanError('');
    if (hadPendingScan) {
      setScanResult(null);
      setScanError('The previous scan was superseded by your new request. No matches were confirmed.');
    }
    const controller = new AbortController();
    abort.current = controller;
    setLoading(true);

    try {
      let chartCacheUsed = false;
      let data: ChartAnalysisResponse;
      if (attachedImage) {
        const hash = await chartImageHash(attachedImage.dataUrl);
        const cached = hash ? readCachedChartAnalysis(hash) : null;
        if (cached) {
          data = cached;
          chartCacheUsed = true;
        } else {
          data = await requestChartAnalysis({
            image: attachedImage.dataUrl,
            ...(text ? { hint: text } : {}),
            currentStrategy: current,
          }, controller.signal);
          if (hash) writeCachedChartAnalysis(hash, data);
        }
      } else {
        // Unreachable: text turns returned through the engine above.
        return;
      }
      if (generation.current !== owned) return;
      const receivedChartReading: ChartImageReading | null =
        (data as ChartAnalysisResponse).chartReading ?? (data.kind === 'screen' ? chartReadingFromScreen(data) : null);
      // A deterministic market answer is a successful local result, not a provider failure.
      const deterministicMarket = data.method === 'unavailable'
        && data.warnings.some(warning => warning.startsWith('Deterministic answer'));
      const providerFailure = data.method === 'unavailable' && !deterministicMarket ? providerFailureFor(data.message) : null;
      const messageId = providerFailure
        ? append('assistant', providerFailure.text, {
          methodLabel: 'AI unavailable',
          warnings: [...(data.warnings ?? []), providerFailure.detail],
          retryPrompt: text,
        })
        : append('assistant', data.message, {
          methodLabel: chartCacheUsed ? 'Cached chart reading · same image (SHA-256)' : deterministicMarket ? 'Built-in market data · not AI' : methodLabel(data.method, data.provider),
          methodTitle: data.provider.aiGenerated
            ? `Answered by ${data.provider.name}. Verify factual claims with data.`
            : undefined,
          warnings: data.warnings,
          // A reply marked unavailable is a failure report: it is the one alert,
          // in the conversation, never repeated above the composer.
          tone: data.method === 'unavailable' && !deterministicMarket ? 'error' : undefined,
        });
      if (attachedImage && data.method === 'unavailable' && !deterministicMarket) {
        setChartRetry({ image: attachedImage, hint: text, messageId });
      } else {
        setChartRetry(null);
      }
      if (data.kind === 'proposal') {
        const parsed = parseStrategyProposal(data.proposal);
        setCardMessageId(messageId);
        setWorkingAnchorId(messageId);
        assertProposalCurrent(parsed, originatingRevision, sourceSnapshot, JSON.stringify(strategy));
        archiveCompletedCard();
        setProposal({ ...parsed, sourceSnapshot, validatedCandidate: parsed.candidate });
        setScreenPlan(null);
        setScanResult(null);
        setScanError('');
        setChartReading(null);
        scanPendingRef.current = false;
        setScanPending(false);
        setReview(null);
        setReviewStatus('idle');
        setAwaitingSymbolFor(null);
        setLastContext('draft');
        setApplied(null);
      } else if (data.kind === 'screen') {
        // The card states the plan's method; a cache hit is not in the card, so
        // that label stays under the message where it is still true.
        setCardMessageId(chartCacheUsed ? null : messageId);
        setWorkingAnchorId(messageId);
        archiveCompletedCard();
        setScreenPlan(data);
        setChartReading(receivedChartReading);
        setApplied(null);
        setProposal(null);
        setReview(null);
        setReviewStatus('idle');
        setAwaitingSymbolFor(null);
        setLastContext('screen');
        setScanResult(null);
        setScanError('');
        if (attachedImage) {
          // Chart readings are a model interpretation. The user must review and
          // confirm the conditions before any stock scan starts.
          scanPendingRef.current = false;
          setScanPending(false);
          setAwaitingChartConfirm(true);
        } else {
          setAwaitingChartConfirm(false);
          scanPendingRef.current = true;
          setScanPending(true);
          try {
            await runScreenScan(data, controller, owned);
          } catch (caught) {
            if (generation.current === owned && !controller.signal.aborted) handleScanFailure(caught);
          } finally {
            if (generation.current === owned) {
              scanPendingRef.current = false;
              setScanPending(false);
            }
          }
        }
      } else {
        // A conversational reply owns no card, so its provenance line stays.
        setCardMessageId(null);
        // A conversational reply cannot leave an earlier scan marked pending.
        scanPendingRef.current = false;
        setScanPending(false);
        if (attachedImage) setChartReading(null);
      }
    } catch (caught) {
      if (generation.current !== owned || controller.signal.aborted) return;
      if (attachedImage) {
        const raw = caught instanceof Error ? caught.message : 'The chart image could not be read.';
        const failure = /describe the setup/i.test(raw)
          ? raw
          : raw.replace(/\s*Try again\.?$/i, '') + ' Try again, or describe the setup in words.';
        const id = append('assistant', failure, { methodLabel: 'AI unavailable', tone: 'error' });
        setChartRetry({ image: attachedImage, hint: text, messageId: id });
        setError('');
      } else {
        setError((caught as Error).message);
      }
    } finally {
      if (generation.current === owned) setLoading(false);
    }
  };

  const submitComposer = () => {
    if (!canSubmit) return;
    const text = prompt;
    lastPromptRef.current = text;
    const image = chartImage;
    setPrompt('');
    if (image) {
      // The card must still show the image after send (P1-3).
      setSentChartImage(image);
      discardChartImage();
    }
    // Focus stays in the composer: sending never drops it to <body> (P0-3).
    promptRef.current?.focus();
    // The user asked for this: its answer and its card must come into view.
    requestReveal('send');
    followAnswer.current = true;
    setJumpVisible(false);
    void submitText(text, image);
  };

  const send = (event: React.FormEvent) => {
    event.preventDefault();
    submitComposer();
  };

  const onComposerKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const native = event.nativeEvent as KeyboardEvent & { isComposing?: boolean };
    if (event.key !== 'Enter' || event.shiftKey) return;
    if (native.isComposing || native.keyCode === 229) return;
    event.preventDefault();
    submitComposer();
  };

  const confirmApply = async (candidate: StrategyAST, id: string, successMessage: string) => {
    const applyToWorkspace = onApplyVariation;
    if (!applyToWorkspace) return false;
    const pending = { id, snapshot: JSON.stringify(candidate) };
    pendingApply.current = pending;
    setError('');
    setApplyStatus('Apply requested. Waiting for workspace confirmation.');
    try {
      const accepted = await applyToWorkspace(candidate);
      if (accepted === false) throw new Error('The workspace rejected this draft. Nothing was confirmed as applied.');
      if (accepted === true) {
        // The workspace-change effect may have confirmed this apply before the
        // await resumed; that is the same success, not a failure.
        if (pendingApply.current === pending) {
          pendingApply.current = null;
          setApplied(pending.id);
          setApplyStatus(successMessage);
        }
        return true;
      } else if (pendingApply.current === pending && pending.snapshot === JSON.stringify(snapshotStrategy(strategy))) {
        pendingApply.current = null;
        setApplied(pending.id);
        setApplyStatus('Workspace already matches this draft. No backtest or broker order was executed.');
        return true;
      }
    } catch (caught) {
      if (pendingApply.current === pending) {
        pendingApply.current = null;
        setApplyStatus('Draft was not confirmed as applied.');
        append('assistant', 'The draft was not applied: ' + (caught as Error).message + ' Nothing was run.', { tone: 'error' });
      }
    }
    return false;
  };

  const apply = async () => {
    if (!proposal || !onApplyVariation || applied === proposal.id || pendingApply.current) return false;
    let candidate: StrategyAST;
    try {
      assertProposalCurrent(proposal, revision.current, proposal.sourceSnapshot, JSON.stringify(strategy));
      candidate = snapshotStrategy(proposal.validatedCandidate);
    } catch (caught) {
      append('assistant', 'The draft was not applied: ' + (caught as Error).message + ' Nothing was run.', { tone: 'error' });
      return false;
    }
    return await confirmApply(candidate, proposal.id, 'Draft applied to the workspace. The assumptions are in the builder; no backtest or broker order was executed.');
  };

  /**
   * One click from a reviewed draft to a reviewed backtest: apply it, then wait
   * for the workspace to hold the applied strategy before freezing the review,
   * so the review can never describe the pre-apply workspace.
   */
  const applyAndBacktest = async () => {
    if (!proposal || !onApplyVariation) return;
    const id = proposal.id;
    let snapshot = '';
    try { snapshot = JSON.stringify(snapshotStrategy(proposal.validatedCandidate)); } catch { snapshot = ''; }
    pendingBacktestDeadline.current = Date.now() + 8000;
    setPendingDraftBacktest({ id, snapshot });
    const ok = await apply();
    if (!ok) {
      pendingBacktestDeadline.current = 0;
      setPendingDraftBacktest(current => current?.id === id ? null : current);
    }
  };

  /**
   * Freeze the review only once the workspace actually holds the applied
   * strategy: the apply may be confirmed by the workspace effect before the
   * awaited call resumes, and the strategy prop arrives a tick later.
   *
   * The success check runs on every workspace render, never inside a timer, so
   * a slow commit cannot lose the review. The fallback has one absolute
   * deadline and re-reads the latest workspace first, so it only speaks when
   * no update arrived.
   */
  useEffect(() => {
    if (!pendingDraftBacktest) return;
    const { id, snapshot } = pendingDraftBacktest;
    let workspaceNow = '';
    try { workspaceNow = JSON.stringify(snapshotStrategy(strategy)); } catch { workspaceNow = ''; }
    if (applied === id && workspaceNow === snapshot) {
      pendingBacktestDeadline.current = 0;
      setPendingDraftBacktest(null);
      const symbol = symbols.find(candidate => candidate.id === strategy.universe.symbolId);
      if (symbol) prepareReview('workspace', symbol);
      else append('assistant', 'The draft is applied, but it has no stock yet. Choose a symbol in the tester, then review a backtest.');
      return;
    }
    if (!pendingBacktestDeadline.current) pendingBacktestDeadline.current = Date.now() + 8000;
    const deadline = pendingBacktestDeadline.current;
    const timer = window.setTimeout(() => {
      const latest = latestWorkspace.current;
      // A workspace update may land between the last render and this timer; it
      // still owns the outcome, and the check above will review it.
      if (latest.applied === id && latest.snapshot === snapshot) return;
      if (pendingBacktestDeadline.current !== deadline) return;
      pendingBacktestDeadline.current = 0;
      setPendingDraftBacktest(current => current?.id === id ? null : current);
      append('assistant', 'The draft was applied, but the workspace did not confirm it in time, so no backtest review was prepared. Nothing was run.', {
        retryPrompt: lastPromptRef.current || undefined,
      });
    }, Math.max(0, deadline - Date.now()));
    return () => window.clearTimeout(timer);
  }, [pendingDraftBacktest, applied, strategy, symbols]);

  const applyScreenDraft = async (override?: StrategyAST) => {
    if (!screenPlan || !onApplyVariation || pendingApply.current) return;
    if (applied?.startsWith('screen:')) return;
    let candidate: StrategyAST;
    try { candidate = snapshotStrategy(override ?? screenPlan.strategy); }
    catch (caught) {
      append('assistant', 'The screen strategy could not be applied: ' + (caught as Error).message + ' Nothing was run.', { tone: 'error' });
      return;
    }
    const id = 'screen:' + Date.now() + ':' + Math.random().toString(36).slice(2, 6);
    await confirmApply(candidate, id, 'Screen strategy applied to the workspace draft. Review exits, risk, sizing and costs in the builder; no backtest or broker order was executed.');
  };

  const save = async () => {
    if (!proposal || !onSaveStrategy) return;
    setSaveStatus('Saving this draft to My Strategies…');
    try {
      const saved = await onSaveStrategy(snapshotStrategy(proposal.validatedCandidate));
      setSaveStatus('Saved to My Strategies' + (saved?.name ? ' as “' + saved.name + '”' : '') + '. Nothing was run.');
    } catch (caught) {
      setSaveStatus('Not saved: ' + (caught as Error).message);
    }
  };

  const copy = async () => {
    if (!proposal) return;
    const owned = ++clipboardGeneration.current;
    setClipboardStatus('Copying draft…');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable. Copy from View complete strategy instead.');
      await navigator.clipboard.writeText(JSON.stringify(proposal.validatedCandidate, null, 2));
      if (clipboardGeneration.current === owned) setClipboardStatus('Draft copied. Nothing was applied or run.');
    } catch (caught) {
      if (clipboardGeneration.current === owned) setClipboardStatus('Copy failed. ' + (caught as Error).message);
    }
  };

  const prepareDraftReviewFromButton = () => {
    if (!proposal || !symbols.length) {
      if (!symbols.length) append('assistant', 'The NSE symbol list is unavailable, so I cannot safely identify the draft stock.');
      return;
    }
    const symbol = symbols.find(candidate => candidate.id === proposal.validatedCandidate.universe.symbolId);
    if (symbol) {
      prepareReview('draft', symbol);
      return;
    }
    askForSymbol('draft', 'Which stock should I test the draft “' + proposal.validatedCandidate.name + '” on? Reply with an NSE ticker. Nothing was run.');
  };

  const welcome = !messages.length && !review && !proposal && !screenPlan;
  const cardImage = chartImage ?? sentChartImage;
  const draftChanges = proposal
    ? proposal.changes
      .map(describeDraftChange)
      .filter((change): change is DraftChange => change !== null)
      .map(change => withPercentSuffix(change, proposal.validatedCandidate))
    : [];
  const headlineChange = draftChanges.find(change => change.plain);
  // ONE polite announcement for the whole conversation: start and finish only.
  const statusMessage = loading
    ? 'Stragy is working on your request.'
    : scanPending
      ? 'Screen running.'
      : reviewStatus === 'running'
        ? 'Backtest running.'
        : messages.length ? 'Response ready.' : '';

  const closeDraftMenu = () => { if (draftMenuRef.current) draftMenuRef.current.open = false; };

  // Cards are placed after the message that produced them: a result must never
  // drift below a question asked later.
  const workingCards = (
    <>
              {chartReading && screenPlan && (
                <ChartReadingCard
                  plan={screenPlan}
                  reading={chartReading}
                  busy={busy}
                  canApply={!!onApplyVariation}
                  applied={!!applied && applied.startsWith('screen:')}
                  imageUrl={cardImage?.dataUrl}
                  imageName={cardImage?.name}
                  onUseAsDraft={strategy => void applyScreenDraft(strategy)}
                  onConfirmScan={strategy => void confirmChartScan(strategy)}
                  scanning={scanPending}
                />
              )}

              {screenPlan && (!awaitingChartConfirm || scanPending || !!scanResult || !!scanError) && (
                <ScreenResultCard
                  plan={screenPlan}
                  result={scanResult}
                  pending={scanPending}
                  waiting={scanPending && scanWaiting}
                  progress={scanPending ? scanProgress : null}
                  stalled={stalledScan ? { onCheckAgain: () => void checkAgainScan(), onCancel: () => void cancelStalledScan() } : null}
                  error={scanError}
                  busy={busy}
                  onPrepareBacktest={(symbolId, matchAsOf) => {
                    const symbol = symbols.find(candidate => candidate.id === symbolId);
                    if (symbol) prepareReview('screen', symbol, matchAsOf);
                    else append('assistant', 'The symbol list is unavailable, so I cannot prepare a backtest for that match.');
                  }}
                  onCancelScan={scanPending ? cancelPendingRequest : undefined}
                  onRetryScan={screenPlan && !scanPending ? retryScreenScan : undefined}
                />
              )}

              {backtestChoice && screenPlan && (
                <div aria-label="Choose backtest strategy" role="group">
                  <CardShell
                    density="compact"
                    title={'Which strategy should I backtest on ' + backtestChoice.symbol.ticker + '?'}
                    meta="Nothing has been run."
                  >
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => { const choice = backtestChoice; setBacktestChoice(null); prepareReview('screen', choice.symbol, choice.asOf); }}
                        className="st-meta inline-flex min-h-11 items-center rounded-[var(--r-btn)] border border-[var(--line-strong)] px-3 text-[var(--text-2)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-1)] sm:min-h-8"
                      >
                        Use screen: {screenPlan.strategy.name}
                      </button>
                      <button
                        type="button"
                        onClick={() => { const choice = backtestChoice; setBacktestChoice(null); prepareReview('workspace', choice.symbol, choice.asOf); }}
                        className="st-meta inline-flex min-h-11 items-center rounded-[var(--r-btn)] border border-[var(--line-strong)] px-3 text-[var(--text-2)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-1)] sm:min-h-8"
                      >
                        Use my strategy: {strategy.name}
                      </button>
                    </div>
                  </CardShell>
                </div>
              )}

              {review && (
                <BacktestReviewCard
                  review={review}
                  running={reviewStatus === 'running'}
                  waiting={reviewStatus === 'running' && runPhase === 'waiting'}
                  stalled={stalledRun ? { onCheckAgain: () => void checkAgainRun(), onCancel: () => void cancelStalledRun() } : null}
                  error={reviewError}
                  onApprove={() => void runReview()}
                  onCancelReview={dismissReview}
                  onCancelRun={onCancelResearch ? cancelRun : undefined}
                />
              )}

              {proposal && (
                <article aria-label="Draft proposal">
                  <CardShell
                    title={headlineChange ? changeTitle(headlineChange) : proposal.validatedCandidate.name}
                    meta={proposal.provider.aiGenerated
                      ? 'AI draft via ' + proposal.provider.name + (proposal.provider.model ? ' / ' + proposal.provider.model : '') + ' · schema-validated, not performance-verified' + (draftChanges.length > 1 ? ' · ' + draftChanges.length + ' changes' : '')
                      : 'Local keyword rules · not AI' + (draftChanges.length > 1 ? ' · ' + draftChanges.length + ' changes' : '')}
                    state="idle"
                    statusBelow
                    status={proposal.provider.aiGenerated ? 'Draft · not applied' : 'Draft from rules · not applied'}
                    footer={(
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            aria-label={applied === proposal.id ? 'Draft applied' : 'Apply draft'}
                            disabled={!onApplyVariation || !!pendingApply.current || applied === proposal.id || proposal.sourceSnapshot !== snapshot}
                            onClick={() => void apply()}
                            className="st-meta inline-flex min-h-11 items-center rounded-[var(--r-btn)] bg-[var(--accent)] px-3.5 font-semibold text-[var(--accent-ink)] transition-colors hover:bg-[var(--accent-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-9"
                          >
                            {applied === proposal.id ? 'Applied' : 'Apply'}
                          </button>
                          <button
                            type="button"
                            disabled={!onResearchBacktest || reviewStatus === 'running' || !!pendingApply.current || applied === proposal.id || proposal.sourceSnapshot !== snapshot}
                            onClick={() => void applyAndBacktest()}
                            className="st-meta inline-flex min-h-11 items-center rounded-[var(--r-btn)] border border-[var(--line-strong)] px-3 text-[var(--text-2)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-1)] disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-8"
                          >
                            Apply and backtest
                          </button>
                          <details ref={draftMenuRef} className="relative ml-auto">
                            <summary
                              aria-label="More draft actions"
                              title="More draft actions"
                              className="flex min-h-11 min-w-11 cursor-pointer list-none items-center justify-center rounded-[var(--r-btn)] text-[var(--text-3)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-1)] [&::-webkit-details-marker]:hidden sm:min-h-8 sm:min-w-8"
                            >
                              <MoreHorizontal size={16} aria-hidden="true" />
                            </summary>
                            <div className="mt-1 space-y-0.5 border-t border-[var(--line)] pt-1">
                              {onSaveStrategy && (
                                <button type="button" onClick={() => { closeDraftMenu(); void save(); }} className={DRAFT_MENU_ITEM}>Save to My Strategies</button>
                              )}
                              <button type="button" onClick={() => { closeDraftMenu(); void copy(); }} className={DRAFT_MENU_ITEM}>Copy draft JSON</button>
                              <button
                                type="button"
                                onClick={() => { closeDraftMenu(); setProposal(null); setClipboardStatus(''); setSaveStatus(''); clipboardGeneration.current++; }}
                                className={DRAFT_MENU_ITEM}
                              >
                                Dismiss
                              </button>
                            </div>
                          </details>
                        </div>
                        {proposal.sourceSnapshot !== snapshot && <p className="st-meta text-[#f5d383]">The workspace changed after this draft was prepared. Generate a fresh draft before applying.</p>}
                      </div>
                    )}
                  >
                    <div className="space-y-2">
                      <h4 className="st-meta font-medium text-[var(--text-3)]">Changes</h4>
                      {draftChanges.length ? (
                        <dl className="divide-y divide-[var(--line)]">
                          {draftChanges.map((change, changeIndex) => (
                            <div key={changeIndex} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-1.5 first:pt-0 last:pb-0">
                              <dt className="text-[13px] leading-5 text-[var(--text-2)]">{change.label}</dt>
                              {change.value && <dd className="st-tnum text-[13px] leading-5 font-medium text-[var(--text-1)]">{change.value}</dd>}
                            </div>
                          ))}
                        </dl>
                      ) : (
                        <p className="text-[13px] leading-5 text-[var(--text-2)]">No field changes were proposed.</p>
                      )}
                    </div>
                    <p className="st-meta text-[var(--text-3)]">Applying changes the workspace draft only. Nothing is saved or run automatically.</p>
                    <Disclosure summary="Warnings, assumptions and complete strategy">
                      <div className="space-y-2">
                        <ul className="list-disc space-y-1 pl-4">
                          {proposal.warnings.length ? proposal.warnings.map((warning, warningIndex) => <li key={warningIndex}>{warning}</li>) : <li>No additional warnings.</li>}
                        </ul>
                        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all font-mono text-[12px] leading-5 text-[var(--text-2)]">{JSON.stringify(proposal.validatedCandidate, null, 2)}</pre>
                      </div>
                    </Disclosure>
                  </CardShell>
                </article>
              )}

    </>
  );
  const resultCard = validatedResult
    ? <BacktestResultCard result={validatedResult} onOpenDetails={() => onOpenDetails?.(validatedResult)} />
    : null;
  /**
   * Earlier cards render read-only: the chart reading cannot start another
   * scan, and a completed table keeps only the actions that still make sense
   * (Backtest per row). Retry / check-again belong to the live card.
   */
  const pastCardView = (card: PastCard) => (
    <>
      {card.chartReading && (
        <ChartReadingCard
          plan={card.plan}
          reading={card.chartReading}
          past
          applied={false}
          canApply={false}
          busy={false}
          scanning={false}
          imageUrl={card.imageUrl}
          imageName={card.imageName}
        />
      )}
      {card.result && (
        <ScreenResultCard
          plan={card.plan}
          result={card.result}
          pending={false}
          error=""
          busy={false}
          onPrepareBacktest={(symbolId, matchAsOf) => {
            const symbol = symbols.find(candidate => candidate.id === symbolId);
            if (symbol) prepareReview('screen', symbol, matchAsOf, pastBase(card));
            else append('assistant', 'The symbol list is unavailable, so I cannot prepare a backtest for that match.');
          }}
        />
      )}
    </>
  );

  /**
   * A card from a restored engine session. Read-only: it shows the durable
   * result but never offers apply/run on a stale draft from another session.
   */
  const restoredCardView = (card: RestoredCard) => (
    <>
      {!card.plan && card.scanResult && <EngineScanResultCard result={card.scanResult} />}
      {card.plan && card.chartReading && (
        <ChartReadingCard
          plan={card.plan}
          reading={card.chartReading}
          past
          applied={false}
          canApply={false}
          busy={false}
          scanning={false}
        />
      )}
      {card.plan && card.scanResult && (
        <ScreenResultCard
          plan={card.plan}
          result={card.scanResult}
          pending={false}
          error=""
          busy={false}
          onPrepareBacktest={(symbolId, matchAsOf) => {
            const symbol = symbols.find(candidate => candidate.id === symbolId);
            if (symbol) {
              prepareReview('screen', symbol, matchAsOf, {
                strategy: card.plan!.strategy,
                asOf: card.scanResult?.observationDates?.latest ?? card.plan!.asOf,
                sourceLabel: 'Restored screen “' + card.plan!.strategy.name + '” from an earlier engine session',
                assumptions: card.plan!.assumptions,
              });
            } else {
              append('assistant', 'The symbol list is unavailable, so I cannot prepare a backtest for that match.');
            }
          }}
        />
      )}
      {card.plan && !card.scanResult && (
        <article aria-label="Restored screen plan">
          <CardShell
            density="compact"
            title={card.plan.strategy.name}
            meta={universeLabel(card.plan.universe) + ' · saved screen plan from an earlier engine session · rows were not kept in this transcript'}
            status="Saved plan"
            statusBelow
          >
            <p className="text-[13px] leading-5 text-[var(--text-2)]">Ask the engine to run this screen again if you want fresh rows.</p>
          </CardShell>
        </article>
      )}
      {card.result && (
        <BacktestResultCard result={card.result} onOpenDetails={() => onOpenDetails?.(card.result!)} />
      )}
      {card.proposal && (
        <article aria-label="Restored draft">
          <CardShell
            density="compact"
            title={card.proposal.name}
            meta={card.proposal.provider + ' · from an earlier engine session · not applied, not run'}
            status="Restored draft"
            statusBelow
          >
            {card.proposal.changes.length ? (
              <ul className="list-disc space-y-1 pl-4">
                {card.proposal.changes.slice(0, 8).map((change, index) => (
                  <li key={index} className="text-[13px] leading-5 text-[var(--text-2)]">{change}</li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] leading-5 text-[var(--text-2)]">No field changes were recorded for this draft.</p>
            )}
          </CardShell>
        </article>
      )}
    </>
  );
  const workingAnchored = workingAnchorId !== null && messages.some(message => message.id === workingAnchorId);
  const lastAssistantIndex = messages.reduce((last, message, index) => message.sender === 'assistant' ? index : last, -1);
  const resultAnchored = resultAnchorId !== null && messages.some(message => message.id === resultAnchorId);

  const historyPanel = (
    <SessionHistoryPanel
      sessions={sessionList ?? (activeSession ? [activeSession] : [])}
      activeSessionId={engineSessionId}
      activeSession={activeSession}
      loading={sessionListLoading}
      error={sessionListError}
      query={historyQuery}
      onQueryChange={setHistoryQuery}
      onRetry={() => void refreshHistory(historyQuery)}
      onNewChat={() => { clearConversation(); }}
      onSwitch={sessionId => void loadEngineSession(sessionId)}
      onRename={renameSession}
      onDelete={deleteSession}
      onExport={(sessionId, format) => void exportSession(sessionId, format)}
      status={sessionListStatus}
    />
  );
  const dataUniverse = String(screenPlan?.universe ?? 'NIFTY_50');

  return (
    <section
      aria-label="Research conversation"
      className={(full ? 'h-full' : 'h-full border-l border-[var(--line)]') + ' flex min-h-0 flex-col bg-[#111113]'}
      onKeyDown={event => { if (event.key === 'Escape' && onClose) onClose(); }}
    >
      <p role="status" aria-live="polite" className="sr-only">{statusMessage}</p>
      <ChatHeader
        session={activeSession}
        sessionId={engineSessionId}
        models={models}
        modelsLoading={modelsLoading}
        modelsError={modelsError}
        selectedModel={activeSession?.model?.providerID && activeSession.model.id
          ? { providerID: activeSession.model.providerID, id: activeSession.model.id }
          : selectedModel}
        onSelectModel={model => void chooseModel(model)}
        onRetryModels={() => void loadModels()}
        modelsBusy={modelsBusy}
        link={engineLink}
        loading={loading}
        onOpenHistory={() => setHistoryOpen(true)}
        onOpenData={() => setDataOpen(true)}
        onOpenSystem={() => setSystemOpen(true)}
        onNewChat={() => clearConversation()}
      />
      <div className="flex min-h-0 flex-1">
        {historyOpen && !isMobile && (
          <aside aria-label="Chat history" data-testid="history-panel" className="hidden w-[292px] shrink-0 flex-col border-r border-[var(--line)] bg-[#141416] md:flex">
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">{historyPanel}</div>
          </aside>
        )}
        <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={logRef}
          role="log"
          aria-label="Conversation"
          aria-busy={busy || undefined}
          onScroll={onLogScroll}
          onWheel={onLogIntent}
          onTouchMove={onLogIntent}
          onKeyDown={event => {
            if (/^(PageUp|PageDown|Home|End|ArrowUp|ArrowDown)$/.test(event.key)) onLogIntent();
          }}
          className="min-h-0 flex-1 overflow-y-auto px-4 py-6 [mask-image:linear-gradient(to_bottom,transparent,#000_8px)] sm:px-6"
        >
          <div className="mx-auto w-full max-w-[832px]">
            {engineSessionId && (
              <div className="mb-6 flex flex-wrap items-center justify-end">
                <button
                  type="button"
                  onClick={() => setHistoryOpen(true)}
                  className="st-meta inline-flex min-h-11 items-center underline decoration-[var(--line-strong)] underline-offset-2 text-[var(--text-2)] transition-colors hover:text-[var(--text-1)] sm:min-h-8"
                >
                  Chat history
                </button>
              </div>
            )}

            {welcome && (
              <div className="mx-auto max-w-[680px] pt-4 sm:pt-12">
                <h1 className="max-w-[620px] text-3xl font-medium tracking-[-0.02em] text-[var(--text-1)] sm:text-4xl">Test a trading idea before you trust it.</h1>
                <p className="st-prose mt-4 text-[var(--text-2)]">
                  Describe a setup or upload a chart. Stragy screens the Nifty 50 on real daily data, shows every assumption, and runs a backtest only after you approve.
                </p>
                <div className="mt-7 grid gap-2 sm:grid-cols-3">
                  {STARTERS.map(starter => (
                    <button
                      key={starter.label}
                      type="button"
                      onClick={() => { setPrompt(''); void submitText(starter.text); }}
                      className={STARTER_CHIP_CLASS}
                    >
                      {starter.label}
                    </button>
                  ))}
                </div>
                <p className="st-meta mt-6 text-[var(--text-3)]">
                  Real NSE daily bars · assumptions shown before anything runs · no broker orders.
                </p>
              </div>
            )}

            <div className="space-y-6">
              {messages.map((message, index) => (
                <React.Fragment key={message.id}>
                {message.sender === 'user' ? (
                <article
                  ref={index === messages.length - 1 ? lastMessageRef : undefined}
                  className="flex justify-end"
                >
                  <div className="max-w-[min(560px,80%)] whitespace-pre-wrap break-words rounded-[16px] rounded-br-[6px] bg-[var(--surface-3)] px-3.5 py-2.5 text-[15px] leading-[22px] text-[var(--text-1)]">
                    {message.text}
                  </div>
                </article>
              ) : message.errorCode ? (
                <article
                  ref={index === messages.length - 1 ? lastMessageRef : undefined}
                  className="w-full"
                >
                  <EngineErrorCard
                    message={message.text}
                    code={message.errorCode}
                    {...(message.errorStatus ? { status: message.errorStatus } : {})}
                    retryable={message.errorRetryable !== false}
                    retrying={retryingEngine}
                    onRetry={() => void retryEngineTurn(message)}
                  />
                </article>
              ) : (
                <article
                  ref={index === messages.length - 1 ? lastMessageRef : undefined}
                  className="w-full space-y-2"
                >
                  {(!messages[index - 1] || messages[index - 1].sender === 'user') && (
                    <p className="st-meta text-[var(--text-3)]">Stragy</p>
                  )}
                  <div role={message.tone === 'error' ? 'alert' : undefined} className="flex gap-2">
                    {message.tone === 'error' && (
                      <span aria-hidden="true" className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--warn)]" />
                    )}
                    <div className="st-prose min-w-0 break-words text-[var(--text-1)]">
                      <MessageText text={message.text} />
                    </div>
                  </div>
                  {/* The card states the same provenance once (P1-9/Fix 3). */}
                  {message.methodLabel && message.id !== cardMessageId && !pastCards.some(card => card.messageId === message.id) && (
                    <p title={message.methodTitle} className="st-meta text-[var(--text-3)]">{message.methodLabel}</p>
                  )}
                  {message.warnings && message.warnings.length > 0 && (
                    <Disclosure summary={'Warnings (' + message.warnings.length + ')'}>
                      <ul className="list-disc space-y-1 pl-4">{message.warnings.map((warning, warningIndex) => <li key={warningIndex}>{warning}</li>)}</ul>
                    </Disclosure>
                  )}
                  {(() => {
                    const sources = sourcesFor(message.text);
                    return sources.length ? <Sources sources={sources} /> : null;
                  })()}
                  {liveActivity.anchorId === message.id ? (
                    <>
                      <AgentActivity
                        entries={liveActivity.entries}
                        running={liveActivity.running}
                        {...(liveActivity.currentStep ? { currentStep: liveActivity.currentStep } : {})}
                        {...(liveActivity.running ? { onStop: stopEngineTurn } : {})}
                      />
                      <AgentTodoList items={liveActivity.todos} />
                    </>
                  ) : (message.activity?.length || message.todos?.length) ? (
                    <>
                      <AgentActivity entries={message.activity ?? []} running={false} />
                      <AgentTodoList items={message.todos ?? []} />
                    </>
                  ) : null}
                  {(() => {
                    // Retry belongs to the latest answer only (older ones keep Copy),
                    // and an error reply's action is the card's own Retry.
                    const retryText = index === lastAssistantIndex && message.tone !== 'error' ? promptForMessage(index) : '';
                    return (
                      <ActionRow
                        actions={[
                          {
                            id: 'copy',
                            label: copiedMessageId === message.id ? 'Copied' : 'Copy answer',
                            icon: copiedMessageId === message.id
                              ? <Check size={14} aria-hidden="true" />
                              : <Copy size={14} aria-hidden="true" />,
                            onClick: () => void copyMessage(message),
                          },
                          ...(retryText ? [{
                            id: 'retry',
                            label: 'Retry',
                            icon: <RefreshCw size={14} aria-hidden="true" />,
                            onClick: () => void submitText(retryText),
                            disabled: busy,
                          }] : []),
                        ]}
                      />
                    );
                  })()}
                  {chartRetry?.messageId === message.id && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        const failed = chartRetry;
                        if (!failed) return;
                        setSentChartImage(failed.image);
                        void submitText(failed.hint, failed.image);
                      }}
                      className="st-meta inline-flex min-h-11 items-center gap-1.5 rounded-[var(--r-btn)] border border-[var(--line)] px-3 text-[var(--text-2)] transition-colors hover:border-[var(--line-strong)] hover:text-[var(--text-1)] disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-8"
                    >
                      <RefreshCw size={14} aria-hidden="true" /> Try again
                    </button>
                  )}
                </article>
                )}
                {workingAnchorId === message.id && <div className="space-y-6">{workingCards}</div>}
                {resultAnchorId === message.id && <div className="space-y-6">{resultCard}</div>}
                {restoredCards.filter(card => card.messageId === message.id).map(card => (
                  <div key={card.id} className="space-y-6">{restoredCardView(card)}</div>
                ))}
                {pastCards.filter(card => card.messageId === message.id).map(card => (
                  <div key={card.id} className="space-y-6">{pastCardView(card)}</div>
                ))}
                </React.Fragment>
              ))}

              {turnLong && loading && (
                <div role="status" data-testid="long-turn-note" className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--r-inner)] border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2">
                  <p className="st-meta flex min-w-0 items-center gap-2 text-[var(--text-2)]">
                    <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent)]" />
                    Still working on the server · reconnecting
                  </p>
                  <button type="button" onClick={stopEngineTurn} className="st-meta inline-flex min-h-11 items-center rounded-[var(--r-btn)] border border-[var(--line-strong)] px-3 text-[var(--text-2)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-1)] sm:min-h-8">
                    Stop
                  </button>
                </div>
              )}
              {turnExpired && (
                <div role="status" data-testid="long-turn-note" className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--r-inner)] border border-[var(--warn)]/30 bg-[var(--warn)]/[0.05] px-3 py-2.5">
                  <p className="st-meta min-w-0 text-[var(--text-2)]">Still running on the server — reload to resync. The chat is saved; nothing was discarded.</p>
                  <button type="button" onClick={() => window.location.reload()} className="st-meta inline-flex min-h-11 items-center rounded-[var(--r-btn)] border border-[var(--line-strong)] px-3 text-[var(--text-1)] transition-colors hover:bg-[var(--surface-hover)] sm:min-h-8">
                    Reload
                  </button>
                </div>
              )}
              {showPending && !scanPending && !turnHasActivity && !turnExpired && <AssistantPending />}
              {!workingAnchored && workingCards}
              {!resultAnchored && resultCard}
              {scanResult && !screenPlan && <EngineScanResultCard result={scanResult} />}
              {pastCards
                .filter(card => !card.messageId || !messages.some(message => message.id === card.messageId))
                .map(card => <div key={card.id} className="space-y-6">{pastCardView(card)}</div>)}
              {restoredCards
                .filter(card => !messages.some(message => message.id === card.messageId))
                .map(card => <div key={card.id} className="space-y-6">{restoredCardView(card)}</div>)}

              {(liveActivity.entries.length > 0 || liveActivity.todos.length > 0) && !messages.some(message => message.id === liveActivity.anchorId) && (
                <div className="space-y-0">
                  <AgentActivity
                    entries={liveActivity.entries}
                    running={liveActivity.running}
                    {...(liveActivity.currentStep ? { currentStep: liveActivity.currentStep } : {})}
                    {...(liveActivity.running ? { onStop: stopEngineTurn } : {})}
                  />
                  <AgentTodoList items={liveActivity.todos} />
                </div>
              )}

              {engineApproval && (
                <article aria-label="Engine approval">
                  <CardShell
                    tone="review"
                    density="compact"
                    title={engineApproval.title}
                    meta="The engine is waiting for your explicit approval. Nothing has run."
                    status="Approval pending"
                    statusBelow
                    footer={(
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void decideEngineApproval('approve')}
                          className="st-meta inline-flex min-h-11 items-center rounded-[var(--r-btn)] bg-[var(--accent)] px-3.5 font-semibold text-[var(--accent-ink)] transition-colors hover:bg-[var(--accent-strong)] sm:min-h-9"
                        >
                          Use these assumptions and run
                        </button>
                        <button
                          type="button"
                          onClick={() => void decideEngineApproval('reject')}
                          className="st-meta inline-flex min-h-11 items-center rounded-[var(--r-btn)] border border-[var(--line-strong)] px-3 text-[var(--text-2)] transition-colors hover:bg-[var(--surface-hover)] sm:min-h-9"
                        >
                          Not now
                        </button>
                      </div>
                    )}
                  >
                    {engineApproval.summary.length ? (
                      <ul className="list-disc space-y-1 pl-4">
                        {engineApproval.summary.map((item, index) => <li key={index} className="text-[13px] leading-5 text-[var(--text-2)]">{item}</li>)}
                      </ul>
                    ) : (
                      <p className="text-[13px] leading-5 text-[var(--text-2)]">Review the saved assumptions before approving this step.</p>
                    )}
                  </CardShell>
                </article>
              )}

              {interruptedJob && (
                <div role="alert" aria-label="Interrupted research" className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--r-inner)] border border-[var(--warn)]/30 bg-[var(--warn)]/[0.06] px-3 py-2.5">
                  <p className="st-meta min-w-0 flex-1 text-[var(--text-2)]">The server restarted mid-scan. The job was saved on the server; resume it to continue from the bars already fetched.</p>
                  <button
                    type="button"
                    onClick={() => void resumeInterrupted()}
                    className="st-meta inline-flex min-h-11 items-center gap-1.5 rounded-[var(--r-btn)] border border-[var(--line-strong)] px-3 font-semibold text-[var(--text-1)] transition-colors hover:bg-[var(--surface-hover)] sm:min-h-9"
                  >
                    <RefreshCw size={13} aria-hidden="true" /> Resume
                  </button>
                </div>
              )}

              <div ref={endRef} />
            </div>
          </div>
        </div>

        {messages.length > 0 && (
          <div className="h-[52px] shrink-0 sm:h-10">
            <div className="mx-auto flex h-full w-full max-w-[832px] items-start justify-end px-4 sm:px-6">
              {jumpVisible && (
                <button
                  type="button"
                  data-testid="jump-to-latest"
                  onClick={() => scrollToLatest()}
                  className="st-meta inline-flex min-h-11 items-center rounded-[var(--r-pill)] border border-[var(--line)] bg-[var(--surface-2)] px-3 text-[var(--text-2)] transition-colors hover:text-[var(--text-1)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] sm:min-h-8"
                >
                  Jump to latest
                </button>
              )}
            </div>
          </div>
        )}

      <div className="shrink-0 border-t border-[var(--line)] bg-[#111113] px-4 py-3 sm:px-6 sm:py-4">
        <div className="mx-auto w-full max-w-[832px] space-y-2">
          {applyStatus && <p role="status" className="st-meta text-[var(--text-3)]">{applyStatus}</p>}
          {engineNote && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p role="status" className="st-meta min-w-0 text-[var(--text-3)]">{engineNote}</p>
            </div>
          )}
          {engineStatus === 'ready' && engineLink === 'reconnecting' && (
            <p role="status" className="st-meta text-[#f5d383]">Reconnecting to the engine — the saved conversation stays.</p>
          )}
          {voiceNote && <p role="status" className="st-meta text-[#f5d383]">{voiceNote}</p>}
          {clipboardStatus && <p role="status" className="st-meta text-[var(--text-3)]">{clipboardStatus}</p>}
          {saveStatus && <p role="status" className="st-meta text-[var(--text-3)]">{saveStatus}</p>}
          {error && <p role="alert" className="st-meta text-[var(--down)]">{error}</p>}
          {reviewStatus === 'running' && runPhase !== 'waiting' && (
            <p role="status" className="st-meta text-[var(--text-2)]">Backtest running on the reviewed assumptions…</p>
          )}

          <form
            onSubmit={send}
            data-testid="research-composer"
            onDragEnter={event => {
              if (Array.from(event.dataTransfer?.types ?? []).includes('Files')) setDragActive(true);
            }}
            onDragOver={event => {
              if (Array.from(event.dataTransfer?.types ?? []).includes('Files')) {
                event.preventDefault();
                setDragActive(true);
              }
            }}
            onDragLeave={event => {
              if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragActive(false);
            }}
            onDrop={dropChartImage}
          >
            <label htmlFor="copilot-prompt" className="sr-only">Research request</label>
            <div className={(dragActive ? 'border-[var(--accent)]/60 bg-[var(--accent)]/[0.06]' : 'border-[var(--line-strong)] bg-[#18181b]') + ' rounded-[16px] border px-3 py-2 transition-colors focus-within:[outline:2px_solid_rgba(168,199,250,0.75)] focus-within:[outline-offset:2px]'}>
              {chartImage && (
                <div className="mb-2 flex items-center gap-2 rounded-[var(--r-inner)] bg-[var(--surface-2)] p-2">
                  <img src={chartImage.dataUrl} alt="Attached chart preview" className="h-12 w-16 shrink-0 rounded object-cover" />
                  <div className="min-w-0 flex-1 text-[12px] leading-4">
                    <p className="truncate text-[var(--text-2)]">{chartImage.name}</p>
                    <p className="text-[var(--text-3)]">{fileSizeLabel(chartImage.bytes)}{chartImage.downscaled ? ' · resized for upload' : ''}</p>
                  </div>
                  <button
                    type="button"
                    aria-label="Remove attached chart image"
                    onClick={discardChartImage}
                    className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-[var(--r-btn)] text-[var(--text-3)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-1)] sm:min-h-8 sm:min-w-8"
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                </div>
              )}
              {preparingImage && <p role="status" className="st-meta mb-1 px-1 text-[var(--text-3)]">Preparing chart image…</p>}
              {imageError && <p role="alert" className="st-meta mb-1 px-1 text-[var(--down)]">{imageError}</p>}
              {dragActive && <p className="st-meta mb-1 px-1 text-[var(--accent)]">Drop a chart image to attach it.</p>}
              {listening && (
                <p role="status" className="st-meta mb-1 flex items-center gap-2 px-1 text-[var(--accent)]">
                  <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent)]" />
                  Listening… the transcript appears below for review; nothing sends automatically.
                </p>
              )}
              <textarea
                id="copilot-prompt"
                ref={promptRef}
                rows={1}
                maxLength={4000}
                value={prompt}
                onChange={event => {
                  setPrompt(event.target.value);
                  if (scanPending) cancelPendingRequest();
                }}
                onPaste={pasteChartImage}
                onKeyDown={onComposerKeyDown}
                placeholder={chartImage ? 'Optional hint for this chart…' : 'Describe what you want to research…'}
                // The global :focus-visible ring would draw inside the composer box;
                // the wrapper carries the single ring instead (P0-4 double ring).
                style={{ outline: 'none' }}
                className="max-h-[136px] min-h-11 w-full resize-none overflow-y-auto bg-transparent px-1 py-2.5 text-[15px] leading-6 text-[var(--text-1)] caret-[var(--accent)] placeholder:text-[var(--text-3)]"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-0.5">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={CHART_IMAGE_ACCEPT}
                    aria-label="Chart image file"
                    tabIndex={-1}
                    className="sr-only"
                    onChange={event => {
                      const file = event.currentTarget.files?.[0];
                      event.currentTarget.value = '';
                      void attachChartFile(file);
                    }}
                  />
                  <button
                    type="button"
                    aria-label="Attach chart image"
                    title="Attach a chart image (PNG, JPEG or WebP up to 5 MB)"
                    disabled={loading || reviewStatus === 'running' || preparingImage || !!pendingApply.current}
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-[var(--r-btn)] text-[var(--text-3)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-1)] disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-8 sm:min-w-8"
                  >
                    <ImagePlus size={15} aria-hidden="true" />
                  </button>
                  {/* Push-to-talk: browser STT first, recorder fallback. 44px target. */}
                  <button
                    type="button"
                    aria-label={listening ? 'Stop voice input' : 'Start voice input'}
                    aria-pressed={listening}
                    title={voiceInputSupported ? 'Dictate your message (the transcript is not sent automatically)' : 'Voice input is not available in this browser'}
                    disabled={loading || reviewStatus === 'running' || preparingImage || !!pendingApply.current}
                    onClick={() => void toggleVoiceInput()}
                    className={(listening ? 'text-[var(--accent)] ' : 'text-[var(--text-3)] ') + 'inline-flex min-h-11 min-w-11 items-center justify-center rounded-[var(--r-btn)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-1)] disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-8 sm:min-w-8'}
                  >
                    {listening ? <MicOff size={15} aria-hidden="true" /> : <Mic size={15} aria-hidden="true" />}
                  </button>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {/* Spoken replies are a persisted, opt-in preference. */}
                  <button
                    type="button"
                    aria-label={voiceMode ? 'Turn voice replies off' : 'Turn voice replies on'}
                    aria-pressed={voiceMode}
                    title={voiceOutputSupported ? 'Read assistant answers aloud' : 'Voice replies are not available in this browser'}
                    disabled={!voiceOutputSupported}
                    onClick={toggleVoiceMode}
                    className={(voiceMode ? 'text-[var(--accent)] ' : 'text-[var(--text-3)] ') + 'inline-flex min-h-11 min-w-11 items-center justify-center rounded-[var(--r-btn)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-1)] disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-8 sm:min-w-8'}
                  >
                    {voiceMode ? <Volume2 size={15} aria-hidden="true" /> : <VolumeX size={15} aria-hidden="true" />}
                  </button>
                  {/* One control in this slot: send, or cancel legacy work. An engine
                      turn is stopped from its activity strip, so this slot stays empty. */}
                  {busy && !engineTurnInFlight ? (
                    <button
                      type="button"
                      onClick={reviewStatus === 'running' ? cancelRun : cancelPendingRequest}
                      className="st-meta inline-flex min-h-11 items-center whitespace-nowrap rounded-[10px] border border-[var(--line-strong)] px-3.5 text-[var(--text-2)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-1)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] sm:min-h-9"
                    >
                      Cancel research
                    </button>
                  ) : engineTurnInFlight ? (
                    <button
                      type="button"
                      disabled
                      title="The engine is still working. Stop the turn to send another message."
                      aria-label="Stop first — the engine is still working"
                      className="st-meta inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-[10px] border border-[var(--line-strong)] px-3.5 text-[var(--text-3)] disabled:cursor-not-allowed sm:min-h-9"
                    >
                      Stop first
                    </button>
                  ) : !busy ? (
                    <button
                      type="submit"
                      disabled={!canSubmit}
                      className="st-meta inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-[10px] bg-[var(--accent)] px-3.5 font-semibold text-[var(--accent-ink)] transition-colors hover:bg-[var(--accent-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-9"
                    >
                      <Send size={13} aria-hidden="true" />
                      Send request
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </form>
          {engineTurnInFlight && (
            <p className="st-meta text-[var(--text-3)]">The engine is still working. Stop the turn before sending another message.</p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <p className="st-meta hidden text-[var(--text-3)] sm:block">Enter to send · Shift+Enter for a new line · no broker orders</p>
            <p className="st-meta text-[var(--text-3)]">
              {engineConversation ? (
                <>
                  <span className="sm:hidden">Conversation saved on the server · not investment advice</span>
                  <span className="hidden sm:inline">Conversation saved on the server. Research output is not investment advice.</span>
                </>
              ) : (
                <>
                  <span className="sm:hidden">Messages are saved once an engine chat starts · not investment advice</span>
                  <span className="hidden sm:inline">A new chat starts empty; messages are saved on the server once the engine session starts. Research output is not investment advice.</span>
                </>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {onClose && (
              <button type="button" onClick={onClose} className="st-meta inline-flex min-h-11 items-center gap-1 text-[var(--text-3)] transition-colors hover:text-[var(--text-1)] sm:min-h-8">
                <X size={12} aria-hidden="true" /> Close chat
              </button>
            )}
          </div>
        </div>
        </div>
      </div>
      </div>
      {isMobile && (
        <SlideOver open={historyOpen} title="Chat history" side="left" onClose={() => setHistoryOpen(false)} testId="history-panel">
          {historyPanel}
        </SlideOver>
      )}
      <DataCachePanel open={dataOpen} onClose={() => setDataOpen(false)} universe={dataUniverse} />
      <SystemPanel
        open={systemOpen}
        onClose={() => setSystemOpen(false)}
        activeSessionId={engineSessionId}
        activeSession={activeSession}
      />
    </section>
  );
};
