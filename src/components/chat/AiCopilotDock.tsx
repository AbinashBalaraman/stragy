import React, { useEffect, useRef, useState } from 'react';
import { Send, X, Plus, ImagePlus, MoreHorizontal } from 'lucide-react';
import { z } from 'zod';
import type { BacktestResponse, StrategyAST, SymbolMeta } from '../../shared/strategy/types';
import { snapshotStrategy } from '../../client/workspace';
import { canonicalStrategySignature, exitRuleCompatibility } from '../../shared/strategy/backtestReview';
import { assertProposalCurrent, parseStrategyProposal, type StrategyProposal } from '../../shared/contracts/ai-proposal';
import { requestScan, type RunRequestOptions, type ScanResult } from '../../client/api';
import { requestResearchChat } from '../../client/researchChat';
import { requestFeatureSetup } from '../../client/featureSetup';
import { FEATURE_PREFILL_EVENT, parseFeaturePrefill, publishFeaturePrefill } from '../../client/featureHandoff';
import { readPreferences, rememberPreference } from '../../client/preferences';
import { getSymbolById } from '../../shared/data/symbols';
import { prepareChartImage, requestChartAnalysis, CHART_IMAGE_ACCEPT, type ChartAnalysisResponse, type ChartImageAttachment, type ChartImageReading } from '../../client/chartAnalysis';
import { chartImageHash, readCachedChartAnalysis, writeCachedChartAnalysis } from '../../client/chartReadingCache';
import { validateStrategy } from '../../shared/strategy/schema';
import type { ResearchChatResponse, ResearchScreenPlan } from '../../shared/contracts/research-chat';
import { ScreenResultCard } from './ScreenResultCard';
import { ChartReadingCard } from './ChartReadingCard';
import { BacktestResultCard } from './BacktestResultCard';
import { BacktestReviewCard } from './BacktestReviewCard';
import { AssistantPending } from './AssistantPending';
import { MessageText } from './MessageText';
import type { BacktestReview } from './types';
import { summarizeRunData } from './runSummary';
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
}

const MessageSchema = z.object({
  id: z.string(),
  sender: z.enum(['user', 'assistant']),
  text: z.string().max(6000),
  timestamp: z.number().finite(),
  methodLabel: z.string().max(300).optional(),
  methodTitle: z.string().max(300).optional(),
  warnings: z.array(z.string().max(2000)).max(20).optional(),
  retryPrompt: z.string().max(4000).optional(),
});
const MessageListSchema = z.array(MessageSchema).max(40);
const HISTORY_KEY = 'stragy_copilot_review_history_v2';
const ARCHIVE_KEY = 'stragy_copilot_previous_conversation_v1';

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

function loadMessages(key: string): ChatMessage[] {
  try { return MessageListSchema.parse(JSON.parse(localStorage.getItem(key) ?? '[]')); } catch { return []; }
}

function saveMessages(key: string, messages: ChatMessage[]): boolean {
  try { localStorage.setItem(key, JSON.stringify(messages.slice(-40))); return true; } catch { return false; }
}

type Proposal = StrategyProposal & { sourceSnapshot: string; validatedCandidate: StrategyAST };

const STARTERS = [
  { label: 'Nifty 50: RSI oversold after overbought', text: 'Find Nifty 50 RSI oversold stocks after recently overbought' },
  { label: 'Set my stop loss to 3%', text: 'Set my stop loss to 3%' },
  { label: 'Use a 2% trailing stop', text: 'Set my trailing stop to 2%' },
];

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
  if (method === 'rule_parser') return 'Built-in rule parser · not AI';
  return 'Unavailable · no result was invented';
};

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

const DRAFT_MENU_ITEM = 'st-meta flex w-full items-center gap-2 rounded-[var(--r-btn)] px-2.5 py-2 text-left text-[var(--text-2)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-1)] disabled:cursor-not-allowed disabled:text-[var(--text-disabled)]';

