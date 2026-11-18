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
config.share = 'disabled';
config.snapshots = false;
// The host also loads the operator's own OpenCode providers (hundreds of paid
// models). Use Stragy-specific provider ids — a built-in id inherits that
// provider's whole catalog — and switch the operator's catalogs off, so the
// menu is exactly the three Stragy models.
const RENAMED = { 'opencode-go': 'stragy-go', openrouter: 'stragy-free' };
const renamed = (ref) => ref ? { ...ref, providerID: RENAMED[ref.providerID] ?? ref.providerID } : ref;
config.providers = Object.fromEntries(Object.entries(config.providers ?? {}).map(([id, provider]) => [RENAMED[id] ?? id, provider]));
if (config.model) config.model = renamed(config.model);
for (const agent of Object.values(config.agents ?? {})) {
  if (agent.model) agent.model = renamed(agent.model);
}
config.disabled_providers = ['opencode', 'opencode-go', 'openrouter', 'tokenrouter'];
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
  STRAGY_TOOL_BRIDGE: process.env.STRAGY_TOOL_BRIDGE ?? 'http://127.0.0.1:3000',
};

const child = spawn('opencode', ['serve', '--hostname', hostname, '--port', String(port)], {
  cwd: workspace,
  env,
  stdio: ['ignore', 'inherit', 'inherit'],
});
console.log('Stragy OpenCode UI: http://' + hostname + ':' + port + ' (user opencode, password in ' + passwordFile + ')');

const shutdown = (signal) => {
  if (!child.killed) child.kill(signal);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
child.on('exit', code => process.exit(code ?? 0));
