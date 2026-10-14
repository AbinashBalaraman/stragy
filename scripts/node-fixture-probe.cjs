// Restricted-runtime fallback only. This is not Vitest and does not replace the normal suite.
// Runs the unchanged financial/storage test bodies after tsc CommonJS emission.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '..');
const output = process.argv[2];
process.chdir(root);
process.env.NODE_ENV = 'test';
process.env.DATA_MODE = 'demo';
process.env.AI_PROVIDER = 'none';
global.fetch = async () => { throw new Error('External network is disabled in the Node fixture probe.'); };
const cases = [], hooks = [];
let suite = '';
function describe(name, body) { const previous = suite; suite = previous ? previous + ' / ' + name : name; body(); suite = previous; }
function it(name, body) { cases.push({ name: suite + ' / ' + name, body }); }
it.each = rows => (name, body) => rows.forEach((row, index) => it(name.replace(/\$(\w+)/g, (_m, key) => String(row[key] ?? index)), () => body(row)));
function clean(value) {
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) return Object.fromEntries(Object.entries(value).filter(([,v]) => v !== undefined).map(([k,v]) => [k, clean(v)]));
  return value;
}
function subset(actual, expected) {
  if (expected && typeof expected === 'object') {
    assert.ok(actual && typeof actual === 'object', 'Expected an object for partial matching');
    for (const key of Object.keys(expected)) subset(actual[key], expected[key]);
  } else assert.strictEqual(actual, expected);
}
function api(actual, invert = false) {
  const check = operation => {
    if (!invert) return operation();
    let failed = false;
    try { operation(); } catch (error) { if (!(error instanceof assert.AssertionError)) throw error; failed = true; }
    assert.ok(failed, 'Negated assertion unexpectedly matched');
  };
  const result = {
    toBe: expected => check(() => assert.strictEqual(actual, expected)),
    toEqual: expected => check(() => assert.deepStrictEqual(clean(actual), clean(expected))),
    toMatchObject: expected => check(() => subset(actual, expected)),
    toHaveLength: length => check(() => assert.strictEqual(actual.length, length)),
    toBeNull: () => check(() => assert.strictEqual(actual, null)),
    toBeUndefined: () => check(() => assert.strictEqual(actual, undefined)),
    toContain: expected => check(() => assert.ok(actual.includes(expected))),
    toBeGreaterThanOrEqual: expected => check(() => assert.ok(actual >= expected)),
    toBeLessThan: expected => check(() => assert.ok(actual < expected)),
    toBeCloseTo: (expected, digits = 2) => check(() => { assert.ok(Number.isFinite(actual) && Number.isFinite(expected)); assert.ok(Math.abs(actual - expected) < 0.5 * 10 ** -digits, `${actual} is not close to ${expected}`); }),
    toThrow: expected => check(() => {
      assert.strictEqual(typeof actual, 'function');
      let thrown;
      try { actual(); } catch (error) { thrown = error; }
      assert.ok(thrown, 'Expected the function to throw');
      if (typeof expected === 'string') assert.ok(String(thrown.message).includes(expected), String(thrown.message));
      if (expected instanceof RegExp) assert.match(String(thrown.message), expected);
    }),
  };
  Object.defineProperty(result, 'not', { get: () => api(actual, !invert) });
  Object.defineProperty(result, 'rejects', { get: () => ({ toThrow: async expected => {
    let error;
    try { await actual; } catch (caught) { error = caught; }
    assert.ok(error, 'Expected the promise to reject');
    if (typeof expected === 'string') assert.ok(String(error.message).includes(expected), String(error.message));
  } }) });
  return result;
}
const originalLoad = Module._load;
Module._load = function(name, parent, main) {
  if (name === 'vitest') return { describe, it, expect: api, afterEach: body => hooks.push(body) };
  return originalLoad.call(this, name, parent, main);
};
for (const file of ['engine', 'metrics', 'strategy', 'jobs-storage', 'workspace']) require(path.join(root, '.verify-cjs/src/test/unit', file + '.test.js'));
(async () => {
  const rows = [];
  for (const test of cases) {
    let error;
    try { await test.body(); } catch (caught) { error = caught; }
    for (const hook of hooks) try { await hook(); } catch (caught) { error ??= caught; }
    rows.push({ name: test.name, status: error ? 'failed' : 'passed', ...(error ? { error: String(error.message) } : {}) });
    console.log(`${error ? 'FAIL' : 'PASS'} ${test.name}`);
  }
  const report = { runner: 'Node assert fallback, not Vitest', node: process.version, passed: rows.filter(r => r.status === 'passed').length, failed: rows.filter(r => r.status === 'failed').length, tests: rows };
  if (output) fs.writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ runner: report.runner, passed: report.passed, failed: report.failed }));
  process.exitCode = report.failed ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
