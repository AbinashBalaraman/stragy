import { createHash } from 'node:crypto';
import type { ResearchChatResponse } from '../../shared/contracts/research-chat';

/** Bump when the chart guide or extraction prompts change materially. */
export const CHART_GUIDE_VERSION = 'chart-guide-v1';
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 200;

interface Entry {
  savedAt: number;
  value: ResearchChatResponse;
}

const cache = new Map<string, Entry>();

/** SHA-256 of image bytes + sanitized hint + guide version. */
export function chartReadingCacheKey(image: { base64: string }, hint: string): string {
  return createHash('sha256')
    .update(Buffer.from(image.base64, 'base64'))
    .update('\0')
    .update(hint)
    .update('\0')
    .update(CHART_GUIDE_VERSION)
    .digest('hex');
}

export function readChartReading(key: string): ResearchChatResponse | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.savedAt > TTL_MS) {
    cache.delete(key);
    return null;
  }
  // LRU: touch the entry.
  cache.delete(key);
  cache.set(key, entry);
  return JSON.parse(JSON.stringify(entry.value)) as ResearchChatResponse;
}

export function writeChartReading(key: string, value: ResearchChatResponse): void {
  cache.delete(key);
  cache.set(key, { savedAt: Date.now(), value: JSON.parse(JSON.stringify(value)) as ResearchChatResponse });
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function clearChartReadingCache(): void {
  cache.clear();
}

export function chartReadingCacheSize(): number {
  return cache.size;
}
