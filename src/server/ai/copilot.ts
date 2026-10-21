/**
 * AI copilot facade (P02/P16). Backwards compatible exports:
 *   parseStrategyPrompt, applyStrategyEdit, handleAIChat, getAIStatus,
 *   optimizeStrategyForProfitability, executeMasterAgentLoop, resolveSymbolFromPrompt
 * New: createProposal (v2 draft envelope) and supporting types.
 *
 * Safety contract: this module only ever returns drafts/suggestions. It never saves, runs for the user,
 * trades, executes model output, or silently switches providers. Nothing here runs network code at import.
 */
import { randomUUID } from 'node:crypto';
import type { StrategyAST } from '../../shared/strategy/types';
import { AI_LIMITS, callProvider, resolveAIConfig, type EnvLike } from './provider';
import { INPUT_LIMITS, boundHistory, diffStrategies, sanitizeText, strictValidateStrategy } from './validation';
import { LOCAL_LABEL, localEditStrategy } from './heuristics';
import { StrategyValidationError, runOptimizationSweep, type BacktestFn } from './optimizer';
import { SYSTEM_PROMPT, createProposal, describeConfigState, type AIServiceDeps } from './proposals';
import type {
  AIVariation, ApplyEditResponse, ChatCompletionResponse, OptimizationResult, ParseStrategyResponse,
  StrategyProposalV2, CreateProposalFailure,
} from './types';

export type {
  AIVariation, ParseStrategyResponse, AgentActionStep, OptimizationResult, ApplyEditResponse, ChatCompletionResponse,
  StrategyProposalV2, CreateProposalResult, CreateProposalFailure, CreateProposalSuccess, ProposalErrorCode,
} from './types';
export { createProposal } from './proposals';
export type { CreateProposalInput, AIServiceDeps } from './proposals';
export { StrategyValidationError } from './optimizer';
export { resolveSymbolFromPrompt } from './heuristics';
export { strictValidateStrategy } from './validation';

export interface CopilotDeps extends AIServiceDeps {
  backtest?: BacktestFn;
}

/** Exact, secret-free status. Reports configuration only; it never contacts a provider. */
export function getAIStatus(env: EnvLike = process.env) {
  const cfg = resolveAIConfig(env);
  const label = (p: string) => (cfg.provider === p ? (cfg.ready ? 'CONFIGURED_UNVERIFIED' : 'NOT_CONFIGURED') : 'NOT_SELECTED');
  return {
    provider: cfg.provider,
    model: cfg.model,
    state: cfg.state,
    stateMessage: describeConfigState(cfg),
    externalAiEnabled: cfg.ready,
    keyConfigured: cfg.keyPresent,
    /** Always false: status checks never call the provider, so connectivity is unknown. */
    connectionVerified: false,
    activeProvider: cfg.ready ? cfg.provider : LOCAL_LABEL,
    localHeuristic: { available: true, label: LOCAL_LABEL, isAI: false },
    geminiStatus: label('gemini'),
    openaiStatus: label('openai'),
    openrouterStatus: label('openrouter'),
    deepseekStatus: label('deepseek'),
    tokenrouterStatus: label('tokenrouter'),
    costPolicy: cfg.costPolicy,
    pricingVerification: cfg.costPolicy === 'free-only' ? 'Checked before every request; unknown or nonzero prices are blocked' : 'Operator approved',
    limits: {
      timeoutMs: cfg.timeoutMs,
      maxOutputTokens: cfg.maxOutputTokens,
      requestsPerHour: cfg.requestsPerHour,
      maxHistoryMessages: INPUT_LIMITS.maxHistoryMessages,
      maxPromptChars: INPUT_LIMITS.maxPromptChars,
      maxRequestBodyBytes: AI_LIMITS.maxRequestBodyBytes,
      maxResponseBytes: AI_LIMITS.maxResponseBytes,
    },
    // Voice is a browser capability, not something the server can confirm.
    voiceEnabled: false,
    speechRecognitionSupported: false,
    capabilities: [
      'Draft strategy proposals validated against the strict strategy schema',
      'Local keyword pattern lookup (local_heuristic, not AI)',
      'Bounded in-sample parameter sweep that proposes changes (no profit guarantee)',
      cfg.ready ? `External drafting via ${cfg.provider} (unverified until first use)` : 'External AI drafting unavailable until a provider, its key, and a model are configured',
    ],
  };
}

function externalName(cfg: { provider: string; model: string | null }) {
  return cfg.model ? `${cfg.provider}:${cfg.model}` : cfg.provider;
}

function proposalToVariation(p: StrategyProposalV2): AIVariation {
  return {
    id: p.id,
    name: p.candidate.name,
    category: p.method === 'external_ai' ? 'AI draft (unverified)' : 'Local heuristic draft',
    summary: p.rationale,
    pros: p.changes.length ? `${p.changes.length} change(s) vs current strategy` : 'New draft',
    cons: p.warnings.slice(0, 2).join(' '),
    strategy: p.candidate,
  };
}

