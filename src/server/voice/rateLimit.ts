/**
 * In-process sliding-window rate limit for the voice route.
 *
 * The app-wide /api budget (90 req/min/IP) is deliberately generous; server-side
 * transcription calls a paid-attention-but-free provider and deserves its own
 * tighter budget. State is per app instance, so tests get a clean limiter.
 */
export interface VoiceRateLimiter {
  /** Record one attempt for the client; false means the budget is exhausted. */
  take(clientKey: string): boolean;
  reset(): void;
}

export interface VoiceRateLimiterOptions {
  limit?: number;
  windowMs?: number;
  now?: () => number;
}

export function createVoiceRateLimiter(options: VoiceRateLimiterOptions = {}): VoiceRateLimiter {
  const limit = options.limit ?? 10;
  const windowMs = options.windowMs ?? 60_000;
  const now = options.now ?? Date.now;
  const hits = new Map<string, number[]>();
  return {
    take(clientKey: string): boolean {
      const at = now();
      const recent = (hits.get(clientKey) ?? []).filter(time => at - time < windowMs);
      if (recent.length >= limit) {
        hits.set(clientKey, recent);
        return false;
      }
      recent.push(at);
      hits.set(clientKey, recent);
      if (hits.size > 1024) {
        for (const [key, times] of hits) if (times.length === 0 || at - times[times.length - 1] >= windowMs) hits.delete(key);
        if (hits.size > 1024) hits.delete(hits.keys().next().value!);
      }
      return true;
    },
    reset(): void { hits.clear(); },
  };
}
