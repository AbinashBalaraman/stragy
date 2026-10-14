// Read-only checks and validation-only origin probes for a local production build.
import assert from 'node:assert/strict';
const base = new URL(process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3000');
if (!['127.0.0.1','localhost','[::1]'].includes(base.hostname) || !['http:','https:'].includes(base.protocol)) throw new Error('Smoke checks are limited to a local server.');
const headers = process.env.API_ACCESS_TOKEN ? { Authorization: 'Bearer ' + process.env.API_ACCESS_TOKEN } : {};
async function get(route, expected = 200) {
  const response = await fetch(new URL(route,base),{headers,signal:AbortSignal.timeout(5000)});
  assert.equal(response.status,expected,`${route}: unexpected HTTP status ${response.status}`);
  return response;
}
// Empty proposal bodies fail validation before any provider call, job or save.
// A configured HTTPS public origin must work even on this local HTTP backend.
const publicOrigin = new URL(process.env.PUBLIC_ORIGIN || process.env.RENDER_EXTERNAL_URL || base.origin).origin;
async function checkWriteOrigin(origin, status, code) {
  const response = await fetch(new URL('/api/v2/ai/proposals',base),{
    method:'POST',headers:{...headers,'Content-Type':'application/json',Origin:origin,'X-Forwarded-Proto':'https','X-Forwarded-Host':'forbidden.invalid'},
    body:'{}',signal:AbortSignal.timeout(5000),
  });
  assert.equal(response.status,status,`Origin validation: unexpected HTTP status ${response.status}`);
  assert.equal((await response.json()).error?.code,code);
}
await checkWriteOrigin(publicOrigin,422,'VALIDATION_FAILED');
await checkWriteOrigin('https://forbidden.invalid',403,'ORIGIN_REJECTED');
assert.equal((await (await get('/health/live')).json()).status,'ok');
assert.equal((await (await get('/health/ready')).json()).status,'ready');
const capabilities = await (await get('/api/v2/capabilities')).json();
assert.equal(capabilities.liveTrading,false);
assert.equal(capabilities.executionPolicy,'next_open_long_cash_v1');
assert.deepEqual(capabilities.timeframes,['1D']);
const missing = await (await get('/api/v2/backtests/smoke-missing-run',404)).json();
assert.equal(missing.error.code,'BACKTEST_NOT_FOUND');
assert.equal(Object.hasOwn(missing,'result'),false);
const missingJob = await (await get('/api/v2/jobs/smoke-missing-job',404)).json();
assert.equal(missingJob.error.code,'JOB_NOT_FOUND');
for(const route of ['/server/server.cjs','/dist/server/worker.cjs','/.env','/server.cjs.map']) await get(route,404);
assert.match(await (await get('/')).text(),/<html/i);
console.log('Local production read-only checks and validation-only origin probes passed. No compute jobs, provider calls, saves, logins, or broker orders were requested.');
