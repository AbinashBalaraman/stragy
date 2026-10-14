import { z } from 'zod';

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('127.0.0.1'),
  DATA_MODE: z.enum(['demo', 'real']).default('demo'),
  AI_PROVIDER: z.enum(['none', 'gemini', 'openai', 'openrouter', 'deepseek']).default('none'),
  EXPOSURE_MODE: z.enum(['private', 'demo-public']).default('private'),
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
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) throw new Error('Invalid server configuration: ' + parsed.error.issues.map(i => i.path.join('.')).join(', '));
  const config = parsed.data;
  if (config.EXPOSURE_MODE === 'demo-public' && (config.DATA_MODE !== 'demo' || config.AI_PROVIDER !== 'none')) throw new Error('Public demo mode cannot enable real data or external AI.');
  if (config.NODE_ENV === 'production' && config.EXPOSURE_MODE === 'private' && !config.API_ACCESS_TOKEN) throw new Error('Private production API requires API_ACCESS_TOKEN or a separately verified authenticated deployment boundary.');
  if (config.STORAGE_MODE === 'local-file' && !config.STORAGE_PATH) throw new Error('Local-file storage requires an explicit persistent STORAGE_PATH.');
  return config;
}
export function redact(value: unknown): string {
  const secrets = Object.entries(process.env).filter(([k,v]) => /(KEY|TOKEN|SECRET|PASSWORD|CLIENT_CODE)/i.test(k) && v && v.length >= 4).map(([,v]) => v!);
  let text = typeof value === 'string' ? value : value instanceof Error ? value.message : JSON.stringify(value);
  for (const secret of secrets) text = text.split(secret).join('[REDACTED]');
  return text.replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]');
}
