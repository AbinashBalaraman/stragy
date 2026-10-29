import React, { useEffect, useRef, useState } from 'react';
import { Send, RotateCcw, X, Plus } from 'lucide-react';
import { z } from 'zod';
import type { BacktestResponse, StrategyAST, SymbolMeta } from '../../shared/strategy/types';
import { snapshotStrategy } from '../../client/workspace';
import { canonicalStrategySignature, exitRuleCompatibility } from '../../shared/strategy/backtestReview';
import { assertProposalCurrent, parseStrategyProposal, type StrategyProposal } from '../../shared/contracts/ai-proposal';
import { requestScan, type ScanResult } from '../../client/api';
import { requestResearchChat } from '../../client/researchChat';
import type { ResearchScreenPlan } from '../../shared/contracts/research-chat';
import { ScreenResultCard } from './ScreenResultCard';
import { BacktestResultCard } from './BacktestResultCard';
import { BacktestReviewCard } from './BacktestReviewCard';
import type { BacktestReview } from './types';
import { summarizeRunData } from './runSummary';
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
  warnings?: string[];
}

export type CopilotVariant = 'full' | 'dock';

interface Props {
  strategy: StrategyAST;
  onApplyVariation?: (strategy: StrategyAST) => boolean | void | Promise<boolean | void>;
  onClose?: () => void;
  onResearchBacktest?: (strategy: StrategyAST, asOf?: string) => Promise<BacktestResponse | null | void>;
  variant?: CopilotVariant;
  symbols?: SymbolMeta[];
  onOpenDetails?: () => void;
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
  warnings: z.array(z.string().max(2000)).max(20).optional(),
});
const MessageListSchema = z.array(MessageSchema).max(40);
const HISTORY_KEY = 'stragy_copilot_review_history_v2';
const ARCHIVE_KEY = 'stragy_copilot_previous_conversation_v1';

function loadMessages(key: string): ChatMessage[] {
  try { return MessageListSchema.parse(JSON.parse(localStorage.getItem(key) ?? '[]')); } catch { return []; }
}

function saveMessages(key: string, messages: ChatMessage[]): boolean {
  try { localStorage.setItem(key, JSON.stringify(messages.slice(-40))); return true; } catch { return false; }
}

type Proposal = StrategyProposal & { sourceSnapshot: string; validatedCandidate: StrategyAST };

const STARTERS = [
  { label: 'Find Nifty 50 RSI oversold stocks after being overbought recently', text: 'Find Nifty 50 RSI oversold stocks after recently overbought' },
  { label: 'Set my stop loss to 3%', text: 'Set my stop loss to 3%' },
  { label: 'Use a 2% trailing stop', text: 'Set my trailing stop to 2%' },
];

