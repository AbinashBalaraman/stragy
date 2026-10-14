import { beforeEach, afterEach, vi } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.DATA_MODE = 'demo';
process.env.AI_PROVIDER = 'none';
process.env.EXPOSURE_MODE = 'private';
const denyNetwork = async (): Promise<Response> => { throw new Error('External network is disabled in offline tests. Inject a fixture provider.'); };
beforeEach(() => { vi.stubGlobal('fetch', denyNetwork); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
