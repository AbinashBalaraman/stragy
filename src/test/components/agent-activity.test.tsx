// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AgentActivity, formatDuration, type AgentToolEntry } from '../../components/chat/AgentActivity';
import { AgentTodoList } from '../../components/chat/AgentTodoList';
import { humanSummary, looksLikeJson, toolCategory, toolLabel } from '../../components/chat/agentToolLabels';

afterEach(() => cleanup());

const symbolCheck: AgentToolEntry = {
  type: 'tool', name: 'check_symbol', status: 'success',
  summary: 'Checked TCS against 3 entry conditions', durationMs: 1_240,
};
const scan: AgentToolEntry = {
  type: 'tool', name: 'scan_market', status: 'failed',
  summary: 'Scanning NSE', durationMs: 840,
  error: { code: 'PROVIDER_UNAVAILABLE', message: 'The market data provider did not answer. Try the scan again in a minute.' },
};

describe('AgentActivity', () => {
  it('starts collapsed once the answer arrives and expands on demand', () => {
    render(<AgentActivity entries={[symbolCheck]} running={false} />);
    const header = screen.getByRole('button', { name: /1 step/ });
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Checked TCS against 3 entry conditions')).toBeNull();
    fireEvent.click(header);
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Checked TCS against 3 entry conditions')).toBeTruthy();
  });

  it('is expanded while running and exposes the live step plus Stop', () => {
    const onStop = vi.fn();
    render(<AgentActivity entries={[symbolCheck]} running currentStep="Scanning NSE · 120 of 200" onStop={onStop} />);
    const header = screen.getByRole('button', { name: /Working/ });
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('status').textContent).toContain('Scanning NSE · 120 of 200');
    expect(screen.getByText('Checked TCS against 3 entry conditions')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Stop the current step' }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('shows the running step once, in the live strip rather than as a duplicate row', () => {
    const runningScan: AgentToolEntry = {
      type: 'tool', name: 'scan_market', status: 'running', summary: 'Scanning NSE · 120 of 200',
    };
    render(<AgentActivity entries={[symbolCheck, runningScan]} running currentStep="Scanning NSE · 120 of 200" onStop={() => undefined} />);
    expect(screen.getAllByText('Scanning NSE · 120 of 200')).toHaveLength(1);
    expect(screen.getByText('Checked TCS against 3 entry conditions')).toBeTruthy();
  });

  it('collapses automatically when the turn finishes', () => {
    const { rerender } = render(<AgentActivity entries={[symbolCheck]} running currentStep="Scanning NSE" />);
    expect(screen.getByText('Checked TCS against 3 entry conditions')).toBeTruthy();
    rerender(<AgentActivity entries={[symbolCheck]} running={false} />);
    expect(screen.queryByText('Checked TCS against 3 entry conditions')).toBeNull();
    expect(screen.getByRole('button', { expanded: false })).toBeTruthy();
  });

  it('shows a failed step typed error in plain words and counts it', () => {
    render(<AgentActivity entries={[scan]} running={false} />);
    fireEvent.click(screen.getByRole('button', { name: /1 step/ }));
    expect(screen.getByText('The market data provider did not answer. Try the scan again in a minute.')).toBeTruthy();
    expect(screen.getByText('840 ms')).toBeTruthy();
    expect(screen.getByRole('button', { name: /1 failed/ })).toBeTruthy();
  });

  it('never renders raw JSON: a JSON summary falls back to the human tool label', () => {
    const leaky: AgentToolEntry = { type: 'tool', name: 'get_bars', status: 'success', summary: '{"symbol":"TCS","bars":200}' };
    render(<AgentActivity entries={[leaky]} running={false} />);
    fireEvent.click(screen.getByRole('button', { name: /1 step/ }));
    expect(screen.getByText('Price history')).toBeTruthy();
    expect(screen.queryByText(/\{"symbol"/)).toBeNull();
  });

  it('renders nothing when there is no activity', () => {
    const { container } = render(<AgentActivity entries={[]} running={false} />);
    expect(container.textContent).toBe('');
  });

  it('falls back to a human sentence when only an error code exists', () => {
    const coded: AgentToolEntry = { type: 'tool', name: 'run_backtest', status: 'failed', error: { code: 'APPROVAL_REQUIRED', message: '' } };
    render(<AgentActivity entries={[coded]} running={false} />);
    fireEvent.click(screen.getByRole('button', { name: /1 failed|1 step/ }));
    expect(screen.getByText(/could not finish \(approval required\)/i)).toBeTruthy();
  });
});

describe('duration formatting', () => {
  it('keeps short and long durations readable', () => {
    expect(formatDuration(0)).toBe('0 ms');
    expect(formatDuration(420)).toBe('420 ms');
    expect(formatDuration(1_240)).toBe('1.2 s');
    expect(formatDuration(12_400)).toBe('12 s');
    expect(formatDuration(64_000)).toBe('1 m 4 s');
    expect(formatDuration(120_000)).toBe('2 m');
    expect(formatDuration(Number.NaN)).toBe('');
    expect(formatDuration(undefined)).toBe('');
  });
});

describe('AgentTodoList', () => {
  it('ticks the plan off live, quiet and read-only', () => {
    render(<AgentTodoList items={[
      { content: 'Resolve TCS in the Nifty 50 catalog', status: 'completed' },
      { content: 'Check TCS against the entry rules', status: 'in_progress' },
      { content: 'Prepare the backtest assumptions', status: 'pending' },
    ]} />);
    expect(screen.getByText('1 of 3')).toBeTruthy();
    const current = screen.getByText('Check TCS against the entry rules').closest('li');
    expect(current?.getAttribute('aria-current')).toBe('step');
    expect(screen.getByText('Resolve TCS in the Nifty 50 catalog').className).toContain('line-through');
    expect(screen.getByText('Prepare the backtest assumptions').className).not.toContain('line-through');
  });

  it('marks a cancelled step as stopped, never as done', () => {
    render(<AgentTodoList items={[
      { content: 'Resolve TCS in the Nifty 50 catalog', status: 'completed' },
      { content: 'Run the old scan', status: 'cancelled' },
      { content: 'Prepare the backtest assumptions', status: 'pending' },
    ]} />);
    const line = screen.getByText('Run the old scan');
    expect(line.className).not.toContain('line-through');
    expect(screen.getByTestId('todo-cancelled-tag').textContent).toBe('stopped');
    expect(screen.getByText('Resolve TCS in the Nifty 50 catalog').className).toContain('line-through');
    expect(line.closest('li')?.getAttribute('data-status')).toBe('cancelled');
  });

  it('says skipped when the plan moved on past a cancelled step', () => {
    render(<AgentTodoList items={[
      { content: 'Run the old scan', status: 'cancelled' },
      { content: 'Prepare the backtest assumptions', status: 'completed' },
    ]} />);
    expect(screen.getByTestId('todo-cancelled-tag').textContent).toBe('skipped');
  });

  it('hides an empty plan', () => {
    const { container } = render(<AgentTodoList items={[]} />);
    expect(container.textContent).toBe('');
  });
});

describe('tool labels', () => {
  it('names every engine capability in plain language, never snake_case', () => {
    expect(toolLabel('check_symbol')).toBe('Symbol check');
    expect(toolLabel('scan_market')).toBe('Market scan');
    expect(toolLabel('get_scan_result')).toBe('Scan results');
    expect(toolLabel('read_chart')).toBe('Chart reading');
    expect(toolLabel('run_backtest')).toBe('Backtest');
    expect(toolLabel('get_backtest_result')).toBe('Backtest result');
    expect(toolLabel('propose_strategy_edit')).toBe('Strategy draft');
    expect(toolLabel('recall_memory')).toBe('Memory recall');
    expect(toolLabel('todowrite')).toBe('Plan update');
    expect(toolLabel('check_symbol_extra')).toBe('Symbol lookup');
    expect(toolLabel('brand_new_thing')).toBe('Brand new thing');
    expect(toolCategory('get_bars')).toBe('data');
    expect(toolCategory('save_memory')).toBe('memory');
  });

  it('treats JSON as non-human and caps runaway summaries', () => {
    expect(looksLikeJson('{"a":1}')).toBe(true);
    expect(looksLikeJson('Checked TCS')).toBe(false);
    expect(humanSummary('{"a":1}')).toBeUndefined();
    expect(humanSummary('  a   b  ')).toBe('a b');
    expect(humanSummary('x'.repeat(400))?.length).toBe(180);
  });
});
