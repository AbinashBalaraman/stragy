import type { StrategyAST } from '../../shared/strategy/types';

export type ProposalMethod = 'external_ai' | 'local_heuristic' | 'parameter_sweep';

export interface AIVariation {
  id: string;
  name: string;
  category: string;
  summary: string;
  pros: string;
  cons: string;
  strategy: StrategyAST;
}

export interface ParseStrategyResponse {
  assistantMessage: string;
  detectedPattern?: string;
  variations: AIVariation[];
  /** Never run_backtest/run_scanner automatically; kept for type compatibility. */
  suggestedAction?: 'select_variation' | 'load_template' | 'run_backtest' | 'run_scanner';
  providerUsed?: string;
  method?: ProposalMethod;
  aiConnected?: boolean;
  warnings?: string[];
}

export interface AgentActionStep {
  step: number;
  type: 'INSPECT' | 'HYPOTHESIS' | 'TRIAL_SWEEP' | 'EVALUATE' | 'MUTATE' | 'EXECUTE';
  title: string;
  detail: string;
  status: 'completed' | 'optimal' | 'warning';
}

export interface MetricsSnapshot {
  totalPnL: number;
  winRate: number | null;
  profitFactor: number | null;
  maxDrawdown: number;
  sharpeRatio: number | null;
  totalTrades: number;
}

export interface OptimizationResult {
  assistantMessage: string;
  agentTrace?: AgentActionStep[];
  trialsCount?: number;
  beforeMetrics: MetricsSnapshot;
  afterMetrics: MetricsSnapshot;
  improvements: string[];
  mutationsApplied?: string[];
  optimizedStrategy: StrategyAST;
  variations: AIVariation[];
  providerUsed: string;
  method: 'parameter_sweep';
  /** The result is a proposal only; nothing has been applied, saved or run for the user. */
  proposalOnly: true;
  /** Metrics are computed on the same in-sample bars used to pick the winner. */
  inSample: true;
  warnings: string[];
  noImprovementFound: boolean;
}

export interface ApplyEditResponse {
  assistantMessage: string;
  appliedChangeSummary: string;
  strategy: StrategyAST;
  agentTrace?: AgentActionStep[];
  beforeMetrics?: MetricsSnapshot;
  afterMetrics?: MetricsSnapshot;
  providerUsed?: string;
  method?: ProposalMethod;
  warnings?: string[];
  /** true when at least one explicit change was recognised and applied to the returned copy. */
  changed?: boolean;
}

export interface ChatCompletionResponse {
  reply: string;
  providerUsed: string;
  aiConnected: boolean;
  method: ProposalMethod;
  warnings: string[];
  suggestedStrategy?: StrategyAST;
  variations?: AIVariation[];
  detectedPattern?: string;
  appliedChangeSummary?: string;
  agentTrace?: AgentActionStep[];
  suggestedAction?: 'run_backtest' | 'load_strategy' | 'select_variation';
  optimizationResult?: OptimizationResult;
  proposal?: StrategyProposalV2;
}

export interface ProposalProviderInfo {
  /** 'local_heuristic' when no external AI answered. */
  name: string;
  model: string | null;
  /** True only if an external provider returned the content of this proposal. */
  aiGenerated: boolean;
}

/** v2 draft envelope. Never executable: applying/saving/running is a separate, explicit user action. */
export interface StrategyProposalV2 {
  schemaVersion: 2;
  id: string;
  status: 'draft';
  createdAt: string;
  /** Workspace revision this draft was derived from; client rejects as stale if it moved on. */
  originatingRevision: number | string | null;
  method: ProposalMethod;
  provider: ProposalProviderInfo;
  candidate: StrategyAST;
  rationale: string;
  warnings: string[];
  /** Leaf-level differences against the current strategy (empty when creating from scratch). */
  changes: string[];
  /** Always false: the service never saves, runs, or trades. */
  applied: false;
  executes: false;
}

export type ProposalErrorCode =
  | 'invalid_request' | 'ai_not_configured' | 'ai_timeout' | 'ai_http_error' | 'ai_network_error'
  | 'ai_refusal' | 'ai_empty' | 'ai_invalid_json' | 'ai_invalid_schema' | 'ai_budget_exceeded'
  | 'ai_request_too_large' | 'ai_response_too_large' | 'ai_invalid_response'
  | 'no_local_match' | 'invalid_current_strategy';

export interface CreateProposalSuccess {
  ok: true;
  proposal: StrategyProposalV2;
  /** Local pattern lookup may offer more than one draft; each is strictly validated. */
  variations?: AIVariation[];
  detectedPattern?: string;
}
export interface CreateProposalFailure {
  ok: false;
  error: { code: ProposalErrorCode; message: string; details?: string[] };
  warnings: string[];
  originatingRevision: number | string | null;
}
export type CreateProposalResult = CreateProposalSuccess | CreateProposalFailure;
