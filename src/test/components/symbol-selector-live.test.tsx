// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SymbolSearchSelector } from '../../components/layout/SymbolSearchSelector';
import type { SymbolMeta } from '../../shared/strategy/types';

const symbol = (id: number, ticker: string, name: string, currentPrice = 100 + id, changePercent = 0.5): SymbolMeta => ({
  id, ticker, name, exchange: 'NSE', sector: 'Energy', currentPrice, changePercent,
});
const symbols: SymbolMeta[] = [
  symbol(9, 'RELIANCE', 'Reliance Industries Ltd.', 1339.7, -0.32),
  symbol(1, 'NIFTY 50', 'NIFTY 50 Benchmark Index', 25144.3, 0.26),
  symbol(7, 'HDFCBANK', 'HDFC Bank Ltd.', 884, -1.02),
  symbol(8, 'TCS', 'Tata Consultancy Services Ltd.', 2407.5, -1.43),
  ...Array.from({ length: 11 }, (_, index) => symbol(20 + index, 'STOCK' + (20 + index), 'Fixture stock ' + (20 + index))),
];
const idsFrom = (url: string) => {
  const query = new URL(String(url), 'http://local').searchParams.get('symbolIds') ?? '';
  return query.split(',').filter(Boolean).map(Number);
};
const quoteFor = (id: number) => {
  const found = symbols.find(item => item.id === id)!;
  return {
    symbolId: id,
    ticker: found.ticker,
    ltp: id === 9 ? 1335.4 : id === 7 ? 2900 : id === 8 ? 45.25 : found.currentPrice,
    open: found.currentPrice,
    high: found.currentPrice,
    low: found.currentPrice,
    close: found.currentPrice,
    changePercent: id === 9 ? -0.32 : 1.25,
    exchangeTimestamp: '2026-11-16T09:10:55Z',
    fetchedAt: '2026-11-16T09:10:53.755Z',
    source: 'ANGEL_SMARTAPI' as const,
    delay: 'live' as const,
  };
};
const responseFor = (ids: number[]) => ({
  success: true,
  source: 'ANGEL_SMARTAPI',
  available: true,
  delay: 'live',
  fetchedAt: '2026-11-16T09:10:53.755Z',
  cached: false,
  configured: true,
  quotes: ids.map(quoteFor),
  unavailable: [],
  labels: [],
});
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () => responseFor(idsFrom(url)) }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

const pill = () => document.querySelector('#btn-symbol-pill-trigger') as HTMLElement;

describe('live quotes in the symbol selector', () => {
  it('shows the selected live LTP and the visible row prices', async () => {
    render(<SymbolSearchSelector symbols={symbols} currentSymbolId={9} onSymbolChange={vi.fn()} />);
    await waitFor(() => expect(within(pill()).getByText('₹1,335.40')).toBeTruthy());
    expect(within(pill()).getByText('-0.32%')).toBeTruthy();

    fireEvent.click(pill());
    expect(await screen.findByText('Live LTP · Angel One')).toBeTruthy();
    expect(await screen.findByText('₹2,900.00')).toBeTruthy();
    expect(screen.getByText('₹45.25')).toBeTruthy();
    expect(screen.getByText('Reliance Industries Ltd.')).toBeTruthy();
    const ids = idsFrom(String(fetchMock.mock.calls.at(-1)?.[0]));
    expect(ids).toHaveLength(10);
    expect(ids[0]).toBe(9);
  });

  it('never shows live prices in demo reference mode', () => {
    render(<SymbolSearchSelector symbols={symbols} currentSymbolId={9} onSymbolChange={vi.fn()} showReferencePrices />);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(within(pill()).getByText('₹1,339.7')).toBeTruthy();
    fireEvent.click(pill());
    expect(screen.queryByText('Live LTP · Angel One')).toBeNull();
    expect(screen.getAllByText('₹1,339.7').length).toBeGreaterThan(0);
  });
});
