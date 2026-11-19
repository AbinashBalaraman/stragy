#!/usr/bin/env node
/**
 * Start the standalone OpenCode web UI for Stragy.
 *
 * The UI (`opencode serve`) owns sessions, streaming and tool states. Stragy's
 * Express server stays the single owner of market data and jobs; the plugin in
 * this directory forwards every tool call to it over loopback.
 *
 * Layout (all under .data/opencode-app):
 *   config/         OpenCode config copied from the engine config
 *   data/           OpenCode database and logs
 *   workspace/      the OpenCode project; .opencode/plugins/stragy forwards tools
 *   password.txt    the web UI password
 *
 * Usage: node scripts/opencode-app.mjs [--port 4200]
 */
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { startGate } from './ui-gate.mjs';

const root = process.cwd();
// Outside the stragy-code git repository: OpenCode canonicalises a project
// to its git root, and the chat project must be an empty, non-repo directory.
const appDir = process.env.OPENCODE_APP_DIR ?? path.join(root, '..', 'opencode-app-data');
const configDir = path.join(appDir, 'config');
const dataDir = path.join(appDir, 'data');
const workspace = path.join(appDir, 'workspace');
const pluginDir = path.join(workspace, '.opencode', 'plugins', 'stragy');
const passwordFile = path.join(appDir, 'password.txt');
const port = Number(process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : process.env.OPENCODE_APP_PORT ?? 4200);
const hostname = process.env.OPENCODE_APP_HOST ?? '127.0.0.1';
// Public traffic terminates at the gate on `port`; OpenCode itself is pushed
// to a loopback-only internal port so its shell/PTY/plugin APIs are not
// directly reachable through the instabox tunnel.
const internalPort = port + 1;

for (const dir of [configDir, dataDir, workspace, pluginDir]) mkdirSync(dir, { recursive: true });
copyFileSync(path.join(root, 'opencode-app', 'plugin', 'index.ts'), path.join(pluginDir, 'index.ts'));
writeFileSync(path.join(pluginDir, 'package.json'), JSON.stringify({ name: 'stragy-tools', version: '1.0.0', type: 'module' }, null, 2) + '\n');

// The engine config already carries the provider registry, the Stragy agent and
// the deny rules for every host tool. Reuse it instead of a second catalog.
const engineConfig = path.join(root, '.data', 'opencode', 'config', 'opencode.json');
const targetConfig = path.join(configDir, 'opencode.json');
if (!existsSync(engineConfig)) {
  console.error('Missing ' + engineConfig + '. Start the Stragy server once so it writes the engine config.');
  process.exit(1);
}
const config = JSON.parse(readFileSync(engineConfig, 'utf8'));
// OpenCode evaluates KNOWN actions with resource patterns, not custom action
// names: a custom `stragy.*` action is silently covered by the default
// allow-all rule. Use known actions with dedicated resources so the native
// prompt actually fires. These specific ask rules are prepended BEFORE the
// broad host-tool denies, which remain in place for every other resource.
const stragyAskRules = [
  { action: 'edit', resource: 'stragy:save_strategy:*', effect: 'ask' },
  { action: 'execute', resource: 'stragy:backtest:*', effect: 'ask' },
];
config.agents = config.agents ?? {};
config.agents.stragy = config.agents.stragy ?? {};
config.agents.stragy.permissions = [
  ...stragyAskRules,
  ...(config.agents.stragy.permissions ?? []),
];
config.permissions = [...stragyAskRules, ...(config.permissions ?? [])];
config.share = 'disabled';
config.snapshots = false;
// Defense in depth: OpenCode's built-in agents (Build/Plan/General/Explore)
// carry full host shell/file tools. This UI has exactly one intended agent,
// so disable the others in the generated config as well as at the gate.
// Internal helpers (compaction/title/summary) are deliberately left enabled.
config.agents = config.agents || {};
for (const id of ['build', 'plan', 'general', 'explore']) {
  config.agents[id] = { ...(config.agents[id] || {}), disabled: true };
}
// Keep OpenCode's normal provider ids and catalogs so the model list shows the
// operator's usual providers. The engine config still fixes the default model
// to the free opencode-go/hy4-flash-free; this script does not rewrite it.
// Slash commands are a supported config surface: they cannot break on a UI
// update and they make the common research turns one click.
config.commands = {
  scan: {
    description: 'Scan a universe for a rule (default: NSE, RSI(14) < 30)',
    template: 'Scan $ARGUMENTS for the rule I describe. Use a validated strategy, state the exact evaluated window, and report matches plus failed symbols honestly. If I gave no universe, use NSE and the first 200 symbols.',
  },
  check: {
    description: 'Check one symbol against the current strategy',
    template: 'Check $ARGUMENTS against my current strategy. Use check_symbol, show the real indicator values, and say whether it passes each entry rule. Do not rescan a universe for one ticker.',
  },
  cache: {
    description: 'Report market-data cache coverage and recent jobs',
    template: 'Use get_data_cache and list_jobs and give me a short report: cached symbols, date range, cache hits/misses, and the last three jobs with their status.',
  },
};
// Project-level config: the server applies this at the chat location.
writeFileSync(path.join(workspace, 'opencode.json'), JSON.stringify({ $schema: 'https://opencode.ai/config.json', commands: config.commands }, null, 2) + '\n');
// Auto-discovery under workspace/.opencode/plugins loads the bridge plugin.
delete config.plugins;
writeFileSync(targetConfig, JSON.stringify(config, null, 2) + '\n');

