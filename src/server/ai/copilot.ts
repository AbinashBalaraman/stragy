/**
 * AI copilot facade (P02/P16). Backwards compatible exports:
 *   parseStrategyPrompt, applyStrategyEdit, getAIStatus,
 *   optimizeStrategyForProfitability, executeMasterAgentLoop, resolveSymbolFromPrompt
 * New: createProposal (v2 draft envelope) and supporting types.
 *
 * The OpenCode engine is Stragy's only chat backend, so the first-version
 * free-form chat implementation was removed here. This module keeps the
 * deterministic draft/edit/status helpers the remaining routes import.
 *
 * Safety contract: this module only ever returns drafts/suggestions. It never saves, runs for the user,
 * trades, executes model output, or silently switches providers. Nothing here runs network code at import.
 */
import { randomUUID } from 'node:crypto';
import type { StrategyAST } from '../../shared/strategy/types';
import { AI_LIMITS, resolveVisionConfig, OPENCODE_GO_MODELS, getLastProviderCall, type EnvLike } from './provider';
import { INPUT_LIMITS, describeStrategyChanges, diffStrategies, sanitizeText, strictValidateStrategy } from './validation';
import { LOCAL_LABEL, localEditStrategy } from './heuristics';
import { StrategyValidationError, runOptimizationSweep, type BacktestFn } from './optimizer';
import { createProposal, describeConfigState, type AIServiceDeps } from './proposals';
import { resolveActiveConfig } from './providerRegistry';
import type {
  AIVariation, ApplyEditResponse, OptimizationResult, ParseStrategyResponse,
  StrategyProposalV2, CreateProposalFailure,
} from './types';

export type {
  AIVariation, ParseStrategyResponse, AgentActionStep, OptimizationResult, ApplyEditResponse,
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
  const cfg = resolveActiveConfig(env);
  const visionCfg = resolveVisionConfig(env);
  const lastCall = getLastProviderCall();
  const lastIsFailure = Boolean(lastCall) && !lastCall!.ok && lastCall!.provider === cfg.provider && lastCall!.model === cfg.model;
  const state = cfg.state === 'ready' && lastIsFailure ? 'degraded' : cfg.state;
  const label = (p: string) => (cfg.provider === p ? (cfg.ready ? 'CONFIGURED_UNVERIFIED' : 'NOT_CONFIGURED') : 'NOT_SELECTED');
  return {
    provider: cfg.provider,
    model: cfg.model,
    state,
    stateMessage: state === 'degraded'
      ? 'External AI is configured, but the last request failed. Retry, or use a configured fallback model.'
      : describeConfigState(cfg),
    externalAiEnabled: cfg.ready,
    keyConfigured: cfg.keyPresent,
    /** The latest provider call in this process. Never contains a key or prompt. */
    lastCall: lastCall ? {
      at: lastCall.at, ok: lastCall.ok, provider: lastCall.provider, model: lastCall.model,
      ...(lastCall.code ? { code: lastCall.code } : {}),
      ...(lastCall.status !== undefined ? { status: lastCall.status } : {}),
    } : null,
    /** Primary model image capability. */
    supportsImages: cfg.supportsImages === true,
    /** Explicit paid approvals, provider:model labels only. */
    approvedPaidModels: cfg.approvedPaidModels ?? [],
    /** Fallback labels in configured order, including entries that cannot run yet. */
    fallbackModels: cfg.fallbackModels ?? [],
    /** Per-entry fallback status: ready, not_configured (missing key) or blocked_paid. */
    fallbackTargets: (cfg.fallbackTargets ?? []).map(target => ({
      provider: target.provider,
      model: target.model,
      label: target.label,
      providerLabel: target.providerLabel,
      status: target.status,
      failure: target.failure,
      approvedPaid: target.approvedPaid,
      supportsImages: target.supportsImages,
    })),
    /** Chart reading may use a separate vision provider/model; the key is never exposed. */
    vision: {
      provider: visionCfg.provider,
      model: visionCfg.model,
      state: visionCfg.state,
      stateMessage: describeConfigState(visionCfg),
      ready: visionCfg.ready,
      keyConfigured: visionCfg.keyPresent,
      supportsImages: visionCfg.supportsImages === true,
      fallbackTargets: (visionCfg.fallbackTargets ?? []).map(target => ({
        provider: target.provider, model: target.model, status: target.status, supportsImages: target.supportsImages,
      })),
    },
    /** Always false: status checks never call the provider, so connectivity is unknown. */
    connectionVerified: false,
    activeProvider: cfg.ready ? cfg.provider : LOCAL_LABEL,
    localHeuristic: { available: true, label: LOCAL_LABEL, isAI: false },
    geminiStatus: label('gemini'),
    openaiStatus: label('openai'),
    openrouterStatus: label('openrouter'),
    deepseekStatus: label('deepseek'),
    tokenrouterStatus: label('tokenrouter'),
    opencodeGoStatus: label('opencode-go'),
    /** Selectable OpenCode Go models. IDs only; the key is never included. */
    opencodeGoModels: OPENCODE_GO_MODELS.map(m => ({ ...m })),
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

function externalName(cfg: { provider: string; model: string | null; providerLabel?: string }) {
  const provider = cfg.providerLabel ?? cfg.provider;
  return cfg.model ? `${provider}:${cfg.model}` : provider;
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
  const cfg = deps.config ?? resolveActiveConfig(deps.env ?? process.env);
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
    changeDetails: base ? describeStrategyChanges(base, opt.optimizedStrategy).details : [],
    applied: false, executes: false,
  };
}
