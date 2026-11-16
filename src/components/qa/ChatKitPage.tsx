import React, { useState } from 'react';
import { Copy, RotateCcw, ThumbsDown, ThumbsUp } from 'lucide-react';
import { CardShell } from '../common/CardShell';
import { DataTable, type DataColumn } from '../common/DataTable';
import { StatRow } from '../common/StatRow';
import { Sparkline } from '../common/Sparkline';
import { EquityCurve } from '../common/EquityCurve';
import { TickerChip } from '../common/TickerChip';
import { Disclosure } from '../common/Disclosure';
import { ActionRow } from '../common/ActionRow';
import { Sources } from '../common/Sources';
import { Skeleton } from '../common/Skeleton';
import { SideSheet } from '../common/SideSheet';

interface ScanRow {
  symbol: string;
  name: string;
  sector: string;
  close: number;
  change: number;
  rsi: number;
  trend: string;
  conditions: string;
}

const scanRows: ScanRow[] = [
  { symbol: 'SBIN', name: 'State Bank of India', sector: 'Financials', close: 1090.5, change: 0.97, rsi: 72.3, trend: 'Uptrend', conditions: '3 of 3' },
  { symbol: 'BHARTIARTL', name: 'Bharti Airtel', sector: 'Telecom', close: 2153.5, change: 2.26, rsi: 68.1, trend: 'Uptrend', conditions: '3 of 3' },
  { symbol: 'RELIANCE', name: 'Reliance Industries', sector: 'Energy', close: 1344.8, change: 0.38, rsi: 66.4, trend: 'Uptrend', conditions: '3 of 3' },
  { symbol: 'ICICIBANK', name: 'ICICI Bank', sector: 'Financials', close: 1419.2, change: 1.12, rsi: 64.9, trend: 'Uptrend', conditions: '3 of 3' },
  { symbol: 'TCS', name: 'Tata Consultancy Services', sector: 'IT', close: 2405.0, change: -0.1, rsi: 52.7, trend: 'Sideways', conditions: '2 of 3' },
  { symbol: 'INFY', name: 'Infosys', sector: 'IT', close: 1523.4, change: 0.44, rsi: 55.1, trend: 'Sideways', conditions: '2 of 3' },
  { symbol: 'HDFCBANK', name: 'HDFC Bank', sector: 'Financials', close: 816.5, change: 1.55, rsi: 63.8, trend: 'Uptrend', conditions: '3 of 3' },
  { symbol: 'ITC', name: 'ITC', sector: 'FMCG', close: 295.1, change: 3.54, rsi: 70.2, trend: 'Uptrend', conditions: '3 of 3' },
  { symbol: 'MARUTI', name: 'Maruti Suzuki', sector: 'Auto', close: 12571.0, change: -2.2, rsi: 44.6, trend: 'Downtrend', conditions: '1 of 3' },
  { symbol: 'TATASTEEL', name: 'Tata Steel', sector: 'Metals', close: 182.26, change: -2.37, rsi: 41.2, trend: 'Downtrend', conditions: '1 of 3' },
  { symbol: 'HINDALCO', name: 'Hindalco', sector: 'Metals', close: 923.3, change: -2.15, rsi: 43.9, trend: 'Downtrend', conditions: '1 of 3' },
  { symbol: 'COALINDIA', name: 'Coal India', sector: 'Energy', close: 397.5, change: -1.49, rsi: 46.3, trend: 'Sideways', conditions: '2 of 3' },
];

const scanColumns: DataColumn<ScanRow>[] = [
  { key: 'symbol', header: 'Symbol', render: row => <span className="font-medium text-[var(--text-1)]">{row.symbol}</span> },
  { key: 'sector', header: 'Sector', render: row => row.sector },
  { key: 'close', header: 'Close', align: 'right', render: row => '₹' + row.close.toLocaleString('en-IN', { minimumFractionDigits: 2 }) },
  { key: 'change', header: 'Change', align: 'right', render: row => <span className={row.change >= 0 ? 'text-[var(--up)]' : 'text-[var(--down)]'}>{(row.change >= 0 ? '+' : '') + row.change.toFixed(2)}%</span> },
  { key: 'rsi', header: 'RSI(14)', align: 'right', render: row => row.rsi.toFixed(1) },
  { key: 'trend', header: 'Trend', render: row => row.trend },
  { key: 'conditions', header: 'Conditions', align: 'right', render: row => row.conditions },
];

