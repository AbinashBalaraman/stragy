import { describe, expect, it } from 'vitest';
import { parseConfig } from '../../server/config';

const demo = { NODE_ENV: 'production', EXPOSURE_MODE: 'demo-public' };

describe('trusted deployment public origin', () => {
  it('uses Render deployment configuration without trusting forwarded request headers', () => {
    expect(parseConfig({ ...demo, RENDER_EXTERNAL_URL: 'https://stragy.onrender.com' }).PUBLIC_ORIGIN).toBe('https://stragy.onrender.com');
  });
  it('allows an explicit custom origin and normalizes configuration only', () => {
    expect(parseConfig({ ...demo, PUBLIC_ORIGIN: ' https://Research.Example:443/ ', RENDER_EXTERNAL_URL: 'https://stragy.onrender.com' }).PUBLIC_ORIGIN).toBe('https://research.example');
    expect(parseConfig({ PUBLIC_ORIGIN: 'http://127.0.0.1:3903' }).PUBLIC_ORIGIN).toBe('http://127.0.0.1:3903');
  });
  it('leaves direct local deployments compatible when no public origin is configured', () => {
    expect(parseConfig({ NODE_ENV: 'test' }).PUBLIC_ORIGIN).toBeUndefined();
  });
  it.each([
    '', '*', 'null', 'not a URL', '//stragy.onrender.com', 'ftp://stragy.onrender.com',
    'https://stragy.onrender.com/path', 'https://stragy.onrender.com/?query=1',
    'https://stragy.onrender.com/#fragment', 'https://fixture-user@example.test', 'https://:fixture-password@example.test',
    'https://one.example,https://two.example',
  ])('rejects unsafe or ambiguous deployment origin %s', value => {
    expect(() => parseConfig({ ...demo, PUBLIC_ORIGIN: value })).toThrow(/PUBLIC_ORIGIN/);
  });
  it('fails closed on an invalid Render URL rather than silently permitting other origins', () => {
    expect(() => parseConfig({ ...demo, RENDER_EXTERNAL_URL: 'https://example.test/unexpected/path' })).toThrow(/PUBLIC_ORIGIN/);
    expect(() => parseConfig({ ...demo, PUBLIC_ORIGIN: '', RENDER_EXTERNAL_URL: 'https://stragy.onrender.com' })).toThrow(/PUBLIC_ORIGIN/);
  });
});
