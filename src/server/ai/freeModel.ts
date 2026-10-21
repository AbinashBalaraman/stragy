import type { FetchLike } from './provider';
export const TOKENROUTER_PRICING_URL = 'https://tokenrouter-backend-api.tokenrouter.com/backend-api/api/pricing?sort_type=5';
export const VERIFIED_FREE_MODEL = 'stealth/union-alpha';
/** Public catalog shape observed on TokenRouter's model pricing page. Unknown pricing fails closed. */
export function isZeroPricedModel(raw: unknown, model: string): boolean {
  if (model !== VERIFIED_FREE_MODEL || !raw || typeof raw !== 'object') return false;
  const data = raw as Record<string, any>;
  if (data.success !== true || !Array.isArray(data.data)) return false;
  const records = data.data.filter((item: any) => item?.model_name === model);
  if (records.length !== 1) return false;
  const row = records[0];
  if (row.quota_type !== 0 || row.model_ratio !== 0 || row.model_price !== 0 || row.completion_ratio !== 1 || !row.supported_endpoint_types?.includes('openai')) return false;
  for (const field of ['tiered_pricing', 'candidates_pricing', 'video_generation_pricing']) if (data[field]?.[model] !== undefined) return false;
  // Do not approve new billing fields automatically when the public catalog changes.
  const allowed = new Set(['model_ratio', 'model_price', 'completion_ratio']);
  for (const [name, value] of Object.entries(row)) if (/price|ratio|cost|fee/i.test(name) && !allowed.has(name) && value !== 0) return false;
  return true;
}
export async function verifyFreeModel(fetcher: FetchLike, model: string, signal: AbortSignal): Promise<boolean> {
  if (model !== VERIFIED_FREE_MODEL || signal.aborted) return false;
  try {
    const response = await fetcher(TOKENROUTER_PRICING_URL, { method: 'GET', signal, redirect: 'error', headers: { Accept: 'application/json' } });
    if (!response.ok || Number(response.headers?.get?.('content-length')) > 512_000) return false;
    let text: string;
    if (response.body?.getReader) {
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > 512_000) { await reader.cancel(); return false; } chunks.push(chunk.value); } }
      finally { reader.releaseLock(); }
      text = Buffer.concat(chunks).toString('utf8');
    } else text = typeof response.text === 'function' ? await response.text() : JSON.stringify(await response.json());
    if (Buffer.byteLength(text) > 512_000 || signal.aborted) return false;
    return isZeroPricedModel(JSON.parse(text), model);
  } catch { return false; }
}