/** A screen response can carry the contract-validated chart fields directly. */
function chartReadingFromScreen(plan: ResearchScreenPlan): ChartImageReading | null {
  if (plan.source !== 'chart_image' || !plan.observations || plan.confidence === undefined || plan.summary === undefined) return null;
  return { source: plan.source, observations: plan.observations, confidence: plan.confidence, summary: plan.summary };
}

/** A run may only complete the exact reviewed strategy on the same instrument and cutoff. */
function isCurrentReviewResult(result: BacktestResponse | null | void | undefined, review: BacktestReview): result is BacktestResponse {
  if (!result || typeof result !== 'object') return false;
  if (typeof result.backtestId !== 'string'
    || !result.metrics || typeof result.metrics !== 'object'
    || !Array.isArray(result.bars) || !Array.isArray(result.trades)) return false;
  if (result.symbol?.ticker !== review.symbol.ticker || result.symbol?.id !== review.symbol.id) return false;
  if (result.strategy?.universe?.symbolId !== review.symbol.id) return false;
  const resultSignature = canonicalStrategySignature(result.strategy);
  if (!resultSignature || resultSignature !== review.strategySignature) return false;
  if (review.asOf && summarizeRunData(result).observedThrough !== review.asOf) return false;
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
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadMessages(HISTORY_KEY));
  const [archivedMessages, setArchivedMessages] = useState<ChatMessage[]>(() => loadMessages(ARCHIVE_KEY));
  const [prompt, setPrompt] = useState('');
  const [chartImage, setChartImage] = useState<ChartImageAttachment | null>(null);
  const [chartReading, setChartReading] = useState<ChartImageReading | null>(null);
  const [preparingImage, setPreparingImage] = useState(false);
  const [imageError, setImageError] = useState('');
  const [dragActive, setDragActive] = useState(false);
  /** The last image that was sent, kept so the chart card can show it (P1-3). */
  const [sentChartImage, setSentChartImage] = useState<ChartImageAttachment | null>(null);
  /** Auto-scroll only while the reader is at the bottom (P0-6). */
  const [pinned, setPinned] = useState(true);
  const [pendingDraftBacktest, setPendingDraftBacktest] = useState<string | null>(null);
  const [screenPlan, setScreenPlan] = useState<ResearchScreenPlan | null>(null);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scanPending, setScanPending] = useState(false);
  const scanPendingRef = useRef(false);
  const [scanError, setScanError] = useState('');
  /** A chart reading must be confirmed/edited before any scan starts. */
  const [awaitingChartConfirm, setAwaitingChartConfirm] = useState(false);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [allowLocal, setAllowLocal] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [applied, setApplied] = useState<string | null>(null);
  const [applyStatus, setApplyStatus] = useState('');
  const [clipboardStatus, setClipboardStatus] = useState('');
  const [saveStatus, setSaveStatus] = useState('');
  const [historyStatus, setHistoryStatus] = useState('History stays in this browser.');
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
  const pinnedRef = useRef(true);
  const draftMenuRef = useRef<HTMLDetailsElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const imageGeneration = useRef(0);
  const snapshot = JSON.stringify(strategy);
  const full = variant === 'full';
  const busy = loading || scanPending || reviewStatus === 'running';
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
      setError('The workspace changed, so the previous backtest review was set aside. Prepare a fresh review. Nothing was run.');
    }
    setValidatedResult(null);
    setChartReading(null);
    setAwaitingChartConfirm(false);
    abort.current?.abort();
    setLoading(false);
    scanPendingRef.current = false;
    setScanPending(false);
    setScanError('');
    if (!pendingApply.current) setProposal(null);
    setClipboardStatus('');
    setSaveStatus('');
  }, [snapshot]);

  useEffect(() => () => {
    generation.current++;
    clipboardGeneration.current++;
    runGeneration.current++;
    imageGeneration.current++;
    pendingApply.current = null;
    abort.current?.abort();
  }, []);

  useEffect(() => {
    const saved = saveMessages(HISTORY_KEY, messages);
    setHistoryStatus(saved ? 'History stays in this browser.' : 'History was not saved: browser storage is unavailable.');
  }, [messages]);

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

  const scrollToLatest = (behavior: ScrollBehavior = 'smooth') => {
    const log = logRef.current;
    if (!log) return;
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (typeof log.scrollTo === 'function') log.scrollTo({ top: log.scrollHeight, behavior: reduce ? 'auto' : behavior });
    else log.scrollTop = log.scrollHeight;
    pinnedRef.current = true;
    setPinned(true);
  };

  const revealCard = (card: Element | null) => {
    const log = logRef.current;
    if (!log || !(card instanceof HTMLElement)) return;
    if (!pinnedRef.current) return;
    const logBox = log.getBoundingClientRect();
    const box = card.getBoundingClientRect();
    if (box.height > log.clientHeight - 16) {
      log.scrollTop += box.top - logBox.top - 8;
      return;
    }
    scrollToLatest('auto');
  };

  const onLogScroll = () => {
    const log = logRef.current;
    if (!log) return;
    const next = log.scrollHeight - log.scrollTop - log.clientHeight <= NEAR_BOTTOM;
    if (next !== pinnedRef.current) {
      pinnedRef.current = next;
      setPinned(next);
    }
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
    if (pinnedRef.current) scrollToLatest('auto');
  }, [messages]);

  // Reveal the newest card once, and only when the reader is at the bottom.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const cards = logRef.current?.querySelectorAll('article[aria-label="Research screen"], article[aria-label="Chart reading"], article[aria-label="Backtest review"], article[aria-label="Backtest result"], article[aria-label="Draft proposal"]');
      const card = cards && cards.length ? cards[cards.length - 1] : null;
      if (!card || card === revealedCard.current) return;
      revealedCard.current = card;
      revealCard(card);
    }, 80);
    return () => window.clearTimeout(timer);
  }, [messages, scanResult, review, validatedResult, chartReading, proposal]);

  // The composer grows with the prompt up to five rows (P2-1) and never moves the log.
  useEffect(() => {
    const element = promptRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = Math.min(Math.max(element.scrollHeight || 0, 44), 136) + 'px';
  }, [prompt]);

  const append = (sender: ChatMessage['sender'], text: string, extras: Pick<ChatMessage, 'methodLabel' | 'methodTitle' | 'warnings' | 'retryPrompt'> = {}) => {
    setMessages(old => [...old, {
      id: Date.now() + '-' + old.length,
      sender,
      text,
      timestamp: Date.now(),
      ...extras,
    }].slice(-40));
  };

  const rememberCurrentConversation = (current: ChatMessage[]) => {
    if (!current.length) return;
    const archived = current.slice(-40);
    setArchivedMessages(archived);
    saveMessages(ARCHIVE_KEY, archived);
  };

  const discardChartImage = () => {
    imageGeneration.current++;
    setChartImage(null);
    setPreparingImage(false);
    setImageError('');
    setDragActive(false);
  };

  const clearConversation = () => {
    generation.current++;
    runGeneration.current++;
    clipboardGeneration.current++;
    abort.current?.abort();
    onCancelResearch?.();
    discardChartImage();
    rememberCurrentConversation(messages);
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
    pendingApply.current = null;
  };

  const restorePreviousConversation = () => {
    const current = messages;
    const previous = archivedMessages;
    // Restoring is a conversation switch: any in-flight screen, draft, review or
    // validated result belongs to the conversation being archived and must be
    // discarded rather than attached to the restored one.
    generation.current++;
    runGeneration.current++;
    clipboardGeneration.current++;
    abort.current?.abort();
    onCancelResearch?.();
    discardChartImage();
    reviewRef.current = null;
    pendingApply.current = null;
    setMessages(previous);
    if (current.length) {
      setArchivedMessages(current);
      saveMessages(ARCHIVE_KEY, current);
    } else {
      setArchivedMessages([]);
      try { localStorage.removeItem(ARCHIVE_KEY); } catch { /* Storage may be unavailable. */ }
    }
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
  };

  const cancelPendingRequest = () => {
    generation.current++;
    abort.current?.abort();
    setLoading(false);
    scanPendingRef.current = false;
    setScanPending(false);
    setScanError('Cancelled. No results were confirmed.');
  };

  function selectBaseContext(sourceType: 'screen' | 'draft' | 'workspace'): { strategy: StrategyAST; asOf?: string; sourceLabel: string; assumptions: string[] } | null {
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
  const supersedeReview = () => {
    if (!reviewRef.current) return;
    runGeneration.current++;
    reviewRef.current = null;
    setReview(null);
    setReviewStatus('idle');
    setReviewError('');
    append('assistant', 'The previous backtest review was set aside because you started a new research request. Nothing was run.');
  };

  const prepareReview = (sourceType: 'screen' | 'draft' | 'workspace', symbol: SymbolMeta, asOfOverride?: string) => {
    supersedeReview();
    const base = selectBaseContext(sourceType);
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
      append('assistant', 'I prepared a backtest review for ' + symbol.ticker + '. Nothing has been applied or run. Review the assumptions, then choose “Use these assumptions and run”.');
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
        append('assistant', 'Choose which strategy to backtest on ' + resolution.symbol.ticker + ': the screen or your workspace strategy. Nothing has been run.');
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

  const runReview = async () => {
    if (!review || reviewStatus === 'running' || !onResearchBacktest) return;
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
      setValidatedResult(outcome);
      setReviewStatus('complete');
      append('assistant', 'Backtest completed. The headline below comes from the validated run response; open details for trades, costs and provenance.');
    } catch (caught) {
      if (runGeneration.current !== owned) return;
      setReviewStatus('idle');
      setReviewError((caught as Error).message);
      append('assistant', 'The backtest did not complete: ' + (caught as Error).message + ' No results were invented.');
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

  async function runScreenScan(plan: ResearchScreenPlan, controller: AbortController, owned: number) {
    const scanned = await requestScan({
      universe: plan.universe,
      strategy: plan.strategy,
      limit: 100,
      ...(plan.asOf ? { asOf: plan.asOf } : {}),
    }, controller.signal);
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
    rememberPreference({ universe: 'NIFTY_50' });
  }

  const confirmChartScan = async (edited: StrategyAST) => {
    if (!screenPlan || scanPendingRef.current) return;
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
      if (generation.current === owned && !controller.signal.aborted) setScanError((caught as Error).message);
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
      if (generation.current === owned && !controller.signal.aborted) setScanError((caught as Error).message);
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
      setError((caught as Error).message);
      return true;
    } finally {
      setLoading(false);
    }
  };

  const submitText = async (raw: string, attachedImage: ChartImageAttachment | null = null) => {
    const text = raw.trim();
    if ((!text && !attachedImage) || loading || reviewStatus === 'running' || pendingApply.current) return;
    append('user', attachedImage ? '[chart image attached]' : text);
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
      setChartReading(null);
      setScreenPlan(null);
      setAwaitingChartConfirm(false);
      setLastContext(null);
    setBacktestChoice(null);
    }

    let current: StrategyAST;
    try { current = snapshotStrategy(strategy); } catch (caught) { setError((caught as Error).message); return; }
    const sourceSnapshot = JSON.stringify(strategy);
    const originatingRevision = revision.current;
    const owned = ++generation.current;
    abort.current?.abort();
    // A new request supersedes any in-flight scan. The old scan's finally block
    // is generation-guarded, so explicitly clear its pending state here.
    const hadPendingScan = scanPendingRef.current;
    scanPendingRef.current = false;
    setScanPending(false);
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
      let data: ChartAnalysisResponse | ResearchChatResponse;
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
        data = await requestResearchChat({
          message: text,
          currentStrategy: current,
          originatingRevision,
          allowLocalFallback: allowLocal,
          history: messages.slice(-20).map(message => ({ role: message.sender, text: message.text })),
          ...(screenPlan ? { screenContext: { strategy: screenPlan.strategy, universe: screenPlan.universe } } : {}),
        }, controller.signal);
      }
      if (generation.current !== owned) return;
      // Chart analysis has no workspace revision handshake; its owner generation
      // already discards results after a workspace change.
      if (!attachedImage && data.originatingRevision !== originatingRevision) throw new Error('This research response is stale.');
      const receivedChartReading: ChartImageReading | null =
        (data as ChartAnalysisResponse).chartReading ?? (data.kind === 'screen' ? chartReadingFromScreen(data) : null);
      // A deterministic market answer is a successful local result, not a provider failure.
      const deterministicMarket = data.method === 'unavailable'
        && data.warnings.some(warning => warning.startsWith('Deterministic answer'));
      const providerFailure = data.method === 'unavailable' && !deterministicMarket ? providerFailureFor(data.message) : null;
      if (providerFailure) {
        append('assistant', providerFailure.text, {
          methodLabel: 'AI unavailable',
          warnings: [...(data.warnings ?? []), providerFailure.detail],
          retryPrompt: text,
        });
      } else {
        append('assistant', data.message, {
          methodLabel: chartCacheUsed ? 'Cached chart reading · same image (SHA-256)' : deterministicMarket ? 'Built-in market data · not AI' : methodLabel(data.method, data.provider),
          methodTitle: data.provider.aiGenerated
            ? `Answered by ${data.provider.name}. Verify factual claims with data.`
            : undefined,
          warnings: data.warnings,
        });
      }
      if (data.method === 'unavailable' && !deterministicMarket && !providerFailure) setError(data.message);

      if (data.kind === 'proposal') {
        const parsed = parseStrategyProposal(data.proposal);
        assertProposalCurrent(parsed, originatingRevision, sourceSnapshot, JSON.stringify(strategy));
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
            if (generation.current === owned && !controller.signal.aborted) setScanError((caught as Error).message);
          } finally {
            if (generation.current === owned) {
              scanPendingRef.current = false;
              setScanPending(false);
            }
          }
        }
      } else {
        // A conversational reply cannot leave an earlier scan marked pending.
        scanPendingRef.current = false;
        setScanPending(false);
        if (attachedImage) setChartReading(null);
      }
    } catch (caught) {
      if (generation.current === owned && !controller.signal.aborted) setError((caught as Error).message);
    } finally {
      if (generation.current === owned) setLoading(false);
    }
  };

  const submitComposer = () => {
    if (!canSubmit) return;
    const text = prompt;
    const image = chartImage;
    setPrompt('');
    if (image) {
      // The card must still show the image after send (P1-3).
      setSentChartImage(image);
      discardChartImage();
    }
    // Focus stays in the composer: sending never drops it to <body> (P0-3).
    promptRef.current?.focus();
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
      if (pendingApply.current === pending && accepted === true) {
        pendingApply.current = null;
        setApplied(pending.id);
        setApplyStatus(successMessage);
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
        setError((caught as Error).message);
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
    } catch (caught) { setError((caught as Error).message); return false; }
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
    setPendingDraftBacktest(id);
    const ok = await apply();
    if (!ok) setPendingDraftBacktest(null);
  };

  useEffect(() => {
    if (!pendingDraftBacktest || applied !== pendingDraftBacktest) return;
    setPendingDraftBacktest(null);
    const symbol = symbols.find(candidate => candidate.id === strategy.universe.symbolId);
    if (symbol) prepareReview('workspace', symbol);
    else append('assistant', 'The draft is applied, but it has no stock yet. Choose a symbol in the tester, then review a backtest.');
  }, [pendingDraftBacktest, applied, strategy, symbols]);

  const applyScreenDraft = async (override?: StrategyAST) => {
    if (!screenPlan || !onApplyVariation || pendingApply.current) return;
    if (applied?.startsWith('screen:')) return;
    let candidate: StrategyAST;
    try { candidate = snapshotStrategy(override ?? screenPlan.strategy); }
    catch (caught) { setError((caught as Error).message); return; }
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
  const historySaved = historyStatus === 'History stays in this browser.';
  // ONE polite announcement for the whole conversation: start and finish only.
  const statusMessage = loading
    ? 'Stragy is working on your request.'
    : scanPending
      ? 'Screen running.'
      : reviewStatus === 'running'
        ? 'Backtest running.'
        : messages.length ? 'Response ready.' : '';

  const closeDraftMenu = () => { if (draftMenuRef.current) draftMenuRef.current.open = false; };

  return (
    <section
      aria-label="Research conversation"
      className={(full ? 'h-full' : 'h-full border-l border-[var(--line)]') + ' flex min-h-0 flex-col bg-[#111113]'}
      onKeyDown={event => { if (event.key === 'Escape' && onClose) onClose(); }}
    >
      <p role="status" aria-live="polite" className="sr-only">{statusMessage}</p>
      <div className="relative min-h-0 flex-1">
        <div
          ref={logRef}
          role="log"
          aria-label="Conversation"
          aria-busy={busy || undefined}
          onScroll={onLogScroll}
          className="absolute inset-0 min-h-0 overflow-y-auto px-4 py-6 [mask-image:linear-gradient(to_bottom,transparent,#000_8px)] sm:px-6"
        >
          <div className="mx-auto w-full max-w-[832px]">
            {archivedMessages.length > 0 && (
              <div className="st-meta mb-6 flex flex-wrap items-center justify-between gap-2 rounded-[var(--r-inner)] bg-[var(--surface-2)] px-3 py-2 text-[var(--text-2)]">
                <span>A previous conversation is saved in this browser.</span>
                <button type="button" onClick={restorePreviousConversation} className="inline-flex min-h-11 items-center underline decoration-[var(--line-strong)] underline-offset-2 transition-colors hover:text-[var(--text-1)] sm:min-h-8">
                  Restore previous conversation ({archivedMessages.length})
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
                      className="flex min-h-11 items-center rounded-[var(--r-inner)] bg-[var(--surface-2)] px-3.5 py-2.5 text-left st-meta text-[var(--text-2)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-1)] sm:min-h-12"
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
              {messages.map((message, index) => message.sender === 'user' ? (
                <article
                  key={message.id}
                  ref={index === messages.length - 1 ? lastMessageRef : undefined}
                  className="flex justify-end"
                >
                  <div className="max-w-[min(560px,80%)] whitespace-pre-wrap break-words rounded-[16px] rounded-br-[6px] bg-[var(--surface-3)] px-3.5 py-2.5 text-[15px] leading-[22px] text-[var(--text-1)]">
                    {message.text}
                  </div>
                </article>
              ) : (
                <article
                  key={message.id}
                  ref={index === messages.length - 1 ? lastMessageRef : undefined}
                  className="w-full space-y-2"
                >
                  {(!messages[index - 1] || messages[index - 1].sender === 'user') && (
                    <p className="st-meta text-[var(--text-3)]">Stragy</p>
                  )}
                  <div className="st-prose break-words text-[var(--text-1)]"><MessageText text={message.text} /></div>
                  {message.methodLabel && <p title={message.methodTitle} className="st-meta text-[var(--text-3)]">{message.methodLabel}</p>}
                  {message.warnings && message.warnings.length > 0 && (
                    <Disclosure summary={'Warnings (' + message.warnings.length + ')'}>
                      <ul className="list-disc space-y-1 pl-4">{message.warnings.map((warning, warningIndex) => <li key={warningIndex}>{warning}</li>)}</ul>
                    </Disclosure>
                  )}
                  {message.retryPrompt && (
                    <button
                      type="button"
                      onClick={() => void submitText(message.retryPrompt!)}
                      className="st-meta inline-flex min-h-11 items-center rounded-[var(--r-btn)] border border-[var(--line-strong)] px-3 text-[var(--text-2)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-1)] sm:min-h-8"
                    >
                      Retry
                    </button>
                  )}
                </article>
              ))}

              {loading && !scanPending && <AssistantPending />}

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

              {validatedResult && <BacktestResultCard result={validatedResult} onOpenDetails={() => onOpenDetails?.(validatedResult)} />}
              <div ref={endRef} />
            </div>
          </div>
        </div>

        {!pinned && messages.length > 0 && (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-end pr-3">
            <button
              type="button"
              data-testid="jump-to-latest"
              onClick={() => scrollToLatest()}
              className="pointer-events-auto st-meta inline-flex min-h-11 items-center rounded-[var(--r-pill)] border border-[var(--line)] bg-[var(--surface-2)] px-3 text-[var(--text-2)] shadow-[0_8px_24px_rgba(0,0,0,0.45)] transition-colors hover:text-[var(--text-1)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] sm:min-h-8"
            >
              Jump to latest
            </button>
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-[var(--line)] bg-[#111113] px-4 py-3 sm:px-6 sm:py-4">
        <div className="mx-auto w-full max-w-[832px] space-y-2">
          {applyStatus && <p role="status" className="st-meta text-[var(--text-3)]">{applyStatus}</p>}
          {clipboardStatus && <p role="status" className="st-meta text-[var(--text-3)]">{clipboardStatus}</p>}
          {saveStatus && <p role="status" className="st-meta text-[var(--text-3)]">{saveStatus}</p>}
          {error && <p role="alert" className="st-meta text-[var(--down)]">{error}</p>}
          {reviewStatus === 'running' && <p role="status" className="st-meta text-[var(--text-2)]">Backtest running on the reviewed assumptions…</p>}

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
                  <details className="relative text-[12px] text-[var(--text-3)]">
                    <summary aria-label="Request options" className="flex min-h-11 cursor-pointer list-none items-center whitespace-nowrap rounded-[var(--r-btn)] px-2 transition-colors hover:text-[var(--text-1)] [&::-webkit-details-marker]:hidden sm:min-h-8">
                      <span className="sm:hidden">Options</span>
                      <span className="hidden sm:inline">Request options</span>
                    </summary>
                    <div className="absolute bottom-full left-0 z-20 mb-2 w-64 rounded-[var(--r-inner)] border border-[var(--line)] bg-[var(--surface-2)] p-3 shadow-[0_12px_32px_rgba(0,0,0,0.45)]">
                      <label className="flex items-start gap-2 text-[12px] leading-4 text-[var(--text-2)]">
                        <input type="checkbox" checked={allowLocal} onChange={event => setAllowLocal(event.target.checked)} className="mt-0.5" />
                        Allow local keyword fallback (not AI)
                      </label>
                      <p className="mt-2 text-[12px] leading-4 text-[var(--text-3)]">Local tools only understand explicit stop, target, trailing-stop and symbol edits.</p>
                    </div>
                  </details>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {/* One control in this slot: send, or cancel while a request runs. */}
                  {busy ? (
                    <button
                      type="button"
                      onClick={reviewStatus === 'running' ? cancelRun : cancelPendingRequest}
                      className="st-meta inline-flex min-h-11 items-center whitespace-nowrap rounded-[10px] border border-[var(--line-strong)] px-3.5 text-[var(--text-2)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-1)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] sm:min-h-9"
                    >
                      Cancel research
                    </button>
                  ) : (
                    <button
                      type="submit"
                      disabled={!canSubmit}
                      className="st-meta inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-[10px] bg-[var(--accent)] px-3.5 font-semibold text-[var(--accent-ink)] transition-colors hover:bg-[var(--accent-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-9"
                    >
                      <Send size={13} aria-hidden="true" />
                      Send request
                    </button>
                  )}
                </div>
              </div>
            </div>
          </form>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <p className="st-meta hidden text-[var(--text-3)] sm:block">Enter to send · Shift+Enter for a new line · no broker orders</p>
            <p className="st-meta text-[var(--text-3)]">
              <span className={historySaved ? 'sm:hidden' : ''}>{historySaved ? 'History stays in this browser · not investment advice' : historyStatus}</span>
              {historySaved && <span className="hidden sm:inline">{historyStatus} Research output is not investment advice.</span>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {onClose && (
              <button type="button" onClick={onClose} className="st-meta inline-flex min-h-11 items-center gap-1 text-[var(--text-3)] transition-colors hover:text-[var(--text-1)] sm:min-h-8">
                <X size={12} aria-hidden="true" /> Close chat
              </button>
            )}
            {archivedMessages.length > 0 && (
              <button type="button" onClick={restorePreviousConversation} className="st-meta inline-flex min-h-11 items-center gap-1 text-[var(--text-3)] transition-colors hover:text-[var(--text-1)] sm:min-h-8">
                <Plus size={12} aria-hidden="true" /> Restore previous
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};
