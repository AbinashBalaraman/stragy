import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createToolBridge, PreferenceStore, type ToolBridge } from '../../server/ai/toolBridge';
import { EngineContextStore } from '../../server/ai/engineTools';
import { ApprovalStore } from '../../server/ai/engineApprovals';

const dirs: string[] = [];
function tempFile(name: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'stragy-bridge-'));
  dirs.push(dir);
  return path.join(dir, name);
}

function bridge(file = tempFile('prefs.db')): ToolBridge {
  return createToolBridge({
    preferencesFile: file,
    getDeps: () => ({ dataMode: 'demo', approvals: new ApprovalStore(), contexts: new EngineContextStore() }),
  });
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('tool bridge', () => {
  it('lists the Stragy tools with JSON schemas the OpenCode host can register', async () => {
    const tools = await bridge().list();
    const names = tools.map(tool => tool.name);
    expect(names).toContain('scan_market');
    expect(names).toContain('get_data_cache');
    expect(names).toContain('run_backtest');
    expect(names).toContain('save_strategy');
    expect(names).not.toContain('approve_backtest');
    expect(tools.length).toBeGreaterThanOrEqual(30);
    const scan = tools.find(tool => tool.name === 'scan_market')!;
    expect(scan.input).toMatchObject({ type: 'object' });
    expect((scan.input as { properties: Record<string, unknown> }).properties).toHaveProperty('universe');
    expect(JSON.stringify(scan.input)).not.toContain('$schema');
  });

  it('runs a tool inside the Stragy server and returns its output envelope', async () => {
    const result = await bridge().run('get_data_cache', {}, 'ses_test');
    expect(result.status).toBe(200);
    const body = result.body as { output?: { status?: string; cache?: { symbols?: number } } };
    expect(body.output?.status).toBe('ok');
    expect(typeof body.output?.cache?.symbols).toBe('number');
  });

  it('rejects an unknown tool and invalid input without throwing', async () => {
    const toolBridge = bridge();
    expect((await toolBridge.run('not_a_tool', {}, 'ses_test')).status).toBe(404);
    const invalid = await toolBridge.run('get_quote', { symbols: 'not-an-array' }, 'ses_test');
    expect(invalid.status).toBe(422);
    expect((invalid.body as { code?: string }).code).toBe('TOOL_INPUT_INVALID');
  });

  it('persists research preferences per session across bridge instances', async () => {
    const file = tempFile('prefs.db');
    const first = bridge(file);
    await first.run('remember_preference', { key: 'universe', value: 'NIFTY_50' }, 'ses_a');
    first.close();

    const second = bridge(file);
    const listed = await second.run('get_preferences', {}, 'ses_a');
    const output = (listed.body as { output?: { preferences?: { key: string; value: unknown }[] } }).output;
    expect(output?.preferences).toEqual([{ key: 'universe', value: 'NIFTY_50', updatedAt: expect.any(String) }]);
    const other = await second.run('get_preferences', {}, 'ses_b');
    expect((other.body as { output?: { preferences?: unknown[] } }).output?.preferences).toEqual([]);
    second.close();
  });

  it('stores preferences in a strict SQLite table', () => {
    const file = tempFile('prefs.db');
    const store = new PreferenceStore(file);
    store.put('s', 'risk', { value: 2, note: 'percent' });
    expect(store.list('s')).toEqual([{ key: 'risk', value: { value: 2, note: 'percent' } }]);
    store.remove('s', 'risk');
    expect(store.list('s')).toEqual([]);
    store.close();
  });
});