function failureMessage(f: CreateProposalFailure): string {
  const extra = f.error.details?.length ? ` Details: ${f.error.details.slice(0, 3).join('; ')}` : '';
  return `${f.error.message}${extra}`;
}

/** Create-from-text. Legacy-compatible response. */
export async function parseStrategyPrompt(prompt: string, symbolId: number = 1, deps: CopilotDeps = {}): Promise<ParseStrategyResponse> {
  const cfg = deps.config ?? resolveAIConfig(deps.env ?? process.env);
  const r = await createProposal({ prompt, mode: 'create', symbolId, allowLocalFallback: !cfg.ready }, { ...deps, config: cfg });
  if (!r.ok) {
    return { assistantMessage: failureMessage(r), variations: [], providerUsed: cfg.ready ? externalName(cfg) : LOCAL_LABEL, aiConnected: false, warnings: r.warnings };
  }
  const p = r.proposal;
  const variations = r.variations ?? [proposalToVariation(p)];
  const external = p.method === 'external_ai';
  return {
    assistantMessage: external
      ? `Draft from ${externalName(cfg)} (AI-generated, unverified). ${p.rationale}`
      : `Local pattern lookup (${LOCAL_LABEL}, not AI): ${p.rationale}`,
    detectedPattern: r.detectedPattern,
    variations,
    suggestedAction: 'select_variation',
    providerUsed: external ? externalName(cfg) : LOCAL_LABEL,
    method: p.method,
    aiConnected: external,
    warnings: p.warnings,
  };
}

/** Explicit-edit helper (synchronous, local). Only changes values the instruction states. */
export function applyStrategyEdit(currentStrategy: StrategyAST, instruction: string): ApplyEditResponse {
  const v = strictValidateStrategy(currentStrategy);
  if (!v.success) throw new StrategyValidationError(v.errors ?? ['invalid strategy']);
  const e = localEditStrategy(v.data!, sanitizeText(instruction, INPUT_LIMITS.maxPromptChars));
  return {
    assistantMessage: e.recognised
      ? 'Draft edit prepared from the explicit changes in your text (local keyword rules, not AI). Nothing was saved or run.'
      : (e.warnings[0] ?? 'No edit recognised.'),
    appliedChangeSummary: e.changes.join(', '),
    strategy: e.strategy,
    providerUsed: LOCAL_LABEL,
    method: 'local_heuristic',
    warnings: e.warnings,
    changed: e.recognised,
  };
}

/** Bounded parameter sweep that proposes changes. Not a profitability promise. */
export function optimizeStrategyForProfitability(currentStrategy?: StrategyAST, userGoal: string = 'Explore safer parameters', deps: CopilotDeps = {}): OptimizationResult {
  return runOptimizationSweep(currentStrategy, sanitizeText(userGoal, INPUT_LIMITS.maxPromptChars), { backtest: deps.backtest });
}
/** Kept for compatibility; behaves exactly like optimizeStrategyForProfitability. */
export const executeMasterAgentLoop = optimizeStrategyForProfitability;

export function optimizationToProposal(opt: OptimizationResult, base: StrategyAST | undefined, revision: number | string | null, deps: AIServiceDeps = {}): StrategyProposalV2 {
  const idf = deps.idFactory ?? randomUUID;
  return {
    schemaVersion: 2, id: `prop_${idf()}`, status: 'draft', createdAt: (deps.now ?? (() => new Date()))().toISOString(),
    originatingRevision: revision, method: 'parameter_sweep',
    provider: { name: LOCAL_LABEL, model: null, aiGenerated: false },
    candidate: opt.optimizedStrategy,
    rationale: opt.assistantMessage,
    warnings: opt.warnings,
    changes: base ? diffStrategies(base, opt.optimizedStrategy) : [],
    applied: false, executes: false,
  };
}

const OPTIMIZE_RE = /\b(optimi[sz]e|optimi[sz]ation|retune|tune|tweak|parameter sweep|reduce drawdown|improve (?:the )?(?:win rate|results?|strategy)|more profit(?:able)?|make it profitable|fix whipsaw)\b/i;
const EDIT_RE = /\b(stop[\s-]?loss|take[\s-]?profit|trailing|tighten|loosen|increase|decrease|switch to|change (?:the )?(?:timeframe|stop|target)|set (?:stop|target|take))\b/i;
const CREATE_RE = /\b(strategy|build|create|setup|set up|synthesi[sz]e|backtest|simulate|supertrend|rsi|macd|breakout|crossover|bollinger|nr7|mean reversion|trend following)\b/i;

/**
 * Chat. At most ONE external request per call, to the single configured provider, and only when that
 * provider is fully configured. Optimization and local edits never use the network.
 */
