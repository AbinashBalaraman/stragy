/**
 * Network guards for operator-supplied provider endpoints.
 *
 * Write-time DNS validation alone is TOCTOU: a rebinding hostname can resolve
 * to a public address during upsert and to a metadata/internal address at
 * request time. createPinnedFetch re-validates every DNS answer at connection
 * time. Explicit loopback hosts stay usable for local model servers; any other
 * host may never connect to a private, link-local or metadata address.
 */
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { Readable } from 'node:stream';
import type { LookupAddress } from 'node:dns';
import type { LookupFunction } from 'node:net';

export function isPrivateIp(address: string): boolean {
  const ip = address.toLowerCase();
  if (ip === '::1' || ip === '::' || ip === '0.0.0.0') return ip !== '::1' ? true : false;
  if (ip.includes(':')) {
    if (ip.startsWith('fe80:') || ip.startsWith('fc') || ip.startsWith('fd')) return true;
    if (ip.startsWith('::ffff:')) {
      const rest = ip.slice(7);
      // Hex form (::ffff:7f00:1) maps to dotted IPv4 just like ::ffff:127.0.0.1.
      if (rest.includes(':')) {
        const groups = rest.split(':');
        if (groups.length === 2 && groups.every(g => /^[0-9a-f]{1,4}$/.test(g))) {
          const n = (parseInt(groups[0], 16) << 16) | parseInt(groups[1], 16);
          return isPrivateIp([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'));
        }
        return true; // unrecognized mapped form: fail closed
      }
      return isPrivateIp(rest);
    }
    return false;
  }
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

export function literalIp(host: string): string | null {
  const value = host.replace(/^\[|\]$/g, '');
  return /^[0-9.]+$/.test(value) || value.includes(':') ? value : null;
}

export type FetchLike = (input: string, init?: any) => Promise<any>;

/** Structural DNS lookup: matches both callback dns.lookup and promise seams. */
export type DnsLookupLike = (
  hostname: string,
  options: { all: true; family?: number },
  callback: (err: NodeJS.ErrnoException | null, addresses?: LookupAddress[] | string) => void,
) => unknown;

function loopbackAnswer(address: string): boolean {
  return address === '127.0.0.1' || address === '::1';
}

/**
 * Minimal fetch-compatible response over node:http(s) with a guarded lookup.
 * Supports the surface the AI layer uses: ok/status/headers.get/body stream
 * (getReader/cancel)/text()/json(), manual redirects and AbortSignal.
 */
export function createPinnedFetch(getLookup: () => DnsLookupLike = () => dns.lookup as unknown as DnsLookupLike): FetchLike {
  return (input: string, init: any = {}) => new Promise((resolve, reject) => {
    let url: URL;
    try { url = new URL(input); } catch { reject(new Error('Invalid provider URL.')); return; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') { reject(new Error('Unsupported provider protocol.')); return; }
    const host = url.hostname.toLowerCase();
    const explicitLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
    const mod = url.protocol === 'http:' ? http : https;
    const lookup: LookupFunction = (hostname, options, callback) => {
      const dnsLookup = getLookup();
      let settled = false;
      const done = (err: NodeJS.ErrnoException | null, addresses?: LookupAddress[] | string) => {
        if (settled) return;
        settled = true;
        if (err) return callback(err, '', 4);
        const list = (Array.isArray(addresses) ? addresses : [{ address: String(addresses), family: 4 }]) as LookupAddress[];
        const safe = list.filter(item => !isPrivateIp(item.address) || (explicitLoopback && loopbackAnswer(item.address)));
        if (!safe.length) {
          callback(new Error('Provider host resolved to a private or metadata address at connection time.'), '', 4);
          return;
        }
        // net with autoSelectFamily (Node >= 20 default) calls lookup with
        // all:true and requires the ARRAY callback form; the single-address
        // form is only valid for all:false.
        if (options.all) callback(null, safe.map(item => ({ address: item.address, family: item.family })));
        else callback(null, safe[0].address, safe[0].family);
      };
      // Support both callback-style dns.lookup and promise-style test seams.
      let result: unknown;
      try {
        result = (dnsLookup as (h: string, o: unknown, cb: (e: NodeJS.ErrnoException | null, a?: LookupAddress[] | string) => void) => unknown)(
          hostname, { all: true, ...(options.family ? { family: options.family } : {}) }, done);
      } catch (err) {
        done(err as NodeJS.ErrnoException);
        return;
      }
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        (result as Promise<LookupAddress[] | string>).then(addresses => done(null, addresses), err => done(err));
      }
    };
    const agent = new mod.Agent({ lookup, keepAlive: false });
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries((init.headers ?? {}) as Record<string, unknown>)) headers[name] = String(value);
    if (init.body !== undefined && init.body !== null) headers['Content-Length'] = String(Buffer.byteLength(String(init.body)));
    const req = mod.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (url.protocol === 'http:' ? 80 : 443),
      path: url.pathname + url.search,
      method: init.method ?? 'GET',
      headers,
      agent,
      // node:http never follows redirects: parity with fetch redirect:'manual'.
    }, (res) => {
      const status = res.statusCode ?? 0;
      const stream = Readable.toWeb(res) as unknown as ReadableStream<Uint8Array>;
      const readAll = async (): Promise<string> => {
        const reader = stream.getReader();
        const chunks: Uint8Array[] = [];
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) chunks.push(value);
        }
        return Buffer.concat(chunks).toString('utf8');
      };
      res.on('close', () => { removeAbortListener(); agent.destroy(); });
      resolve({
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (name: string) => { const v = res.headers[name.toLowerCase()]; return Array.isArray(v) ? v.join(', ') : v ?? null; } },
        body: stream,
        text: readAll,
        json: async () => JSON.parse(await readAll()),
      });
    });
    // Attach the error handler BEFORE honoring the signal: a pre-aborted
    // signal destroys the request, and without a listener that 'error' event
    // would crash the process and leave the promise pending forever.
    let removeAbortListener = () => {};
    req.on('error', (error) => { removeAbortListener(); agent.destroy(); reject(error); });
    const abort = () => {
      const error = new Error('The provider request was aborted.');
      error.name = 'AbortError';
      req.destroy(error);
    };
    if (init.signal) {
      if (init.signal.aborted) { abort(); return; }
      init.signal.addEventListener('abort', abort, { once: true });
      removeAbortListener = () => init.signal.removeEventListener('abort', abort);
    }
    if (init.body !== undefined && init.body !== null) req.write(init.body);
    req.end();
  });
}
