import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectNseInstruments, resolveAngelInstrument, resetAngelInstrumentCache, SMARTAPI_TOKEN_MAP } from '../../server/data/angelSymbols';

const FILLER = Array.from({ length: 1_000 }, (_, i) => ({ token: String(20000 + i), symbol: `FILL${i}-EQ`, name: `FILL${i}`, exch_seg: 'NSE' }));
const MASTER = JSON.stringify([
  { token: '2885', symbol: 'RELIANCE-EQ', name: 'RELIANCE', exch_seg: 'NSE' },
  { token: '3417', symbol: 'HCLTECH-EQ', name: 'HCLTECH', exch_seg: 'NSE' },
  { token: '99926000', symbol: 'Nifty 50', name: 'NIFTY', instrumenttype: 'AMXIDX', exch_seg: 'NSE' },
  { token: '99926009', symbol: 'Nifty Bank', name: 'BANKNIFTY', instrumenttype: 'AMXIDX', exch_seg: 'NSE' },
  { token: '500325', symbol: 'RELIANCE', name: 'RELIANCE', exch_seg: 'BSE' },
  { token: '12345', symbol: 'RELIANCE25NOVFUT', name: 'RELIANCE', exch_seg: 'NFO' },
  { token: '777', symbol: 'IDEA-EQ', name: 'IDEA', exch_seg: 'BSE' },
  ...FILLER
]);

let directory: string;
beforeEach(async () => {
  resetAngelInstrumentCache();
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'angel-master-test-'));
});
afterEach(async () => {
  resetAngelInstrumentCache();
  await fs.rm(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('Angel One token mapping', () => {
  it('prefers the verified static map without ever downloading the master', async () => {
    const fetcher = vi.fn(async () => { throw new Error('must not download'); });
    const reliance = await resolveAngelInstrument('RELIANCE', { fetch: fetcher as unknown as typeof fetch, cacheDirectory: directory });
    expect(reliance).toMatchObject({ token: '2885', exchange: 'NSE', kind: 'EQUITY' });
    expect(await resolveAngelInstrument('^NSEI', { fetch: fetcher as unknown as typeof fetch, cacheDirectory: directory })).toMatchObject({ token: '99926000', kind: 'INDEX' });
    expect(await resolveAngelInstrument('^NSEBANK', { fetch: fetcher as unknown as typeof fetch, cacheDirectory: directory })).toMatchObject({ token: '99926009', kind: 'INDEX' });
    expect(fetcher).not.toHaveBeenCalled();
    expect(SMARTAPI_TOKEN_MAP.RELIANCE.token).toBe('2885');
  });

  it('falls back to the instrument master for NSE equities and caches it once per day', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(MASTER, { status: 200, headers: { 'content-type': 'application/json' } }));
    const now = () => Date.parse('2026-11-16T05:00:00Z');
    const hcl = await resolveAngelInstrument('HCLTECH', { fetch: fetcher as unknown as typeof fetch, cacheDirectory: directory, now });
    expect(hcl).toMatchObject({ token: '3417', symbol: 'HCLTECH-EQ', exchange: 'NSE', kind: 'EQUITY' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe('https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json');
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'error' });

    // Same calendar day: served from .cache/angel-scrip-master.json with no request.
    resetAngelInstrumentCache();
    expect(await resolveAngelInstrument('HCLTECH', { fetch: fetcher as unknown as typeof fetch, cacheDirectory: directory, now })).toMatchObject({ token: '3417' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const cached = JSON.parse(await fs.readFile(path.join(directory, 'angel-scrip-master.json'), 'utf8'));
    expect(cached).toMatchObject({ version: 1, count: expect.any(Number) });
    expect(cached.symbols).toContainEqual(['HCLTECH', '3417', 'HCLTECH-EQ', 'EQUITY']);
  });

  it('refreshes the master on the next IST day', async () => {
    const fetcher = vi.fn(async () => new Response(MASTER, { status: 200 }));
    const first = () => Date.parse('2026-11-16T05:00:00Z');
    const second = () => Date.parse('2026-11-17T05:00:00Z');
    await resolveAngelInstrument('HCLTECH', { fetch: fetcher as unknown as typeof fetch, cacheDirectory: directory, now: first });
    resetAngelInstrumentCache();
    await resolveAngelInstrument('HCLTECH', { fetch: fetcher as unknown as typeof fetch, cacheDirectory: directory, now: second });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('fails closed with UNKNOWN_MAPPING instead of guessing', async () => {
    const fetcher = vi.fn(async () => new Response(MASTER, { status: 200 }));
    const options = { fetch: fetcher as unknown as typeof fetch, cacheDirectory: directory, now: () => Date.parse('2026-11-16T05:00:00Z') };
    await expect(resolveAngelInstrument('NOTREAL', options)).rejects.toMatchObject({ code: 'UNKNOWN_MAPPING' });
    await expect(resolveAngelInstrument('IDEA', options)).rejects.toMatchObject({ code: 'UNKNOWN_MAPPING' }); // BSE-only
    await expect(resolveAngelInstrument('^BSESN', options)).rejects.toMatchObject({ code: 'UNKNOWN_MAPPING' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('keeps only NSE -EQ equities and NSE indices from the 40 MB-style master', () => {
    const tuples = collectNseInstruments(`[${MASTER.slice(1, -1)}]`);
    expect(tuples).toContainEqual(['HCLTECH', '3417', 'HCLTECH-EQ', 'EQUITY']);
    expect(tuples.some(t => t[2] === 'RELIANCE' && t[3] === 'EQUITY')).toBe(false); // BSE ignored
    expect(tuples.some(t => t[2] === 'RELIANCE25NOVFUT')).toBe(false); // NFO ignored
    expect(tuples.filter(t => t[3] === 'INDEX').length).toBe(2);
  });

  it('refuses an oversized master response before buffering it', async () => {
    const fetcher = vi.fn(async () => new Response(MASTER, { status: 200, headers: { 'content-length': '99000000' } }));
    await expect(resolveAngelInstrument('HCLTECH', { fetch: fetcher as unknown as typeof fetch, cacheDirectory: directory })).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });
});
