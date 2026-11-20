import { z } from 'zod';

const PublicOriginSchema = z.string().trim().url().refine(value => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash;
  } catch { return false; }
}, 'Expected an HTTP(S) origin without credentials, a path, query or fragment').transform(value => new URL(value).origin);

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('127.0.0.1'),
  PUBLIC_ORIGIN: PublicOriginSchema.optional(),
  DATA_MODE: z.enum(['demo', 'real']).default('demo'),
  MARKET_PROVIDER: z.enum(['none', 'yahoo', 'angel']).default('none'),
  // Owner's Angel One SmartAPI broker account (read-only quotes/candles; no orders).
  // Angel One's terms on redistributing market data apply to any public site, so
  // public-research deployments must review that entitlement before enabling this.
  QUOTES_PROVIDER: z.enum(['none', 'angel']).default('none'),
  AI_PROVIDER: z.enum(['none', 'gemini', 'openai', 'openrouter', 'deepseek', 'tokenrouter', 'opencode-go']).default('none'),
  AI_MODEL: z.string().trim().min(1).max(120).optional(),
  /** Cross-provider fallbacks, e.g. opencode-go:deepseek-v4.1-flash,openrouter:openrouter/free. */
  AI_FALLBACK_MODELS: z.string().optional(),
  /** Explicit provider:model paid approvals under free-only. */
  AI_APPROVED_PAID_MODELS: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  DATABASE_URL_UNPOOLED: z.string().optional(),
  /** AES-256-GCM key for stored provider keys (base64, 32 bytes). Never logged. */
  PROVIDER_SECRETS_KEY: z.string().optional(),
  VISION_PROVIDER: z.enum(['none', 'gemini', 'openai', 'openrouter', 'deepseek', 'tokenrouter', 'opencode-go']).optional(),
  VISION_MODEL: z.string().trim().min(1).max(100).optional(),
  EXPOSURE_MODE: z.enum(['private', 'demo-public', 'public-research']).default('private'),
  /** Browser Basic-auth gate for the whole private site. Never logged or echoed. */
  SITE_PASSWORD: z.string().optional(),
  SITE_USER: z.string().trim().min(1).max(100).default('owner'),
  AI_COST_POLICY: z.enum(['free-only', 'operator-approved']).default('free-only'),
  API_ACCESS_TOKEN: z.string().optional(),
  MAX_BODY_BYTES: z.coerce.number().int().min(1024).max(1_048_576).default(262_144),
  MAX_QUEUE: z.coerce.number().int().min(1).max(32).default(8),
  MAX_JOB_MS: z.coerce.number().int().min(1000).max(120_000).default(30_000),
  MAX_STORED_RUNS: z.coerce.number().int().min(1).max(100).default(20),
  STORAGE_MODE: z.enum(['ephemeral', 'local-file']).default('ephemeral'),
  STORAGE_PATH: z.string().optional(),
});
export type RuntimeConfig = z.infer<typeof ConfigSchema>;
export function parseConfig(env: Record<string, string | undefined> = process.env): RuntimeConfig {
  // Render terminates HTTPS before proxying to Express. Use trusted deployment
  // configuration, never client-controlled forwarded headers, for browser writes.
  const parsed = ConfigSchema.safeParse({ ...env, PUBLIC_ORIGIN: env.PUBLIC_ORIGIN ?? env.RENDER_EXTERNAL_URL });
  if (!parsed.success) throw new Error('Invalid server configuration: ' + parsed.error.issues.map(i => i.path.join('.')).join(', '));
  const config = parsed.data;
  if (config.SITE_PASSWORD !== undefined && config.SITE_PASSWORD.length < 12) throw new Error('SITE_PASSWORD must be at least 12 characters. Use a long random passphrase; it is never logged.');
  if (config.EXPOSURE_MODE === 'demo-public' && (config.DATA_MODE !== 'demo' || config.AI_PROVIDER !== 'none' || (config.VISION_PROVIDER !== undefined && config.VISION_PROVIDER !== 'none'))) throw new Error('Public demo mode cannot enable real data or external AI.');
  if (config.EXPOSURE_MODE === 'public-research' && (config.DATA_MODE !== 'real' || !['yahoo', 'angel'].includes(config.MARKET_PROVIDER) || config.QUOTES_PROVIDER !== 'none' && config.QUOTES_PROVIDER !== 'angel')) throw new Error('Public research requires an observed-data provider (yahoo or the owner Angel One account) and no other live-quote source.');
  if (config.EXPOSURE_MODE === 'public-research' && (config.AI_PROVIDER !== 'none' || (config.VISION_PROVIDER !== undefined && config.VISION_PROVIDER !== 'none')) && config.AI_COST_POLICY !== 'free-only') throw new Error('Public research cannot expose unapproved paid AI usage.');
  if (config.NODE_ENV === 'production' && config.EXPOSURE_MODE === 'private' && !config.API_ACCESS_TOKEN && !config.SITE_PASSWORD) throw new Error('Private production API requires SITE_PASSWORD for the browser or API_ACCESS_TOKEN for API clients.');
  if (config.STORAGE_MODE === 'local-file' && !config.STORAGE_PATH) throw new Error('Local-file storage requires an explicit persistent STORAGE_PATH.');
  return config;
}
export function redact(value: unknown): string {
  const secrets = Object.entries(process.env).filter(([k,v]) => /(KEY|TOKEN|SECRET|PASSWORD|CLIENT_CODE|DATABASE_URL)/i.test(k) && v && v.length >= 4).map(([,v]) => v!);
  let text = typeof value === 'string' ? value : value instanceof Error ? value.message : JSON.stringify(value);
  for (const secret of secrets) text = text.split(secret).join('[REDACTED]');
  return text.replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]').replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, 'postgres://[REDACTED]');
}