let password = process.env.OPENCODE_PASSWORD ?? '';
if (!password) {
  if (existsSync(passwordFile)) password = readFileSync(passwordFile, 'utf8').trim();
  if (!password) {
    password = randomBytes(15).toString('base64url');
    writeFileSync(passwordFile, password + '\n', { mode: 0o600 });
  }
}

// .env files edited on Windows carry trailing CRs; a key ending in CR is a
// silent 401 for every model call.
const clean = Object.fromEntries(Object.entries(process.env).map(([key, value]) => [key, typeof value === 'string' ? value.replace(/\r+$/g, '') : value]));
const env = {
  ...clean,
  // The app must not inherit the operator's own OpenCode providers or plugins.
  XDG_CONFIG_HOME: path.join(appDir, 'xdg-config'),
  XDG_DATA_HOME: dataDir,
  OPENCODE_CONFIG_DIR: configDir,
  OPENCODE_PASSWORD: password,
  STRAGY_TOOL_BRIDGE: process.env.STRAGY_TOOL_BRIDGE ?? 'http://127.0.0.1:3100',
  // The plugin starts the backend itself when it is not running.
  STRAGY_HOME: process.env.STRAGY_HOME ?? root,
  STRAGY_NODE_BIN: process.env.STRAGY_NODE_BIN ?? process.execPath,
};

let child = null;
let gate = null;
let shuttingDown = false;

const shutdown = (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  if (child && !child.killed) child.kill(signal);
  if (gate) gate.close(() => {});
  // Do not hang on an open SSE connection when the gate is closing.
  const timer = setTimeout(() => process.exit(0), 1500);
  timer.unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

async function main() {
  // Own the public port before OpenCode starts, so there is no window where
  // the unfiltered API is reachable on :4200.
  gate = await startGate({ publicPort: port, internalPort, host: hostname });
  console.log(`Stragy UI gate: public http://${hostname}:${port} -> internal http://127.0.0.1:${internalPort}`);

  child = spawn('opencode', ['serve', '--hostname', '127.0.0.1', '--port', String(internalPort)], {
    cwd: workspace,
    env,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  console.log('Stragy OpenCode UI: http://' + hostname + ':' + port + ' (user opencode, password in ' + passwordFile + ') [internal :' + internalPort + ']');

  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.error('opencode serve exited (code=' + code + ' signal=' + signal + '); closing gate');
    shutdown(signal || 'SIGTERM');
    process.exit(code ?? 0);
  });
}

main().catch((error) => {
  console.error('Failed to start Stragy UI gate:', error);
  process.exit(1);
});
