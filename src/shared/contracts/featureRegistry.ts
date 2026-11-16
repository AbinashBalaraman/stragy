import { z } from 'zod';
import { StrategySchema } from '../strategy/schema';
import { UNIVERSE_OPTIONS } from '../data/symbols';

/**
 * Feature registry: the single, typed description of what Stragy can do, which
 * inputs each feature accepts, how it is set up, its limits and the route or UI
 * action it uses. Input specs are generated from the same zod schemas that
 * validate the hand-off, so the registry cannot describe a field that does not
 * exist or omit an allowed value.
 */

export const DateStringSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(value => {
    const date = new Date(value + 'T00:00:00.000Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Invalid calendar date');

const UNIVERSE_IDS = UNIVERSE_OPTIONS.map(option => option.id) as [string, ...string[]];

export const StrategyTesterInputSchema = z.object({
  strategy: StrategySchema,
  start: DateStringSchema.optional(),
  end: DateStringSchema.optional(),
  asOf: DateStringSchema.optional(),
  initialCapital: z.number().finite().min(100).max(1_000_000_000).default(100_000),
  seed: z.number().int().min(0).max(0xffffffff).optional(),
  robustness: z.boolean().default(false),
}).strict();

export const MarketScannerInputSchema = z.object({
  universe: z.enum(UNIVERSE_IDS).default('NIFTY_50'),
  strategy: StrategySchema,
  asOf: DateStringSchema.optional(),
  limit: z.number().int().min(1).max(100).default(35),
}).strict();

export const ChartReadingInputSchema = z.object({
  image: z.string().min(1).max(7_000_000),
  hint: z.string().max(1_000).optional(),
  currentStrategy: StrategySchema.optional(),
}).strict();

export const LiveQuotesInputSchema = z.object({
  symbolIds: z.string().regex(/^\d{1,9}(,\d{1,9}){0,9}$/),
}).strict();

export const SavedStrategiesInputSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  strategy: StrategySchema,
  expectedRevision: z.number().int().nonnegative().optional(),
}).strict();

export const ComparisonInputSchema = z.object({
  baselineRunId: z.string().min(1).max(100),
  comparisonRunIds: z.array(z.string().min(1).max(100)).min(1).max(5),
}).strict();

export const AIProviderWriteInputSchema = z.object({
  id: z.string().trim().regex(/^[a-z0-9][a-z0-9.-]{1,40}$/).optional(),
  label: z.string().trim().min(1).max(100),
  baseUrl: z.string().trim().min(1).max(500),
  apiKey: z.string().max(500).optional(),
  clearKey: z.boolean().optional(),
  extraHeaders: z.record(z.string().max(100), z.string().max(2000)).optional(),
  enabled: z.boolean().default(true),
}).strict();

export const AIChainUpdateInputSchema = z.object({
  entries: z.array(z.object({
    providerId: z.string().trim().min(1).max(60),
    model: z.string().trim().min(1).max(160),
    vision: z.boolean().default(false),
    paidApproved: z.boolean().default(false),
  }).strict()).min(1).max(6),
}).strict();

/* -------------------------------------------------------------------------- */
/* User preference memory (no personal data)                                  */
/* -------------------------------------------------------------------------- */

export const DATE_RANGE_PRESETS = ['last-1y', 'last-3y', 'last-5y', 'custom'] as const;
export const COST_PRESETS = ['indian-delivery', 'indian-intraday', 'custom'] as const;

export const UserPreferencesSchema = z.object({
  lastSymbolId: z.number().int().positive().safe().optional(),
  lastTicker: z.string().trim().min(1).max(30).optional(),
  universe: z.enum(UNIVERSE_IDS).default('NIFTY_50'),
  dateRange: z.enum(DATE_RANGE_PRESETS).default('last-3y'),
  customStart: DateStringSchema.optional(),
  customEnd: DateStringSchema.optional(),
  costPreset: z.enum(COST_PRESETS).default('indian-delivery'),
  riskPercent: z.number().finite().min(0.1).max(50).default(3.5),
  updatedAt: z.string().min(1).optional(),
}).strict();

export type UserPreferences = z.infer<typeof UserPreferencesSchema>;

export const DEFAULT_USER_PREFERENCES: UserPreferences = UserPreferencesSchema.parse({});

/* -------------------------------------------------------------------------- */
/* Prefill hand-off                                                           */
/* -------------------------------------------------------------------------- */

const PrefillSourceSchema = z.enum(['chat', 'scanner', 'chart', 'template', 'manual', 'results']);

export const TesterPrefillSchema = z.object({
  feature: z.literal('strategy_tester'),
  strategy: StrategySchema,
  start: DateStringSchema.optional(),
  end: DateStringSchema.optional(),
  asOf: DateStringSchema.optional(),
  initialCapital: z.number().finite().min(100).max(1_000_000_000).default(100_000),
  seed: z.number().int().min(0).max(0xffffffff).optional(),
  robustness: z.boolean().default(false),
  source: PrefillSourceSchema.default('chat'),
  assumptions: z.array(z.string().max(500)).max(20).default([]),
}).strict();