const methodLabel = (method: string, provider: { name: string; model: string | null; aiGenerated: boolean }): string => {
  if (provider.aiGenerated) return 'AI-generated via ' + provider.name + (provider.model ? ' / ' + provider.model : '') + ' · verify factual claims with data';
  if (method === 'local_heuristic') return 'Local keyword rules · not AI';
  if (method === 'rule_parser') return 'Built-in rule parser · not AI';
  return 'Unavailable · no result was invented';
};

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
  const [screenPlan, setScreenPlan] = useState<ResearchScreenPlan | null>(null);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scanPending, setScanPending] = useState(false);
  const [scanError, setScanError] = useState('');
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
  const [awaitingSymbolFor, setAwaitingSymbolFor] = useState<'screen' | 'draft' | null>(null);
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
  const snapshot = JSON.stringify(strategy);
  const full = variant === 'full';
  const busy = loading || scanPending || reviewStatus === 'running';

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
    abort.current?.abort();
    setLoading(false);
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
    pendingApply.current = null;
    abort.current?.abort();
  }, []);

  useEffect(() => {
    const saved = saveMessages(HISTORY_KEY, messages);
    setHistoryStatus(saved ? 'History stays in this browser.' : 'History was not saved: browser storage is unavailable.');
  }, [messages]);

  useEffect(() => {
    if ((newConversationSignal ?? 0) !== seenNewChat.current) {
      seenNewChat.current = newConversationSignal ?? 0;
      clearConversation();
    }
    // clearConversation intentionally reads the latest state through function scope.
  }, [newConversationSignal]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages, review, screenPlan, scanResult, proposal, validatedResult, scanError, error]);

  const append = (sender: ChatMessage['sender'], text: string, extras: Pick<ChatMessage, 'methodLabel' | 'warnings'> = {}) => {
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

  const clearConversation = () => {
    generation.current++;
    runGeneration.current++;
    clipboardGeneration.current++;
    abort.current?.abort();
    onCancelResearch?.();
    rememberCurrentConversation(messages);
    setMessages([]);
    setPrompt('');
    setLoading(false);
    setScanPending(false);
    setScanResult(null);
    setScanError('');
    setScreenPlan(null);
    setProposal(null);
    setReview(null);
    setReviewStatus('idle');
    setReviewError('');
    setValidatedResult(null);
    setAwaitingSymbolFor(null);
    setLastContext(null);
    setError('');
    setApplied(null);
    setApplyStatus('');
    setClipboardStatus('');
    setSaveStatus('');
    pendingApply.current = null;
  };

  const restorePreviousConversation = () => {
    const current = messages;
    const previous = archivedMessages;
    setMessages(previous);
    if (current.length) {
      setArchivedMessages(current);
      saveMessages(ARCHIVE_KEY, current);
    } else {
      setArchivedMessages([]);
      try { localStorage.removeItem(ARCHIVE_KEY); } catch { /* Storage may be unavailable. */ }
    }
  };

  const cancelPendingRequest = () => {
    generation.current++;
    abort.current?.abort();
    setLoading(false);
    setScanPending(false);
    setScanError('Cancelled. No results were confirmed.');
  };

  function selectBaseContext(sourceType: 'screen' | 'draft'): { strategy: StrategyAST; asOf?: string; sourceLabel: string; assumptions: string[] } | null {
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

  const prepareReview = (sourceType: 'screen' | 'draft', symbol: SymbolMeta, asOfOverride?: string) => {
    supersedeReview();
    const base = selectBaseContext(sourceType);
    if (!base) {
      append('assistant', 'There is no reviewed screen or draft to test. Describe a screen first, then ask to backtest it on a stock.');
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
      append('assistant', 'I prepared a backtest review for ' + symbol.ticker + '. Nothing has been applied or run. Review the assumptions, then choose “Use these assumptions and run”.');
    } catch (caught) {
      setReviewError((caught as Error).message);
      setReviewStatus('idle');
      setReview(null);
      append('assistant', 'The backtest review could not be prepared: ' + (caught as Error).message + ' Nothing was run.');
    }
  };

  const askForSymbol = (sourceType: 'screen' | 'draft', detail: string) => {
    setAwaitingSymbolFor(sourceType);
    append('assistant', detail);
  };

  const handleBacktestFollowUp = (text: string, stockQuery: string | null) => {
    supersedeReview();
    const sourceType = currentBaseType();
    if (!sourceType) {
      append('assistant', 'I do not have a validated screen or draft to test yet. Describe a screen first (for example, “Find Nifty 50 RSI oversold stocks after recently overbought”), then say “backtest this on RELIANCE”.');
      return;
    }
    if (!symbols.length) {
      append('assistant', 'The NSE symbol list is unavailable, so I cannot safely identify that stock. Reload after the symbol service is available.');
      return;
    }
    const resolution = resolveStock(stockQuery, text, symbols);
    if (resolution.status === 'resolved') {
      prepareReview(sourceType, resolution.symbol);
      return;
    }
    if (resolution.status === 'ambiguous') {
      askForSymbol(sourceType, 'I found more than one possible stock: ' +
        resolution.candidates.map(candidate => candidate.ticker + ' (' + candidate.name + ')').join(', ') +
        '. Reply with the exact NSE ticker to use. Nothing was run.');
      return;
    }
    askForSymbol(sourceType, 'Which stock should I test “' + selectBaseContext(sourceType)?.strategy.name + '” on? Reply with an NSE ticker such as RELIANCE. Nothing was run.');
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
      const outcome = await onResearchBacktest(review.strategy, review.asOf);
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

  const submitText = async (raw: string) => {
    const text = raw.trim();
    if (!text || loading || reviewStatus === 'running' || pendingApply.current) return;
    append('user', text);
    setError('');
    setApplyStatus('');
    setSaveStatus('');
    setClipboardStatus('');
    clipboardGeneration.current++;

    const reply = classifyReviewReply(text);
    if (handleApproval(reply, text)) return;
    if (handleAwaitingSymbol(text)) return;

    const intent = parseBacktestIntent(text);
    if (intent.kind === 'negated') {
      append('assistant', 'Nothing was run. A negative instruction is never treated as approval.');
      return;
    }
    if (intent.kind === 'backtest') {
      handleBacktestFollowUp(text, intent.stockQuery);
      return;
    }

    // Clear an unapproved review before the request is sent, so a later failed
    // request can never leave an obsolete review available for approval.
    supersedeReview();

    let current: StrategyAST;
    try { current = snapshotStrategy(strategy); } catch (caught) { setError((caught as Error).message); return; }
    const sourceSnapshot = JSON.stringify(strategy);
    const originatingRevision = revision.current;
    const owned = ++generation.current;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setLoading(true);
    setScanError('');

    try {
      const data = await requestResearchChat({
        message: text,
        currentStrategy: current,
        originatingRevision,
        allowLocalFallback: allowLocal,
        history: messages.slice(-20).map(message => ({ role: message.sender, text: message.text })),
        ...(screenPlan ? { screenContext: { strategy: screenPlan.strategy, universe: screenPlan.universe } } : {}),
      }, controller.signal);
      if (generation.current !== owned) return;
      if (data.originatingRevision !== originatingRevision) throw new Error('This research response is stale.');
      append('assistant', data.message, {
        methodLabel: methodLabel(data.method, data.provider),
        warnings: data.warnings,
      });
      if (data.method === 'unavailable') setError(data.message);

      if (data.kind === 'proposal') {
        const parsed = parseStrategyProposal(data.proposal);
        assertProposalCurrent(parsed, originatingRevision, sourceSnapshot, JSON.stringify(strategy));
        setProposal({ ...parsed, sourceSnapshot, validatedCandidate: parsed.candidate });
        setScreenPlan(null);
        setScanResult(null);
        setScanError('');
        setReview(null);
        setReviewStatus('idle');
        setAwaitingSymbolFor(null);
        setLastContext('draft');
        setApplied(null);
      } else if (data.kind === 'screen') {
        setScreenPlan(data);
        setProposal(null);
        setReview(null);
        setReviewStatus('idle');
        setAwaitingSymbolFor(null);
        setLastContext('screen');
        setScanPending(true);
        setScanResult(null);
        setScanError('');
        try {
          const scanned = await requestScan({
            universe: data.universe,
            strategy: data.strategy,
            limit: 100,
            ...(data.asOf ? { asOf: data.asOf } : {}),
          }, controller.signal);
          if (generation.current !== owned) return;
          if (scanned.mode !== 'real' || scanned.matches.some(match => match.provenance.mode !== 'real') || /demo/i.test(scanned.dataSource)) {
            throw new Error('Real current data is unavailable. Demo results were not presented as stock matches.');
          }
          setScanResult(scanned);
        } catch (caught) {
          if (generation.current === owned && !controller.signal.aborted) setScanError((caught as Error).message);
        } finally {
          if (generation.current === owned) setScanPending(false);
        }
      }
    } catch (caught) {
      if (generation.current === owned && !controller.signal.aborted) setError((caught as Error).message);
    } finally {
      if (generation.current === owned) setLoading(false);
    }
  };

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!prompt.trim()) return;
    const text = prompt;
    setPrompt('');
    await submitText(text);
  };

  const onComposerKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const native = event.nativeEvent as KeyboardEvent & { isComposing?: boolean };
    if (event.key !== 'Enter' || event.shiftKey) return;
    if (native.isComposing || native.keyCode === 229) return;
    event.preventDefault();
    if (!prompt.trim() || loading || reviewStatus === 'running') return;
    const text = prompt;
    setPrompt('');
    void submitText(text);
  };

  const apply = async () => {
    if (!proposal || !onApplyVariation || applied === proposal.id || pendingApply.current) return;
    let candidate: StrategyAST;
    try {
      assertProposalCurrent(proposal, revision.current, proposal.sourceSnapshot, JSON.stringify(strategy));
      candidate = snapshotStrategy(proposal.validatedCandidate);
    } catch (caught) { setError((caught as Error).message); return; }
    const pending = { id: proposal.id, snapshot: JSON.stringify(candidate) };
    pendingApply.current = pending;
    setError('');
    setApplyStatus('Apply requested. Waiting for workspace confirmation.');
    try {
      const accepted = await onApplyVariation(candidate);
      if (accepted === false) throw new Error('The workspace rejected this draft. Nothing was confirmed as applied.');
      if (pendingApply.current === pending && accepted === true) {
        pendingApply.current = null;
        setApplied(pending.id);
        setApplyStatus('Draft applied to the workspace. The assumptions are in the builder; no backtest or broker order was executed.');
      } else if (pendingApply.current === pending && pending.snapshot === JSON.stringify(snapshotStrategy(strategy))) {
        pendingApply.current = null;
        setApplied(pending.id);
        setApplyStatus('Workspace already matches this draft. No backtest or broker order was executed.');
      }
    } catch (caught) {
      if (pendingApply.current === pending) {
        pendingApply.current = null;
        setApplyStatus('Draft was not confirmed as applied.');
        setError((caught as Error).message);
      }
    }
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

  return (
    <section
      aria-label="Research conversation"
      className={(full ? 'h-full' : 'h-full border-l border-white/10') + ' flex min-h-0 flex-col bg-[#111113]'}
      onKeyDown={event => { if (event.key === 'Escape' && onClose) onClose(); }}
    >
      <div className={(full ? 'max-w-[820px]' : 'max-w-[760px]') + ' mx-auto flex h-full min-h-0 w-full flex-col'}>
        <div role="log" aria-live="polite" aria-label="Conversation" className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 sm:py-10">
          {archivedMessages.length > 0 && (
            <div className="mb-5 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-neutral-400">
              <span>A previous conversation is saved in this browser.</span>
              <button type="button" onClick={restorePreviousConversation} className="underline decoration-neutral-600 underline-offset-2 hover:text-neutral-200">
                Restore previous conversation ({archivedMessages.length})
              </button>
            </div>
          )}

          {welcome && (
            <div className="mx-auto max-w-[680px] pt-6 sm:pt-16">
              <p className="text-sm text-neutral-400">Stragy research</p>
              <h1 className="mt-3 text-3xl font-medium tracking-[-0.03em] text-neutral-100 sm:text-4xl">What would you like to research?</h1>
              <p className="mt-4 max-w-[560px] text-sm leading-6 text-neutral-400">
                Describe a goal in your own words. Stragy uses validated screens, drafts and backtests, shows its assumptions, and never places a broker order.
              </p>
              <div className="mt-7 flex flex-wrap gap-2">
                {STARTERS.map(starter => (
                  <button
                    key={starter.label}
                    type="button"
                    onClick={() => { setPrompt(''); void submitText(starter.text); }}
                    className="rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-2 text-left text-xs text-neutral-300 transition hover:border-white/20 hover:text-neutral-100"
                  >
                    {starter.label}
                  </button>
                ))}
              </div>
              <p className="mt-6 text-[11px] leading-5 text-neutral-600">
                Local rule parsers and keyword tools are labelled honestly. External AI is used only when the server reports a connected provider; if it is unavailable, Stragy says so and never invents an answer.
              </p>
            </div>
          )}

          <div className="space-y-6">
            {messages.map(message => message.sender === 'user' ? (
              <article key={message.id} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-md bg-[#24262c] px-4 py-2.5 text-sm leading-6 text-neutral-100 whitespace-pre-wrap break-words">
                  {message.text}
                </div>
              </article>
            ) : (
              <article key={message.id} className="max-w-[92%] space-y-1.5">
                <p className="text-[11px] uppercase tracking-wide text-neutral-500">Stragy</p>
                <div className="text-sm leading-7 text-neutral-200 whitespace-pre-wrap break-words">{message.text}</div>
                {message.methodLabel && <p className="text-[11px] text-neutral-500">{message.methodLabel}</p>}
                {message.warnings && message.warnings.length > 0 && (
                  <details className="text-[11px] text-neutral-500">
                    <summary className="cursor-pointer">Warnings ({message.warnings.length})</summary>
                    <ul className="mt-1 list-disc space-y-1 pl-4">{message.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
                  </details>
                )}
              </article>
            ))}

            {screenPlan && (
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
              />
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
              <article aria-label="Draft proposal" className="rounded-2xl border border-white/10 bg-[#171719] p-4 sm:p-5 space-y-4">
                <header>
                  <p className="text-[11px] uppercase tracking-wide text-neutral-500">Draft · review before use</p>
                  <h3 className="mt-1 text-lg font-semibold text-neutral-100">{proposal.validatedCandidate.name}</h3>
                  <p className="mt-1 text-xs text-neutral-400">
                    {proposal.provider.aiGenerated
                      ? 'AI-generated via ' + proposal.provider.name + (proposal.provider.model ? ' / ' + proposal.provider.model : '') + '. The rules were schema-validated, not performance-verified.'
                      : 'Local keyword rules · not AI. Only explicit edits found in your text are proposed.'}
                  </p>
                </header>
                <div>
                  <h4 className="text-xs font-medium uppercase tracking-wide text-neutral-500">Changes</h4>
                  <ul className="mt-1 list-disc space-y-1 pl-4 text-sm text-neutral-300">
                    {proposal.changes.length ? proposal.changes.map((change, index) => <li key={index}>{change}</li>) : <li>No parameter changes proposed.</li>}
                  </ul>
                </div>
                <details className="rounded-lg border border-white/8 p-3 text-xs text-neutral-400">
                  <summary className="cursor-pointer text-neutral-300">Warnings, assumptions and complete strategy</summary>
                  <ul className="mt-2 list-disc space-y-1 pl-4">
                    {proposal.warnings.length ? proposal.warnings.map((warning, index) => <li key={index}>{warning}</li>) : <li>No additional warnings.</li>}
                  </ul>
                  <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-black/20 p-2">{JSON.stringify(proposal.validatedCandidate, null, 2)}</pre>
                </details>
                <p className="text-xs text-neutral-500">Apply changes the workspace draft only. Prepare a separate backtest review to run it. Nothing is saved automatically.</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    className="rounded-lg bg-sky-200 px-3.5 py-2 text-sm font-semibold text-[#101012] hover:bg-sky-100 disabled:opacity-40"
                    type="button"
                    disabled={!onApplyVariation || !!pendingApply.current || applied === proposal.id || proposal.sourceSnapshot !== snapshot}
                    onClick={() => void apply()}
                  >
                    Apply draft
                  </button>
                  <button
                    type="button"
                    disabled={!onResearchBacktest || reviewStatus === 'running'}
                    onClick={prepareDraftReviewFromButton}
                    className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-neutral-200 hover:bg-white/5 disabled:opacity-40"
                  >
                    Prepare backtest
                  </button>
                  {onSaveStrategy && (
                    <button type="button" onClick={() => void save()} className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-neutral-200 hover:bg-white/5">
                      Save to My Strategies
                    </button>
                  )}
                  <button type="button" onClick={() => void copy()} className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-neutral-200 hover:bg-white/5">
                    Copy draft JSON
                  </button>
                  <button
                    type="button"
                    onClick={() => { setProposal(null); setClipboardStatus(''); setSaveStatus(''); clipboardGeneration.current++; }}
                    className="rounded-lg border border-transparent px-3 py-1.5 text-xs text-neutral-400 hover:text-neutral-200"
                  >
                    Dismiss
                  </button>
                </div>
                {proposal.sourceSnapshot !== snapshot && <p className="text-xs text-amber-200">The workspace changed after this draft was prepared. Generate a fresh draft before applying.</p>}
              </article>
            )}

            {validatedResult && <BacktestResultCard result={validatedResult} onOpenDetails={onOpenDetails} />}
            <div ref={endRef} />
          </div>
        </div>

        <div className="shrink-0 border-t border-white/8 bg-[#111113] px-4 py-3 sm:px-6 sm:py-4">
          <div className={(full ? 'max-w-[820px]' : 'max-w-[760px]') + ' mx-auto space-y-2'}>
            {applyStatus && <p role="status" className="text-xs text-neutral-400">{applyStatus}</p>}
            {clipboardStatus && <p role="status" className="text-xs text-neutral-400">{clipboardStatus}</p>}
            {saveStatus && <p role="status" className="text-xs text-neutral-400">{saveStatus}</p>}
            {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
            {scanPending && <p role="status" className="text-xs text-neutral-400">Scanning actual current daily data. Results are pending, not zero.</p>}
            {loading && !scanPending && <p role="status" className="text-xs text-neutral-400">Preparing a response with validated tools…</p>}
            {reviewStatus === 'running' && <p role="status" className="text-xs text-neutral-400">Backtest running on the reviewed assumptions…</p>}

            <form onSubmit={send}>
              <label htmlFor="copilot-prompt" className="sr-only">Research request</label>
              <div className="rounded-2xl border border-white/12 bg-[#18181b] px-3 py-2 shadow-lg shadow-black/20 transition focus-within:border-sky-300/50">
                <textarea
                  id="copilot-prompt"
                  rows={2}
                  maxLength={4000}
                  value={prompt}
                  onChange={event => {
                    setPrompt(event.target.value);
                    if (scanPending) cancelPendingRequest();
                  }}
                  onKeyDown={onComposerKeyDown}
                  placeholder="Describe what you want to research…"
                  className="max-h-40 min-h-[48px] w-full resize-none bg-transparent px-1 py-1.5 text-sm leading-6 text-neutral-100 outline-none placeholder:text-neutral-600"
                />
                <div className="flex items-center justify-between gap-2">
                  <details className="relative text-[11px] text-neutral-500">
                    <summary className="cursor-pointer select-none rounded px-1 py-1 hover:text-neutral-300">Request options</summary>
                    <div className="absolute bottom-full left-0 z-10 mb-2 w-64 rounded-xl border border-white/10 bg-[#1d1d20] p-3 shadow-xl">
                      <label className="flex gap-2 text-xs text-neutral-300">
                        <input type="checkbox" checked={allowLocal} onChange={event => setAllowLocal(event.target.checked)} />
                        Allow local keyword fallback (not AI)
                      </label>
                      <p className="mt-2 text-[11px] text-neutral-500">Local tools only understand explicit stop, target, trailing-stop and symbol edits.</p>
                    </div>
                  </details>
                  <div className="flex items-center gap-2">
                    {busy && (
                      <button type="button" onClick={reviewStatus === 'running' ? cancelRun : cancelPendingRequest} className="rounded-lg px-2 py-1 text-[11px] text-neutral-400 hover:text-neutral-200">
                        Cancel research
                      </button>
                    )}
                    <button
                      type="submit"
                      disabled={loading || reviewStatus === 'running' || !!pendingApply.current || !prompt.trim()}
                      className="flex items-center gap-1.5 rounded-xl bg-sky-200 px-3 py-1.5 text-xs font-semibold text-[#101012] hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Send size={13} />
                      Send request
                    </button>
                  </div>
                </div>
              </div>
            </form>
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-neutral-600">
              <span>Enter to send · Shift+Enter for a new line · no broker orders</span>
              <button type="button" onClick={clearConversation} className="flex items-center gap-1 hover:text-neutral-400">
                <RotateCcw size={11} />
                New chat
              </button>
            </div>
            <p className="text-[10px] text-neutral-700">{historyStatus} Research output is not investment advice.</p>
            <div className="flex flex-wrap gap-3 text-[11px] text-neutral-500">
              {onClose && <button type="button" onClick={onClose} className="flex items-center gap-1 hover:text-neutral-300"><X size={12} /> Close chat</button>}
              {archivedMessages.length > 0 && <button type="button" onClick={restorePreviousConversation} className="flex items-center gap-1 hover:text-neutral-300"><Plus size={12} /> Restore previous</button>}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