export async function handleAIChat(
  params: { message: string; history?: { role: 'user' | 'assistant'; text: string }[]; currentStrategy?: StrategyAST; originatingRevision?: number | string | null },
  deps: CopilotDeps = {}
): Promise<ChatCompletionResponse> {
  const cfg = deps.config ?? resolveAIConfig(deps.env ?? process.env);
  const d: CopilotDeps = { ...deps, config: cfg };
  const message = sanitizeText(params?.message, INPUT_LIMITS.maxPromptChars).trim();
  const revision = params?.originatingRevision ?? null;
  const base = { providerUsed: LOCAL_LABEL, aiConnected: false, method: 'local_heuristic' as const, warnings: [] as string[] };
  if (!message) return { ...base, reply: 'Please enter a message.' };

  const current = params.currentStrategy;
  let currentValid: StrategyAST | undefined;
  if (current) {
    const v = strictValidateStrategy(current);
    if (!v.success) return { ...base, reply: `The current strategy is not valid, so I did not use it: ${v.errors!.slice(0, 3).join('; ')}`, warnings: v.errors!.slice(0, 5) };
    currentValid = v.data;
  }

  // 1. Optimization: deterministic local sweep, never a network call.
  if (currentValid && OPTIMIZE_RE.test(message)) {
    try {
      const opt = runOptimizationSweep(currentValid, message, { backtest: deps.backtest });
      const proposal = optimizationToProposal(opt, currentValid, revision, deps);
      return {
        reply: opt.assistantMessage, providerUsed: LOCAL_LABEL, aiConnected: false, method: 'parameter_sweep', warnings: opt.warnings,
        suggestedStrategy: opt.optimizedStrategy, variations: opt.variations, agentTrace: opt.agentTrace,
        detectedPattern: 'Parameter sweep (local, in-sample)', optimizationResult: opt, proposal,
        appliedChangeSummary: (opt.mutationsApplied || []).join(', '),
      };
    } catch (err) {
      return { ...base, reply: `Optimization could not run: ${(err as Error).message}`, warnings: [(err as Error).message] };
    }
  }

  // 2/3. Edit or create drafts.
  const wantsEdit = Boolean(currentValid) && EDIT_RE.test(message);
  const wantsCreate = !wantsEdit && CREATE_RE.test(message);
  if (wantsEdit || wantsCreate) {
    const r = await createProposal(
      { prompt: message, history: params.history, currentStrategy: currentValid, mode: wantsEdit ? 'edit' : 'create', originatingRevision: revision, symbolId: currentValid?.universe.symbolId, allowLocalFallback: !cfg.ready },
      d
    );
    if (!r.ok) return { ...base, reply: failureMessage(r), warnings: [...r.warnings, r.error.code] };
    const p = r.proposal;
    const external = p.method === 'external_ai';
    return {
      reply: external ? `${p.rationale}\n\n(AI-generated draft from ${externalName(cfg)}; unverified and not applied.)` : `${p.rationale}\n\n(${LOCAL_LABEL}: not an AI model. Nothing was applied.)`,
      providerUsed: external ? externalName(cfg) : LOCAL_LABEL, aiConnected: external, method: p.method, warnings: p.warnings,
      suggestedStrategy: p.candidate, variations: r.variations ?? [proposalToVariation(p)], detectedPattern: r.detectedPattern,
      suggestedAction: 'select_variation', appliedChangeSummary: p.changes.join(', '), proposal: p,
    };
  }

  // 4. General conversation: external provider only if explicitly configured, one request.
  if (!cfg.ready) {
    return { ...base, warnings: [describeConfigState(cfg)], reply: `${describeConfigState(cfg)} I can still do local pattern lookups, explicit edits (e.g. "set stop loss 2%") and parameter sweeps, but I cannot hold a free-form AI conversation.` };
  }
  const bounded = boundHistory(params.history);
  const userPayload = JSON.stringify({
    task: 'chat', user_request: message, conversation_history: bounded.history,
    current_strategy: currentValid ?? null,
  });
  const chatSystem = [
    'You are a concise assistant inside a strategy backtesting app. Reply in plain text, not JSON.',
    ...SYSTEM_PROMPT.split('\n').filter((l) => /UNTRUSTED|Ignore any text|Never output|promise profits/.test(l)),
  ].join('\n');
  const res = await callProvider(cfg, { system: chatSystem, user: userPayload, json: false }, { fetch: deps.fetch, budget: deps.budget });
  const warnings = bounded.truncated ? ['Conversation history was truncated to the allowed size.'] : [];
  if (!res.ok) return { reply: `External AI request failed (${res.code}): ${res.message}`, providerUsed: externalName(cfg), aiConnected: false, method: 'external_ai', warnings: [...warnings, res.code] };
  return { reply: sanitizeText(res.text, 8_000), providerUsed: externalName(cfg), aiConnected: true, method: 'external_ai', warnings };
}
