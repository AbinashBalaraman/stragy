/** Stragy API client. All calls are same-origin /api/* and proxied to the configured data API. */

export type CacheStats = {
  symbols: number;
  bars: number;
  firstDate: string;
  lastDate: string;
  dbBytes: number;
  hits: number;
  misses: number;
  lastFetchAt?: string;
};
export type JobSummary = {
  id: string;
  kind: string;
  status: string;
  stage: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  progress?: { processed?: number; total?: number; step?: number; steps?: number };
  resumable: boolean;
};
export type Strategy = { id?: string; name?: string; [k: string]: unknown };
export type Health = { status: string; mode: string; time?: string };

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`);
  if (!res.ok) throw new Error(`Stragy ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<T>;
}

async function postJob(path: string, body: unknown): Promise<{ jobId: string; status: string }> {
  const res = await fetch(`/api${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Stragy ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<{ jobId: string; status: string }>;
}

export const stragy = {
  health: () => get<Health>('/health'),
  cache: async () => {
    const raw = await get<{ stats: CacheStats } | CacheStats>('/v2/market/cache');
    return ('stats' in raw ? raw.stats : raw) as CacheStats;
  },
  jobs: async (limit = 40): Promise<JobSummary[]> => {
    const raw = await get<{ jobs: JobSummary[] } | JobSummary[]>(`/v2/jobs?limit=${limit}`);
    return Array.isArray(raw) ? raw : raw.jobs || [];
  },
  strategies: async (): Promise<Strategy[]> => {
    const raw = await get<{ strategies: Strategy[] } | Strategy[]>('/strategies');
    return Array.isArray(raw) ? raw : raw.strategies || [];
  },
  capabilities: () => get<Record<string, unknown>>('/v2/capabilities'),
  refreshCache: async () => {
    const res = await fetch('/api/v2/market/cache/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    if (!res.ok) throw new Error(`Stragy refresh ${res.status}`);
    return res.json().catch(() => ({}));
  },
  /** Real enqueue routes. All return a jobId that appears in /api/v2/jobs. */
  createScan: (universe = 'NIFTY_50', limit = 35) => postJob('/v2/scans', { universe, limit }),
  createMarketCheck: (universe = 'NIFTY_50') => postJob('/v2/market-snapshots', { universe }),
  job: (id: string) => get<JobSummary>(`/v2/jobs/${encodeURIComponent(id)}`),
  cancelJob: (id: string) => fetch(`/api/v2/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  resumeJob: (id: string) => fetch(`/api/v2/jobs/${encodeURIComponent(id)}/resume`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }),
  /** Best-effort index level lookup; returns null when not available. */
  async indexLevel(symbol: 'NIFTY' | 'SENSEX'): Promise<{ level: number; change: number; date: string } | null> {
    try {
      const raw = await get<{ trends?: Array<Record<string, unknown>> }>(`/market/trends?universe=${symbol}`);
      const first = raw?.trends?.[0];
      if (!first) return null;
      const level = Number(first.close ?? first.level ?? first.value ?? first.price);
      if (!Number.isFinite(level)) return null;
      const change = Number(first.change ?? first.changePercent ?? first.pctChange ?? 0);
      const date = String(first.date ?? first.formattedDate ?? '');
      return { level, change, date };
    } catch {
      return null;
    }
  },
};
