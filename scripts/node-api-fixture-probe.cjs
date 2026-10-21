// Restricted-runtime verification helper. This is NOT Vitest.
// Executes only the unchanged CommonJS-emitted API test bodies with Node assert,
// real Express/Supertest, and the test file's own async vi.mock factory.
// Usage: node scripts/node-api-fixture-probe.cjs <report.json>
// Compile .verify-cjs/src/test/integration/api.test.js as CommonJS first.
// No source rewriting, transforms, workers, fake requests, or invented results.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '..');
const entry = path.join(root, '.verify-cjs/src/test/integration/api.test.js');
const output = process.argv[2] && path.resolve(process.argv[2]);
const runner = 'Node API fallback, not Vitest';
const originalLoad = Module._load;
const cases = [], unsupported = [], spies = [], mockFactories = [];
const mockFunctions = new WeakSet();
const asymmetric = Symbol('API fallback asymmetric matcher');
const envStubs = new Map(), globalStubs = new Map();
const rootSuite = { name: '', parent: null, before: [], after: [] };
let currentSuite = rootSuite, registering = true, mockedExports, originalExports;
let dataFilename, entryRequire, proxyExports, factoryCompleted = false;
let fallbackFetchCalls = 0;
const limitations = [
  'Sequential Node assert adapter, not Vitest; no native worker, transform, coverage, or general Vitest compatibility.',
  'Only this file\'s APIs are supported; unsupported APIs/assertions throw and fail the report.',
  'Requires prior TypeScript CommonJS emission and real installed Express/Supertest dependencies.',
  'Controlled live export proxy initializes the unchanged async fixture factory before tests; early export consumption fails.',
  'External fetch is blocked; authentication tokens and market bars are synthetic fixtures, not live verification.'
];
function unsupportedBehavior(message) {
  unsupported.push(message);
  throw new Error('Unsupported Node API fallback behavior: ' + message);
}
function strictAPI(object, label) {
  return new Proxy(object, { get(target, key, receiver) {
    if (Reflect.has(target, key) || typeof key === 'symbol') return Reflect.get(target, key, receiver);
    return unsupportedBehavior(label + '.' + String(key));
  } });
}
function registrationOnly(label) {
  if (!registering) unsupportedBehavior(label + ' outside collection');
}
function describe(name, body) {
  registrationOnly('describe');
  assert.strictEqual(typeof name, 'string');
  assert.strictEqual(typeof body, 'function');
  const previous = currentSuite;
  currentSuite = { name, parent: previous, before: [], after: [] };
  try {
    const result = body();
    if (result && typeof result.then === 'function') unsupportedBehavior('async describe');
  } finally { currentSuite = previous; }
}
function it(name, body) {
  registrationOnly('it');
  assert.strictEqual(typeof name, 'string');
  assert.strictEqual(typeof body, 'function');
  const lineage = [];
  for (let scope = currentSuite; scope; scope = scope.parent) lineage.unshift(scope);
  cases.push({ name: [...lineage.map(s => s.name).filter(Boolean), name].join(' / '), body, lineage });
}
function registerHook(kind, body) {
  registrationOnly(kind === 'before' ? 'beforeEach' : 'afterEach');
  assert.strictEqual(typeof body, 'function');
  currentSuite[kind].push(body);
}
function makeMock(implementation = () => undefined) {
  assert.strictEqual(typeof implementation, 'function');
  let impl = implementation;
  const state = { calls: [], contexts: [], results: [] };
  function mock(...args) {
    state.calls.push(args);
    state.contexts.push(this);
    const result = { type: 'incomplete', value: undefined };
    state.results.push(result);
    try {
      const value = Reflect.apply(impl, this, args);
      result.type = 'return'; result.value = value;
      return value;
    } catch (error) { result.type = 'throw'; result.value = error; throw error; }
  }
  Object.defineProperty(mock, 'mock', { value: state });
  mock.mockReturnValue = value => { impl = () => value; return wrapped; };
  const wrapped = new Proxy(mock, { get(target, key, receiver) {
    if (typeof key === 'string' && key.startsWith('mock') && !Reflect.has(target, key)) {
      return unsupportedBehavior('mock function.' + key);
    }
    return Reflect.get(target, key, receiver);
  } });
  mockFunctions.add(wrapped);
  return wrapped;
}
function spyOn(object, key) {
  assert.ok(object != null);
  const own = Object.getOwnPropertyDescriptor(object, key);
  if (own && (own.get || own.set)) unsupportedBehavior('spyOn accessors');
  const original = object[key];
  assert.strictEqual(typeof original, 'function', 'spyOn requires a method');
  const spy = makeMock(function(...args) { return Reflect.apply(original, this, args); });
  Object.defineProperty(object, key, own ? { ...own, value: spy } : {
    configurable: true, enumerable: true, writable: true, value: spy
  });
  let restored = false;
  const restore = () => {
    if (restored) return;
    if (own) Object.defineProperty(object, key, own); else delete object[key];
    restored = true;
  };
  spy.mockRestore = restore;
  spies.push(restore);
  return spy;
}
function stubEnv(key, value) {
  assert.strictEqual(typeof key, 'string');
  if (!envStubs.has(key)) envStubs.set(key, { exists: Object.hasOwn(process.env, key), value: process.env[key] });
  if (value === undefined) delete process.env[key]; else process.env[key] = String(value);
}
function unstubAllEnvs() {
  for (const [key, saved] of envStubs) {
    if (saved.exists) process.env[key] = saved.value; else delete process.env[key];
  }
  envStubs.clear();
}
function stubGlobal(key, value) {
  if (!globalStubs.has(key)) globalStubs.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, enumerable: true, writable: true, value });
}
function unstubAllGlobals() {
  for (const [key, saved] of globalStubs) {
    if (saved) Object.defineProperty(globalThis, key, saved); else delete globalThis[key];
  }
  globalStubs.clear();
}
function restoreAllMocks() { for (const restore of spies.splice(0).reverse()) restore(); }
function marker(kind, value) { return Object.freeze({ [asymmetric]: kind, value }); }
function subset(actual, expected) {
  if (expected && expected[asymmetric]) return equality(actual, expected);
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), 'Expected an array for partial matching');
    assert.strictEqual(actual.length, expected.length);
    expected.forEach((value, index) => subset(actual[index], value));
  } else if (expected !== null && typeof expected === 'object') {
    assert.ok(actual !== null && (typeof actual === 'object' || typeof actual === 'function'), 'Expected an object for partial matching');
    for (const key of Reflect.ownKeys(expected)) {
      assert.ok(key in actual, 'Missing partial property: ' + String(key));
      subset(actual[key], expected[key]);
    }
  } else assert.strictEqual(actual, expected);
}
function equality(actual, expected) {
  if (expected && expected[asymmetric]) {
    const kind = expected[asymmetric], value = expected.value;
    if (kind === 'any') {
      if (value === String) assert.ok(typeof actual === 'string' || actual instanceof String, 'Expected any String');
      else unsupportedBehavior('expect.any constructor other than String');
    } else if (kind === 'objectContaining') subset(actual, value);
    else if (kind === 'arrayContaining') {
      assert.ok(Array.isArray(actual), 'Expected an array');
      for (const item of value) assert.ok(actual.some(candidate => {
        try { equality(candidate, item); return true; }
        catch (error) { if (error instanceof assert.AssertionError) return false; throw error; }
      }), 'Missing arrayContaining element');
    } else unsupportedBehavior('asymmetric matcher ' + kind);
    return;
  }
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), 'Expected an array');
    assert.strictEqual(actual.length, expected.length);
    for (let i = 0; i < expected.length; i++) equality(actual[i], expected[i]);
  } else if (expected !== null && typeof expected === 'object' && Object.getPrototypeOf(expected) === Object.prototype) {
    assert.ok(actual !== null && typeof actual === 'object' && !Array.isArray(actual), 'Expected an object');
    // Vitest toEqual ignores undefined object properties (unlike toStrictEqual).
    const keys = value => Reflect.ownKeys(value).filter(key => Object.prototype.propertyIsEnumerable.call(value, key) && value[key] !== undefined);
    const expectedKeys = keys(expected), actualKeys = keys(actual);
    assert.strictEqual(actualKeys.length, expectedKeys.length, 'Object key count differs');
    for (const key of expectedKeys) {
      assert.ok(actualKeys.includes(key), 'Missing property: ' + String(key));
      equality(actual[key], expected[key]);
    }
  } else assert.deepStrictEqual(actual, expected);
}
function expectValue(actual, invert = false) {
  const check = operation => {
    if (!invert) return operation();
    let failed = false;
    try { operation(); }
    catch (error) { if (!(error instanceof assert.AssertionError)) throw error; failed = true; }
    assert.ok(failed, 'Negated assertion unexpectedly matched');
  };
  const callCount = () => {
    if (!mockFunctions.has(actual)) unsupportedBehavior('call-count assertion requires vi.fn or vi.spyOn');
    return actual.mock.calls.length;
  };
  const matchers = {
    toBe: expected => check(() => assert.ok(Object.is(actual, expected), 'Values are not Object.is equal')),
    toEqual: expected => check(() => equality(actual, expected)),
    toMatchObject: expected => check(() => subset(actual, expected)),
    toMatch: expected => {
      if (!(expected instanceof RegExp) && typeof expected !== 'string') unsupportedBehavior('toMatch argument');
      return check(() => {
        assert.strictEqual(typeof actual, 'string');
        if (typeof expected === 'string') assert.ok(actual.includes(expected));
        else { const copy = new RegExp(expected.source, expected.flags); assert.match(actual, copy); }
      });
    },
    toContain: expected => check(() => {
      assert.ok(typeof actual === 'string' || Array.isArray(actual), 'toContain requires a string or array');
      assert.ok(typeof actual === 'string' ? actual.includes(expected) : actual.some(value => value === expected));
    }),
    toHaveProperty: (...args) => {
      if (args.length !== 1 || typeof args[0] !== 'string' || args[0].includes('.') || args[0].includes('[')) {
        unsupportedBehavior('toHaveProperty supports only the one top-level string path used by this file');
      }
      return check(() => assert.ok(actual != null && args[0] in Object(actual), 'Missing property: ' + args[0]));
    },
    toHaveBeenCalled: () => check(() => assert.ok(callCount() > 0, 'Mock was not called')),
    toHaveBeenCalledTimes: expected => check(() => assert.strictEqual(callCount(), expected))
  };
  Object.defineProperty(matchers, 'not', { get: () => expectValue(actual, !invert) });
  Object.defineProperty(matchers, 'rejects', { get: () => strictAPI({
    toMatchObject: async expected => {
      if (!actual || typeof actual.then !== 'function') unsupportedBehavior('rejects requires a promise');
      let rejected = false, reason;
      try { await actual; } catch (error) { rejected = true; reason = error; }
      assert.ok(rejected, 'Expected the promise to reject, but it resolved');
      return expectValue(reason, invert).toMatchObject(expected);
    }
  }, 'expect.rejects') });
  return strictAPI(matchers, 'expect');
}
expectValue.any = constructor => {
  if (constructor !== String) unsupportedBehavior('expect.any constructor other than String');
  return marker('any', constructor);
};
expectValue.objectContaining = value => {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value));
  return marker('objectContaining', value);
};
expectValue.arrayContaining = value => { assert.ok(Array.isArray(value)); return marker('arrayContaining', value); };
const vi = strictAPI({
  fn: makeMock, spyOn, stubEnv, unstubAllEnvs, stubGlobal, unstubAllGlobals, restoreAllMocks,
  mock: (name, factory) => {
    registrationOnly('vi.mock');
    if (name !== '../../server/data/realMarketData' || entryRequire.resolve(name) !== dataFilename || typeof factory !== 'function') {
      unsupportedBehavior('vi.mock target/factory');
    }
    if (mockFactories.length) unsupportedBehavior('multiple vi.mock factories');
    mockFactories.push(factory);
  }
}, 'vi');
const vitest = strictAPI({
  describe: strictAPI(describe, 'describe'), it: strictAPI(it, 'it'), expect: strictAPI(expectValue, 'expect'), vi,
  beforeEach: body => registerHook('before', body), afterEach: body => registerHook('after', body)
}, 'vitest');
function errorRecord(error, phase) {
  return { phase, message: String(error && error.message || error), stack: error && error.stack ? String(error.stack) : undefined };
}
async function main() {
  const rows = [], harnessErrors = [];
  const cwd = process.cwd();
  const outerEnvs = new Map(['NODE_ENV', 'DATA_MODE', 'AI_PROVIDER'].map(key => [key, { exists: Object.hasOwn(process.env, key), value: process.env[key] }]));
  const outerFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  try {
    process.chdir(root);
    process.env.NODE_ENV = 'test'; process.env.DATA_MODE = 'demo'; process.env.AI_PROVIDER = 'none';
    Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: async () => {
      fallbackFetchCalls++;
      throw new Error('External fetch is disabled in the Node API fallback.');
    } });
    entryRequire = Module.createRequire(entry);
    dataFilename = entryRequire.resolve('../../server/data/realMarketData');
    // Load production validation unchanged. No fixture replacements are hand-copied here.
    originalExports = originalLoad.call(Module, dataFilename, module, false);
    proxyExports = Object.create(null);
    for (const key of Reflect.ownKeys(originalExports)) Object.defineProperty(proxyExports, key, {
      configurable: false, enumerable: Object.prototype.propertyIsEnumerable.call(originalExports, key),
      get() {
        if (key === '__esModule') return originalExports[key];
        if (!factoryCompleted) unsupportedBehavior('mock export read before async factory initialization: ' + String(key));
        if (!Object.hasOwn(mockedExports, key)) unsupportedBehavior('mock factory removed export: ' + String(key));
        return mockedExports[key];
      }
    });
    Module._load = function(name, parent, isMain) {
      if (name === 'vitest') return vitest;
      // Resolve actual filenames, not string suffixes, so only the intended module is mocked.
      const resolved = Module._resolveFilename(name, parent, isMain);
      if (resolved === dataFilename) return proxyExports;
      return originalLoad.call(this, name, parent, isMain);
    };
    entryRequire(entry); // Collect unchanged bodies and the original vi.mock factory.
    registering = false;
    assert.strictEqual(mockFactories.length, 1, 'Expected exactly the API file\'s one async vi.mock');
    assert.strictEqual(cases.length, 12, 'Expected exactly 12 unchanged API test bodies');
    mockedExports = await mockFactories[0](async () => {
      // Bypass the proxy ONLY for this importOriginal call; all other imports stay normal.
      return originalLoad.call(Module, dataFilename, module, false);
    });
    assert.ok(mockedExports && typeof mockedExports === 'object', 'Mock factory must return exports');
    assert.ok(mockFunctions.has(mockedExports.loadMarketSeries), 'The unchanged factory must supply vi.fn loadMarketSeries');
    assert.strictEqual(mockedExports.MarketDataError, originalExports.MarketDataError, 'Production validation errors must be preserved');
    assert.strictEqual(mockedExports.validateDate, originalExports.validateDate, 'Production date validation must be preserved');
    assert.strictEqual(mockedExports.validateBars, originalExports.validateBars, 'Production bar validation must be preserved');
    factoryCompleted = true;
    for (const test of cases) {
      const errors = [];
      try {
        for (const scope of test.lineage) for (const hook of scope.before) await hook();
        await test.body();
      } catch (error) { errors.push(errorRecord(error, 'beforeEach/test')); }
      // Always run teardown, including when setup/body fails. Keep every teardown error.
      for (const scope of [...test.lineage].reverse()) for (const hook of scope.after) {
        try { await hook(); } catch (error) { errors.push(errorRecord(error, 'afterEach')); }
      }
      rows.push({ name: test.name, status: errors.length ? 'failed' : 'passed', ...(errors.length ? { errors } : {}) });
      console.log(`${errors.length ? 'FAIL' : 'PASS'} ${test.name}`);
    }
  } catch (error) { harnessErrors.push(errorRecord(error, 'collection/initialization')); }
  finally {
    Module._load = originalLoad;
    for (const [phase, cleanup] of [['restore mocks', restoreAllMocks], ['restore env stubs', unstubAllEnvs], ['restore global stubs', unstubAllGlobals]]) {
      try { cleanup(); } catch (error) { harnessErrors.push(errorRecord(error, phase)); }
    }
    try {
      for (const [key, saved] of outerEnvs) { if (saved.exists) process.env[key] = saved.value; else delete process.env[key]; }
      if (outerFetch) Object.defineProperty(globalThis, 'fetch', outerFetch); else delete globalThis.fetch;
      process.chdir(cwd);
    } catch (error) { harnessErrors.push(errorRecord(error, 'restore outer state')); }
  }
  if (fallbackFetchCalls) harnessErrors.push({ phase: 'network guard', message: `${fallbackFetchCalls} forbidden external fetch attempt(s) outside fixture stubs` });
  if (unsupported.length) harnessErrors.push({ phase: 'unsupported behavior', message: 'Unsupported behavior was encountered, even if caught by application code', details: unsupported });
  const passed = rows.filter(row => row.status === 'passed').length;
  const failed = rows.filter(row => row.status === 'failed').length;
  const complete = rows.length === 12 && factoryCompleted;
  const report = {
    runner, node: process.version, entry, expectedTests: 12, collected: cases.length, executed: rows.length,
    passed, failed, complete, success: complete && failed === 0 && harnessErrors.length === 0,
    mock: 'Unchanged emitted vi.mock async factory; original production loadMarketSeries validation runs before synthetic fixture replacement',
    requests: 'Real Supertest against real Express; no request/response shims',
    limitations, tests: rows, harnessErrors
  };
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ runner, passed, failed, complete, harnessErrors: harnessErrors.length, success: report.success }));
  process.exitCode = report.success ? 0 : 1;
}
if (!output || process.argv.length !== 3) {
  console.error('Usage: node scripts/node-api-fixture-probe.cjs <report.json>');
  process.exitCode = 1;
} else main().catch(error => { console.error(error); process.exitCode = 1; });