export const ScannerPrefillSchema = z.object({
  feature: z.literal('market_scanner'),
  universe: z.enum(UNIVERSE_IDS).default('NIFTY_50'),
  strategy: StrategySchema,
  asOf: DateStringSchema.optional(),
  limit: z.number().int().min(1).max(100).default(35),
  source: PrefillSourceSchema.default('chat'),
  assumptions: z.array(z.string().max(500)).max(20).default([]),
}).strict();

export const ChartPrefillSchema = z.object({
  feature: z.literal('chart_reading'),
  hint: z.string().max(1000).optional(),
  source: PrefillSourceSchema.default('chat'),
}).strict();

export const ChatDraftSchema = z.object({
  feature: z.literal('chat_draft'),
  prompt: z.string().trim().min(1).max(4000),
  source: z.enum(['strategy_tester', 'market_scanner', 'backtest_result', 'chart_reading']).default('strategy_tester'),
  strategy: StrategySchema.optional(),
  context: z.object({
    symbolId: z.number().int().positive().safe().optional(),
    ticker: z.string().trim().min(1).max(30).optional(),
    universe: z.enum(UNIVERSE_IDS).optional(),
    asOf: DateStringSchema.optional(),
  }).strict().optional(),
}).strict();

export const FeaturePrefillSchema = z.discriminatedUnion('feature', [
  TesterPrefillSchema,
  ScannerPrefillSchema,
  ChartPrefillSchema,
  ChatDraftSchema,
]);

export type TesterPrefill = z.infer<typeof TesterPrefillSchema>;
export type ScannerPrefill = z.infer<typeof ScannerPrefillSchema>;
export type ChartPrefill = z.infer<typeof ChartPrefillSchema>;
export type ChatDraft = z.infer<typeof ChatDraftSchema>;
export type FeaturePrefill = z.infer<typeof FeaturePrefillSchema>;

/** The Strategy tester's "Describe in chat" action builds this validated hand-off. */
export function buildChatDraft(input: Omit<ChatDraft, 'feature'>): ChatDraft {
  return ChatDraftSchema.parse({ feature: 'chat_draft', ...input });
}

/* -------------------------------------------------------------------------- */
/* Setup request / response                                                   */
/* -------------------------------------------------------------------------- */

export const FEATURE_IDS = [
  'market_scanner', 'strategy_tester', 'chart_reading', 'live_quotes',
  'saved_strategies', 'comparison_robustness', 'provider_settings',
] as const;
export const FeatureIdSchema = z.enum(FEATURE_IDS);
export type FeatureId = z.infer<typeof FeatureIdSchema>;

export const FeatureSetupRequestSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  currentStrategy: StrategySchema.optional(),
  preferences: UserPreferencesSchema.optional(),
}).strict();

export const FeatureSetupResponseSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ready'),
    featureId: FeatureIdSchema,
    setup: FeaturePrefillSchema,
    assumptions: z.array(z.string().max(500)).max(20),
    question: z.null(),
  }).strict(),
  z.object({
    status: z.literal('needs-input'),
    featureId: FeatureIdSchema,
    setup: z.null(),
    assumptions: z.array(z.string().max(500)).max(20),
    question: z.string().trim().min(1).max(500),
  }).strict(),
]);

export type FeatureSetupRequest = z.infer<typeof FeatureSetupRequestSchema>;
export type FeatureSetupResponse = z.infer<typeof FeatureSetupResponseSchema>;

/* -------------------------------------------------------------------------- */
/* Registry                                                                   */
/* -------------------------------------------------------------------------- */

interface JsonSchemaNode {
  type?: string | string[];
  enum?: (string | number)[];
  minimum?: number;
  maximum?: number;
  default?: unknown;
  description?: string;
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  items?: JsonSchemaNode;
  anyOf?: JsonSchemaNode[];
  $ref?: string;
}

export interface FeatureInputSpec {
  /** Dot path inside the feature request, for example `strategy.rules.entry`. */
  key: string;
  type: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'unknown';
  required: boolean;
  allowedValues?: (string | number)[];
  minimum?: number;
  maximum?: number;
  default?: unknown;
  description?: string;
}

export interface FeatureDefinition {
  id: FeatureId;
  name: string;
  purpose: string;
  inputs: FeatureInputSpec[];
  setupSteps: string[];
  limits: string[];
  api: { kind: 'route' | 'action'; method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; path?: string; action?: string };
  /** Words the copilot uses to pick this feature. */
  triggers: string[];
}

function jsonNode(schema: z.ZodType): JsonSchemaNode {
  return z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as JsonSchemaNode;
}