interface TradeRow {
  id: string;
  entry: string;
  exit: string;
  side: string;
  qty: number;
  pnl: number;
}

const trades: TradeRow[] = [
  { id: 't1', entry: '18 Dec 2025', exit: '06 Jan 2026', side: 'Long', qty: 11, pnl: 1840.2 },
  { id: 't2', entry: '02 Feb 2026', exit: '19 Feb 2026', side: 'Long', qty: 11, pnl: -612.4 },
  { id: 't3', entry: '11 Mar 2026', exit: '27 Mar 2026', side: 'Long', qty: 10, pnl: 2215.0 },
  { id: 't4', entry: '05 May 2026', exit: '21 May 2026', side: 'Long', qty: 9, pnl: 640.75 },
  { id: 't5', entry: '14 Jul 2026', exit: '03 Aug 2026', side: 'Long', qty: 9, pnl: -388.1 },
];

const tradeColumns: DataColumn<TradeRow>[] = [
  { key: 'entry', header: 'Entry', render: row => row.entry },
  { key: 'exit', header: 'Exit', render: row => row.exit },
  { key: 'side', header: 'Side', render: row => row.side },
  { key: 'qty', header: 'Qty', align: 'right', render: row => String(row.qty) },
  { key: 'pnl', header: 'P&L', align: 'right', render: row => <span className={row.pnl >= 0 ? 'text-[var(--up)]' : 'text-[var(--down)]'}>{'₹' + row.pnl.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span> },
];

const equity = [100000, 100420, 100180, 101060, 101540, 101210, 102080, 102640, 102310, 103150, 103480, 103020, 104180, 104520, 104260, 105090];

/**
 * QA-only preview of the chat kit primitives (/?qa=chat-kit).
 * It is not linked from the app navigation or from any product screen.
 */
export const ChatKitPage: React.FC = () => {
  const [sheetOpen, setSheetOpen] = useState(false);
  return (
    <div className="mx-auto w-full max-w-[1100px] space-y-4 p-4 sm:p-6">
      <header className="space-y-1">
        <h1 className="st-title text-xl font-semibold text-[var(--text-1)]">Chat kit</h1>
        <p className="st-meta text-[var(--text-3)]">
          QA preview of the shared primitives. Not linked from the app; reachable only at <code className="text-[var(--text-2)]">?qa=chat-kit</code>.
        </p>
      </header>

      <CardShell
        title="RSI trendline breakout · Nifty 50"
        meta="12 matches · 50 evaluated · session 16 Nov 2026"
        status="Ready"
        footer={<ActionRow actions={[{ id: 'retry', label: 'Re-run screen', icon: <RotateCcw className="h-4 w-4" aria-hidden="true" />, onClick: () => {} }]} leading={<span className="st-meta text-[var(--text-3)]">Daily bars · not live</span>} />}
      >
        <DataTable
          caption="Scan matches, 12 rows and 7 columns"
          columns={scanColumns}
          rows={scanRows}
          rowKey={row => row.symbol}
          initialLimit={8}
        />
      </CardShell>

      <CardShell
        title="Supertrend with EMA filter · RELIANCE"
        meta="495 sessions · 8 trades · 16 Nov 2026"
        status="Partial: 8 of 30 trades"
        state="partial"
        footer={<ActionRow actions={[
          { id: 'copy', label: 'Copy result', icon: <Copy className="h-4 w-4" aria-hidden="true" />, onClick: () => {} },
          { id: 'rerun', label: 'Re-run backtest', icon: <RotateCcw className="h-4 w-4" aria-hidden="true" />, onClick: () => {} },
        ]} />}
      >
        <StatRow stats={[
          { label: 'Net P&L', value: '+₹182.90' },
          { label: 'CAGR', value: '+0.09%' },
          { label: 'Max drawdown', value: '0.70%' },
          { label: 'Win rate', value: '62.5%' },
          { label: 'Trades', value: '8' },
          { label: 'Sharpe', value: '—', unavailable: true },
        ]} />
        <EquityCurve values={equity} ariaLabel="Equity curve from ₹1,00,000 to ₹1,05,090 over 495 sessions" />
        <div>
          <p className="st-label mb-1 text-[var(--text-3)]">Last 5 trades</p>
          <DataTable caption="Trade log, 5 of 8 trades" columns={tradeColumns} rows={trades} rowKey={row => row.id} initialLimit={5} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <TickerChip symbol="RELIANCE" price={1344.8} changePercent={0.38} />
          <TickerChip symbol="TCS" price={2405} changePercent={-0.1} />
          <TickerChip symbol="SBIN" loading />
        </div>
        <Sparkline values={[100, 101.2, 100.6, 102.4, 101.8, 103.1, 104.0]} summary="+4.0% over 1M" />
        <Disclosure summary="Assumptions (4)">
          <p>Stop-first ambiguity. Costs include 5 bps slippage and ₹20 per fill.</p>
          <p>Daily bars are delayed, not a live tick feed.</p>
        </Disclosure>
        <Sources sources={[
          { label: 'Yahoo public chart', href: 'https://finance.yahoo.com', title: 'Daily bars' },
          { label: 'Angel One SmartAPI', href: 'https://smartapi.angelone.in', title: 'Quotes' },
          { label: 'NSE constituents', href: 'https://nsearchives.nseindia.com', title: 'Membership' },
          { label: 'Cost model', title: 'Illustrative Indian cash fees' },
          { label: 'Run manifest' },
          { label: 'Robustness note' },
        ]} />
      </CardShell>

      <div className="grid gap-4 lg:grid-cols-2">
        <CardShell title="Planning the screen" state="pending" status="Working…" tone="default" meta="Reading your request · 2 steps done">
          <Skeleton />
          <p className="st-meta text-[var(--text-3)]">Screen plan → validate rules → evaluate 50 symbols.</p>
        </CardShell>
        <CardShell
          title="The screen didn't run"
          state="error"
          status="Provider timeout"
          tone="warn"
          meta="Nothing was run; no zero-match conclusion was made."
          footer={<ActionRow actions={[{ id: 'retry', label: 'Retry screen', icon: <RotateCcw className="h-4 w-4" aria-hidden="true" />, onClick: () => {} }]} />}
        >
          <p className="st-meta text-[var(--text-2)]">The provider returned no usable text. Retry with the same rule or edit it first.</p>
          <Disclosure summary="Technical details">
            <p>code: ai_invalid_response · provider: opencode-go:hy4-flash-free</p>
          </Disclosure>
        </CardShell>
      </div>

      <CardShell title="Actions and sources" meta="Copy · retry · feedback" status="Ready">
        <ActionRow
          leading={<Sources sources={[{ label: 'Yahoo public daily' }, { label: 'Angel One quotes' }]} />}
          actions={[
            { id: 'copy', label: 'Copy answer', icon: <Copy className="h-4 w-4" aria-hidden="true" />, onClick: () => {} },
            { id: 'retry', label: 'Retry answer', icon: <RotateCcw className="h-4 w-4" aria-hidden="true" />, onClick: () => {} },
            { id: 'up', label: 'Helpful', icon: <ThumbsUp className="h-4 w-4" aria-hidden="true" />, onClick: () => {} },
            { id: 'down', label: 'Not helpful', icon: <ThumbsDown className="h-4 w-4" aria-hidden="true" />, onClick: () => {} },
          ]}
        />
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setSheetOpen(true)} className="st-meta rounded-[var(--r-btn)] border border-[var(--line)] px-2.5 py-1.5 text-[var(--text-2)] hover:border-[var(--line-strong)] hover:text-[var(--text-1)]">
            Open result in sheet
          </button>
        </div>
      </CardShell>

      <SideSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Supertrend with EMA filter · RELIANCE"
        onOpenFullPage={() => setSheetOpen(false)}
      >
        <div className="space-y-4 p-4 sm:p-5">
          <StatRow stats={[
            { label: 'Net P&L', value: '+₹182.90' },
            { label: 'CAGR', value: '+0.09%' },
            { label: 'Max drawdown', value: '0.70%' },
            { label: 'Win rate', value: '62.5%' },
            { label: 'Trades', value: '8' },
            { label: 'Sharpe', value: '—', unavailable: true },
          ]} />
          <EquityCurve values={equity} ariaLabel="Equity curve from ₹1,00,000 to ₹1,05,090" />
          <DataTable caption="Trade log in the sheet" columns={tradeColumns} rows={trades} rowKey={row => row.id} initialLimit={5} />
        </div>
      </SideSheet>
    </div>
  );
};
