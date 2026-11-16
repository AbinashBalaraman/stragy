import type { ChartAnalysisResponse } from './chartAnalysis';
import { parseChartAnalysisResponse } from './chartAnalysis';

/**
 * Session/store cache for a chart reading, keyed by the SHA-256 of the exact
 * image bytes. The same image therefore yields the same extracted conditions
 * instead of a fresh, possibly different model read. Only validated responses
 * are stored; a corrupt entry is ignored and removed.
 */
const CACHE_PREFIX = 'stragy_chart_reading_v1:';
const INDEX_KEY = 'stragy_chart_reading_v1_index';
const MAX_ENTRIES = 6;

function storage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

export async function chartImageHash(dataUrl: string): Promise<string | null> {
  try {
    const comma = dataUrl.indexOf(',');
    if (comma < 0) return null;
    const base64 = dataUrl.slice(comma + 1);
    const subtle = globalThis.crypto?.subtle;
    if (!subtle || typeof atob !== 'function') return null;
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    const digest = await subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

export function readCachedChartAnalysis(hash: string): ChartAnalysisResponse | null {
  const store = storage();
  if (!store || !/^[a-f0-9]{64}$/.test(hash)) return null;
  const key = CACHE_PREFIX + hash;
  try {
    const raw = store.getItem(key);
    if (!raw) return null;    const parsed = JSON.parse(raw) as { data?: unknown };
    const response = parseChartAnalysisResponse(parsed.data);
    if (!response.chartReading) throw new Error('Cached entry has no chart reading');
    return response;
  } catch {
    try { store.removeItem(key); } catch { /* ignore */ }
    return null;
  }
}

export function writeCachedChartAnalysis(hash: string, response: ChartAnalysisResponse): boolean {
  const store = storage();
  if (!store || !/^[a-f0-9]{64}$/.test(hash) || !response.chartReading) return false;
  try {
    const keys = readIndex(store);
    const key = CACHE_PREFIX + hash;
    // Store the server-shaped response, not the parsed object (which adds
    // `chartReading` and would be rejected as an unknown key on read).
    const raw: Record<string, unknown> = { ...response };
    delete raw.chartReading;
    store.setItem(key, JSON.stringify({ schemaVersion: 1, savedAt: new Date().toISOString(), data: raw }));
    const next = [key, ...keys.filter(existing => existing !== key)].slice(0, MAX_ENTRIES);
    for (const old of keys) if (!next.includes(old)) store.removeItem(old);
    store.setItem(INDEX_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

export function clearChartReadingCache(): void {
  const store = storage();
  if (!store) return;
  try {
    for (const key of readIndex(store)) store.removeItem(key);
    store.removeItem(INDEX_KEY);
  } catch { /* ignore */ }
}

function readIndex(store: Storage): string[] {
  try {
    const parsed = JSON.parse(store.getItem(INDEX_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === 'string' && key.startsWith(CACHE_PREFIX)) : [];
  } catch {
    return [];
  }
}