function resolveNode(node: JsonSchemaNode, root: JsonSchemaNode): JsonSchemaNode {
  if (!node.$ref) return node;
  const name = node.$ref.split('/').pop() ?? '';
  const defs = (root as JsonSchemaNode & { $defs?: Record<string, JsonSchemaNode> }).$defs;
  return defs?.[name] ?? node;
}

function nodeType(node: JsonSchemaNode): FeatureInputSpec['type'] {
  if (node.enum) {
    const sample = node.enum.find(value => typeof value === 'number');
    return typeof sample === 'number' ? (Number.isInteger(sample) ? 'integer' : 'number') : 'string';
  }
  const raw = Array.isArray(node.type) ? node.type.find(value => value !== 'null') : node.type;
  if (raw === 'string' || raw === 'number' || raw === 'integer' || raw === 'boolean' || raw === 'object' || raw === 'array') return raw;
  return 'unknown';
}

function specsForProperties(schema: z.ZodType, prefix = ''): FeatureInputSpec[] {
  const root = jsonNode(schema);
  const required = new Set(root.required ?? []);
  const specs: FeatureInputSpec[] = [];
  for (const [key, rawNode] of Object.entries(root.properties ?? {})) {
    const node = resolveNode(rawNode, root);
    const path = prefix ? `${prefix}.${key}` : key;
    const spec: FeatureInputSpec = {
      key: path,
      type: nodeType(node),
      required: required.has(key),
      ...(node.enum ? { allowedValues: node.enum } : {}),
      ...(typeof node.minimum === 'number' ? { minimum: node.minimum } : {}),
      ...(typeof node.maximum === 'number' ? { maximum: node.maximum } : {}),
      ...(node.default !== undefined ? { default: node.default } : {}),
      ...(node.description ? { description: node.description } : {}),
    };
    specs.push(spec);
    if (node.type === 'object' && node.properties && path.endsWith('strategy')) {
      for (const [childKey, childRaw] of Object.entries(node.properties)) {
        const child = resolveNode(childRaw, root);
        specs.push({
          key: `${path}.${childKey}`,
          type: nodeType(child),
          required: (node.required ?? []).includes(childKey),
          ...(child.enum ? { allowedValues: child.enum } : {}),
          ...(typeof child.minimum === 'number' ? { minimum: child.minimum } : {}),
          ...(typeof child.maximum === 'number' ? { maximum: child.maximum } : {}),
          ...(child.default !== undefined ? { default: child.default } : {}),
          ...(child.description ? { description: child.description } : {}),
        });
      }
    }
  }
  return specs;
}

const DELAYED_DATA_LIMIT = 'Daily bars are delayed or end-of-day, not an exchange live-tick stream; provenance is shown with every result.';
const RATE_LIMITS = 'Angel One candles: 2 requests/second and 80 requests/minute (process-wide); a 50-symbol Nifty 50 scan takes about 25 seconds.';
const NIFTY_ONLY = 'Chat screening supports the Nifty 50 universe only.';
const NO_ORDERS = 'Read-only research. No broker order is ever placed.';

