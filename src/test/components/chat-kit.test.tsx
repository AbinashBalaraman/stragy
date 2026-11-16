// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { CardShell } from '../../components/common/CardShell';
import { DataTable, type DataColumn } from '../../components/common/DataTable';
import { StatRow } from '../../components/common/StatRow';
import { Sparkline } from '../../components/common/Sparkline';
import { EquityCurve } from '../../components/common/EquityCurve';
import { TickerChip } from '../../components/common/TickerChip';
import { Disclosure } from '../../components/common/Disclosure';
import { ActionRow } from '../../components/common/ActionRow';
import { Sources } from '../../components/common/Sources';
import { Skeleton } from '../../components/common/Skeleton';
import { SideSheet } from '../../components/common/SideSheet';

afterEach(cleanup);

const rows = Array.from({ length: 12 }, (_, index) => ({ id: 'r' + index, name: 'Stock ' + (index + 1), value: index }));
const columns: DataColumn<{ id: string; name: string; value: number }>[] = [
  { key: 'name', header: 'Symbol', render: row => row.name },
  { key: 'value', header: 'Value', align: 'right', render: row => String(row.value) },
];

describe('CardShell', () => {
  it('renders a labelled region with header, body, footer and one status chip', () => {
    render(
      <CardShell title="Screen results" meta="12 matches" status="Ready" footer={<button type="button">Re-run</button>}>
        <p>Body content</p>
      </CardShell>
    );
    const card = screen.getByRole('region', { name: 'Screen results' });
    expect(card).toBeTruthy();
    expect(within(card).getByText('12 matches')).toBeTruthy();
    expect(within(card).getByText('Body content')).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Re-run' })).toBeTruthy();
    expect(within(card).getAllByRole('status')).toHaveLength(1);
  });

  it('marks pending cards busy and labels partial and error states', () => {
    const view = render(<CardShell title="Pending" state="pending"><p>waiting</p></CardShell>);
    expect(screen.getByRole('region', { name: 'Pending' }).getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('status').textContent).toBe('In progress');

    view.rerender(<CardShell title="Partial" state="partial"><p>some</p></CardShell>);
    expect(screen.getByRole('region', { name: 'Partial' }).getAttribute('aria-busy')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Partial results');

    view.rerender(<CardShell title="Broken" state="error"><p>none</p></CardShell>);
    expect(screen.getByRole('status').textContent).toBe('Could not complete');
  });
});

describe('DataTable', () => {
  it('uses a real table with a caption, scoped headers and a focusable scroll region', () => {
    render(<DataTable caption="Scan matches, 12 rows" columns={columns} rows={rows} rowKey={row => row.id} />);
    const table = screen.getByRole('table', { name: 'Scan matches, 12 rows' });
    expect(table).toBeTruthy();
    expect(within(table).getAllByRole('columnheader')).toHaveLength(2);
    expect(within(table).getAllByRole('rowheader').length).toBe(8);
    const region = screen.getByRole('region', { name: 'Scan matches, 12 rows' });
    expect(region.className).toContain('overflow-x-auto');
    expect(region.getAttribute('tabindex')).toBe('0');
    expect(table.className).toContain('min-w-[560px]');
  });

  it('limits rows to eight and reveals all on request', () => {
    render(<DataTable caption="Scan matches" columns={columns} rows={rows} rowKey={row => row.id} />);
    expect(screen.getAllByRole('row')).toHaveLength(9);
    const showAll = screen.getByRole('button', { name: 'Show all 12' });
    expect(showAll.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(showAll);
    expect(screen.getAllByRole('row')).toHaveLength(13);
    const showFewer = screen.getByRole('button', { name: 'Show fewer' });
    expect(showFewer.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(showFewer);
    expect(screen.getAllByRole('row')).toHaveLength(9);
  });

  it('renders an honest empty state without a table', () => {
    render(<DataTable caption="No rows" columns={columns} rows={[]} rowKey={row => row.id} empty="No matches in the evaluated symbols." />);
    expect(screen.getByText('No matches in the evaluated symbols.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('StatRow', () => {
  it('renders terms, values and an unavailable dash', () => {
    render(<StatRow stats={[{ label: 'Net P&L', value: '+₹182.90' }, { label: 'Sharpe', value: '—', unavailable: true }]} />);
    expect(screen.getByText('Net P&L')).toBeTruthy();
    expect(screen.getByText('+₹182.90')).toBeTruthy();
    expect(screen.getByText('—').closest('dd')?.getAttribute('title')).toBe('Not reported for this run');
  });
});

describe('charts and chips', () => {
  it('hides the sparkline from AT and pairs it with a text summary', () => {
    const { container } = render(<Sparkline values={[1, 2, 3]} summary="+4.0% over 1M" />);
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByText('+4.0% over 1M')).toBeTruthy();
  });

  it('labels the equity curve and shows three axis labels', () => {
    render(<EquityCurve values={[100, 104, 102]} labels={['100', '104', '102']} ariaLabel="Equity curve" />);
    expect(screen.getByRole('img', { name: 'Equity curve' })).toBeTruthy();
    expect(screen.getByText('100')).toBeTruthy();
    expect(screen.getByText('104')).toBeTruthy();
    expect(screen.getByText('102')).toBeTruthy();
  });

  it('keeps a stable price slot while a quote loads', () => {
    const view = render(<TickerChip symbol="RELIANCE" loading />);
    expect(screen.getByText('LTP …')).toBeTruthy();
    expect(view.container.querySelector('[aria-busy="true"]')).toBeTruthy();
    view.rerender(<TickerChip symbol="RELIANCE" price={1344.8} changePercent={0.38} />);
    expect(screen.getByText('₹1,344.80')).toBeTruthy();
    expect(screen.getByText('+0.38%')).toBeTruthy();
  });
});

describe('Disclosure, ActionRow and Sources', () => {
  it('uses a native details/summary disclosure', () => {
    render(<Disclosure summary="Assumptions (2)"><p>Stop-first ambiguity</p></Disclosure>);
    expect(screen.getByText('Assumptions (2)').closest('summary')).toBeTruthy();
    expect(screen.getByText('Stop-first ambiguity')).toBeTruthy();
  });

  it('gives every icon action an accessible name and touch target', () => {
    const onClick = vi.fn();
    render(<ActionRow actions={[{ id: 'copy', label: 'Copy answer', icon: <span aria-hidden="true">C</span>, onClick }]} />);
    const button = screen.getByRole('button', { name: 'Copy answer' });
    expect(button.className).toContain('min-h-11');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders link chips and expands hidden sources', () => {
    render(<Sources sources={Array.from({ length: 7 }, (_, index) => ({ label: 'Source ' + index, href: 'https://example.com/' + index }))} />);
    expect(screen.getAllByRole('link')).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: 'Show 2 more sources' }));
    expect(screen.getAllByRole('link')).toHaveLength(7);
  });

  it('keeps skeleton bars decorative', () => {
    const { container } = render(<Skeleton />);
    expect(container.querySelector('[aria-hidden="true"]')).toBeTruthy();
    expect(container.querySelectorAll('div[style]')).toHaveLength(3);
  });
});

describe('SideSheet', () => {
  const Harness = () => {
    const [open, setOpen] = useState(false);
    const [full, setFull] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>Open sheet</button>
        <span>{full ? 'full page requested' : ''}</span>
        <SideSheet open={open} onClose={() => setOpen(false)} title="Backtest result" onOpenFullPage={() => setFull(true)}>
          <p>Sheet body</p>
        </SideSheet>
      </>
    );
  };

  it('opens as a labelled modal dialog with a focus trap and Escape close', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Open sheet' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Backtest result' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(dialog);
    expect(within(dialog).getByText('Sheet body')).toBeTruthy();

    const fullPage = within(dialog).getByRole('button', { name: 'Open full page' });
    const close = within(dialog).getByRole('button', { name: 'Close details' });
    close.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(fullPage);

    fireEvent.click(fullPage);
    expect(screen.getByText('full page requested')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
