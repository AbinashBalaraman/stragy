import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectInstruments, collectNseInstruments, resolveAngelInstrument, resetAngelInstrumentCache, SMARTAPI_TOKEN_MAP } from '../../server/data/angelSymbols';

const FILLER = Array.from({ length: 1_000 }, (_, i) => ({ token: String(20000 + i), symbol: `FILL${i}-EQ`, name: `FILL${i}`, exch_seg: 'NSE' }));
const MASTER = JSON.stringify([
  { token: '2885', symbol: 'RELIANCE-EQ', name: 'RELIANCE', exch_seg: 'NSE' },
  { token: '3417', symbol: 'HCLTECH-EQ', name: 'HCLTECH', exch_seg: 'NSE' },
  { token: '99926000', symbol: 'Nifty 50', name: 'NIFTY', instrumenttype: 'AMXIDX', exch_seg: 'NSE' },
  { token: '99926009', symbol: 'Nifty Bank', name: 'BANKNIFTY', instrumenttype: 'AMXIDX', exch_seg: 'NSE' },
  { token: '99926008', symbol: 'Nifty IT', name: 'NIFTY IT', instrumenttype: 'AMXIDX', exch_seg: 'NSE' },
  { token: '99919000', symbol: 'SENSEX', name: 'SENSEX', instrumenttype: 'AMXIDX', exch_seg: 'BSE' },
  { token: '500325', symbol: 'RELIANCE', name: 'RELIANCE', exch_seg: 'BSE' },
  { token: '500180', symbol: 'HDFCBANK', name: 'HDFC BANK', exch_seg: 'BSE' },
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
    expect(cached).toMatchObject({ version: 2, count: expect.any(Number) });
    expect(cached.symbols).toContainEqual(['HCLTECH', '3417', 'NSE', 'HCLTECH-EQ', 'EQUITY']);
    expect(cached.symbols).toContainEqual(['RELIANCE', '500325', 'BSE', 'RELIANCE', 'EQUITY']);
  });

  it('resolves BSE scrip codes and index aliases from the provider master, never by guessing', async () => {
    const fetcher = vi.fn(async () => new Response(MASTER, { status: 200 }));
    const options = { fetch: fetcher as unknown as typeof fetch, cacheDirectory: directory, now: () => Date.parse('2026-11-16T05:00:00Z') };
    expect(await resolveAngelInstrument('500325.BO', options)).toMatchObject({ ticker: '500325.BO', token: '500325', exchange: 'BSE', kind: 'EQUITY' });
    expect(await resolveAngelInstrument('^CNXIT', options)).toMatchObject({ ticker: '^CNXIT', token: '99926008', exchange: 'NSE', kind: 'INDEX' });
    expect(await resolveAngelInstrument('^BSESN', options)).toMatchObject({ ticker: '^BSESN', token: '99919000', exchange: 'BSE', kind: 'INDEX' });
    expect(fetcher).toHaveBeenCalledTimes(1);
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
    await expect(resolveAngelInstrument('IDEA', options)).rejects.toMatchObject({ code: 'UNKNOWN_MAPPING' }); // BSE-only suffix is not an NSE ticker
    await expect(resolveAngelInstrument('^CNXAUTO', options)).rejects.toMatchObject({ code: 'UNKNOWN_MAPPING' }); // not in this master
    await expect(resolveAngelInstrument('^NIFTY_UNKNOWN', options)).rejects.toMatchObject({ code: 'UNKNOWN_MAPPING' });
    await expect(resolveAngelInstrument('500999.BO', options)).rejects.toMatchObject({ code: 'UNKNOWN_MAPPING' }); // scrip code absent
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('keeps only NSE/BSE cash equities and NSE/BSE indices from the 40 MB-style master', () => {
    const tuples = collectInstruments(`[${MASTER.slice(1, -1)}]`);
    expect(tuples).toContainEqual(['HCLTECH', '3417', 'NSE', 'HCLTECH-EQ', 'EQUITY']);
    expect(tuples).toContainEqual(['RELIANCE', '500325', 'BSE', 'RELIANCE', 'EQUITY']);
    expect(tuples.some(t => t[3] === 'RELIANCE25NOVFUT')).toBe(false); // NFO ignored
    expect(tuples.some(t => t[2] === 'BSE' && t[3] === 'IDEA-EQ')).toBe(false); // odd BSE suffix ignored
    expect(tuples.filter(t => t[4] === 'INDEX')).toHaveLength(4);
    expect(collectNseInstruments(`[${MASTER.slice(1, -1)}]`).every(t => t[2] === 'NSE')).toBe(true);
  });

  it('refuses an oversized master response before buffering it', async () => {
    const fetcher = vi.fn(async () => new Response(MASTER, { status: 200, headers: { 'content-length': '99000000' } }));
    await expect(resolveAngelInstrument('HCLTECH', { fetch: fetcher as unknown as typeof fetch, cacheDirectory: directory })).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });
});