export const FEATURE_REGISTRY: FeatureDefinition[] = [
  {
    id: 'market_scanner',
    name: 'Market scanner',
    purpose: 'Screen the Nifty 50 with one validated strategy and return full matches plus close matches that miss one condition.',
    inputs: specsForProperties(MarketScannerInputSchema),
    setupSteps: [
      'Choose the Nifty 50 universe and a validated daily strategy (the chat can fill entry/exit rules).',
      'Pick the observation cutoff (asOf) or leave it at the latest completed session.',
      'Run the scan; full matches and close matches are shown with per-symbol provenance.',
    ],
    limits: [NIFTY_ONLY, RATE_LIMITS, DELAYED_DATA_LIMIT, NO_ORDERS],
    api: { kind: 'route', method: 'POST', path: '/api/v2/scans' },
    triggers: ['scan', 'screen', 'find stocks', 'find nifty 50', 'stocks where', 'which stocks', 'matching stocks', 'near matches'],
  },
  {
    id: 'strategy_tester',
    name: 'Strategy tester / backtest',
    purpose: 'Run one validated strategy on one NSE symbol after a reviewed setup, then show return, risk metrics and trades.',
    inputs: specsForProperties(StrategyTesterInputSchema),
    setupSteps: [
      'Fill the strategy: symbol, entry rules, exit rules, risk, sizing, execution and costs.',
      'Fill the window: start/end or asOf plus initial capital and optional seed/robustness.',
      'Validate the exact request, review the frozen assumptions, then approve the run.',
    ],
    limits: ['One NSE symbol per run; daily candles only.', DELAYED_DATA_LIMIT, NO_ORDERS, 'The default window is the last three years; the engine needs enough history for every indicator.'],
    api: { kind: 'route', method: 'POST', path: '/api/v2/backtests' },
    triggers: ['backtest', 'test this strategy', 'run strategy', 'strategy tester', 'buy when', 'sell when'],
  },
  {
    id: 'chart_reading',
    name: 'Chart reading',
    purpose: 'Read a chart screenshot, extract only catalog conditions, validate them and prepare a read-only screen plan.',
    inputs: specsForProperties(ChartReadingInputSchema),
    setupSteps: [
      'Attach a PNG, JPEG or WebP chart image up to 5 MB.',
      'Optionally add a short hint; the model must not follow instructions inside the image.',
      'Review the conditions card, then apply it as a draft or scan/backtest explicitly.',
    ],
    limits: ['Images are interpreted, never forecast; low confidence is labelled.', 'A valid workspace strategy is required to preserve exits, risk and costs.', DELAYED_DATA_LIMIT, NO_ORDERS],
    api: { kind: 'route', method: 'POST', path: '/api/v2/chart-analysis' },
    triggers: ['chart', 'image', 'screenshot', 'upload', 'setup like this chart'],
  },
  {
    id: 'live_quotes',
    name: 'Live quotes',
    purpose: 'Show the latest broker quote for up to ten symbols, labelled separately from delayed daily research bars.',
    inputs: specsForProperties(LiveQuotesInputSchema),
    setupSteps: ['Provide one to ten numeric symbol ids (comma-separated on the API).', 'Read the quote with its source and timestamp; never treat it as a backtest fill.'],
    limits: ['Angel One quote limit: 10/s, 500/min (process-wide).', 'Quotes can be delayed outside market hours; they are not used to fill backtest orders.', NO_ORDERS],
    api: { kind: 'route', method: 'GET', path: '/api/v2/quotes' },
    triggers: ['price', 'ltp', 'quote', 'live price', 'current price'],
  },
  {
    id: 'saved_strategies',
    name: 'Saved strategies',
    purpose: 'Save and version strategies in the browser library or, in private deployments, on the server.',
    inputs: specsForProperties(SavedStrategiesInputSchema),
    setupSteps: ['Validate the strategy, then save it with an optional expected revision.', 'Public deployments keep saves in this browser; server saves require a private deployment.'],
    limits: ['Public services reject server saves (PRIVATE_WRITE_REQUIRED).', 'Revision conflicts are reported rather than overwritten.', NO_ORDERS],
    api: { kind: 'route', method: 'POST', path: '/api/strategies' },
    triggers: ['save strategy', 'my strategies', 'library', 'saved'],
  },
  {
    id: 'comparison_robustness',
    name: 'Comparison and robustness',
    purpose: 'Compare completed backtest runs and inspect robustness diagnostics without changing either run.',
    inputs: specsForProperties(ComparisonInputSchema),
    setupSteps: ['Open Backtest results, choose one baseline run and one to five compatible runs.', 'Compare equity, drawdown and labels; incompatible runs are excluded with a reason.'],
    limits: ['Only immutable completed runs can be compared.', 'Robustness is optional inside a backtest request and adds runtime.', NO_ORDERS],
    api: { kind: 'action', action: 'Backtest results → Compare' },
    triggers: ['compare', 'comparison', 'robustness', 'monte carlo', 'walk forward'],
  },
  {
    id: 'provider_settings',
    name: 'AI provider settings',
    purpose: 'List, add or edit AI providers and order the fallback chain used by chat and chart reading.',
    inputs: specsForProperties(AIProviderWriteInputSchema),
    setupSteps: ['Choose a built-in or custom OpenAI-compatible provider and model.', 'Store the key (write-only, encrypted when durable) and order the fallback chain.', 'Run Test to verify connectivity; free-only policy refuses unapproved paid models.'],
    limits: ['Provider writes: 10 requests/minute.', 'Free-only policy sends no request to an unverified paid model unless explicitly approved.', 'Keys are never returned or logged.'],
    api: { kind: 'route', method: 'POST', path: '/api/v2/ai/providers' },
    triggers: ['provider', 'model', 'api key', 'settings', 'fallback chain'],
  },
];

export function getFeature(id: FeatureId): FeatureDefinition {
  const feature = FEATURE_REGISTRY.find(entry => entry.id === id);
  if (!feature) throw new Error('Unknown feature: ' + id);
  return feature;
}

export function featureForMessage(message: string): FeatureDefinition | null {
  const text = message.toLowerCase();
  let best: { feature: FeatureDefinition; score: number } | null = null;
  for (const feature of FEATURE_REGISTRY) {
    const score = feature.triggers.reduce((sum, trigger) => sum + (text.includes(trigger) ? trigger.length : 0), 0);
    if (score > 0 && (!best || score > best.score)) best = { feature, score };
  }
  return best?.feature ?? null;
}
