// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { AppShell } from '../../components/layout/AppShell';

const renderShell = (onNavigate = vi.fn(), onNewChat = vi.fn()) => {
  render(<AppShell activeView="chat" onNavigate={onNavigate} onNewChat={onNewChat} dataMode="unknown">Chat content</AppShell>);
  return { onNavigate, onNewChat };
};

const RAIL_ORDER = ['New chat', 'Chat', 'Market scanner', 'Strategy tester', 'Backtest results', 'Saved strategies', 'AI providers'];
const navLabels = (scope: HTMLElement) =>
  within(scope).getAllByRole('button').map(button => button.textContent?.trim() ?? '');

afterEach(cleanup);

describe('calm app shell', () => {
  it('shows every research tool in the rail up front, in the owner order', () => {
    const onNewChat = vi.fn();
    renderShell(vi.fn(), onNewChat);

    expect(screen.getByText('Chat content')).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(navLabels(nav)).toEqual(RAIL_ORDER);
    expect(screen.queryByRole('button', { name: /Advanced tools/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Chat' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('button', { name: 'Saved strategies' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'AI providers' })).toBeTruthy();
    expect(onNewChat).not.toHaveBeenCalled();
  });

  it('routes tool navigation without treating it as a new chat', () => {
    const { onNavigate, onNewChat } = renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Strategy tester' }));

    expect(onNavigate).toHaveBeenCalledWith('builder');
    expect(onNewChat).not.toHaveBeenCalled();
  });

  it('routes each rail item to its view', () => {
    const { onNavigate } = renderShell();
    const expected: Array<[string, string]> = [
      ['Market scanner', 'scanner'],
      ['Strategy tester', 'builder'],
      ['Backtest results', 'results'],
      ['Saved strategies', 'library'],
      ['AI providers', 'settings'],
    ];
    for (const [label, view] of expected) fireEvent.click(screen.getByRole('button', { name: label }));
    expect(onNavigate.mock.calls.map(call => call[0])).toEqual(expected.map(([, view]) => view));
  });

  it('opens an accessible mobile drawer with the same order and navigates from it', () => {
    const { onNavigate } = renderShell();
    const trigger = screen.getByRole('button', { name: 'Open navigation' });
    fireEvent.click(trigger);

    const dialog = screen.getByRole('dialog', { name: 'Navigation menu' });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Close navigation' }));
    expect(navLabels(within(dialog).getByRole('navigation', { name: 'Primary' }))).toEqual(RAIL_ORDER);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Market scanner' }));

    expect(onNavigate).toHaveBeenCalledWith('scanner');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on Escape, restores focus to the trigger and keeps Tab inside the drawer', () => {
    renderShell();
    const trigger = screen.getByRole('button', { name: 'Open navigation' });
    fireEvent.click(trigger);

    const dialog = screen.getByRole('dialog', { name: 'Navigation menu' });
    const focusable = within(dialog).getAllByRole('button');
    const last = focusable[focusable.length - 1];
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(focusable[0]);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });

  it('returns to the chat without clearing it', () => {
    const { onNavigate, onNewChat } = renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Chat' }));

    expect(onNavigate).toHaveBeenCalledWith('chat');
    expect(onNewChat).not.toHaveBeenCalled();
  });

  it('shows a neutral checking state before the first quote result, never the wrong label', () => {
    const view = render(
      <AppShell activeView="chat" onNavigate={vi.fn()} onNewChat={vi.fn()} dataMode="real" liveQuotes={{ connected: false, provider: null, loading: true }}>
        Chat content
      </AppShell>
    );
    expect(screen.getByText('Checking quotes…')).toBeTruthy();
    expect(screen.queryByText(/Observed public daily data/)).toBeNull();
    expect(screen.queryByText(/Live quotes ·/)).toBeNull();

    view.rerender(
      <AppShell activeView="chat" onNavigate={vi.fn()} onNewChat={vi.fn()} dataMode="real" liveQuotes={{ connected: false, provider: null, loading: false }}>
        Chat content
      </AppShell>
    );
    expect(screen.getByText(/Observed public daily data · delayed, not live/)).toBeTruthy();
    expect(screen.queryByText('Checking quotes…')).toBeNull();
  });

  it('keeps the AI providers pill the same width as the other rail items', () => {
    renderShell();
    const settings = screen.getByRole('button', { name: 'AI providers' });
    expect(settings.className).toContain('w-full');
    expect(settings.className).toContain('rounded-xl');
  });

  it('shows connected Angel One quotes only in real mode and keeps the delayed wording otherwise', () => {
    const view = render(
      <AppShell activeView="chat" onNavigate={vi.fn()} onNewChat={vi.fn()} dataMode="real" liveQuotes={{ connected: true, provider: 'angel' }}>
        Chat content
      </AppShell>
    );
    expect(screen.getByText('Live quotes · Angel One')).toBeTruthy();
    expect(screen.getByText('Research bars remain delayed, not live')).toBeTruthy();
    expect(screen.queryByText(/Observed public daily data/)).toBeNull();

    view.rerender(
      <AppShell activeView="chat" onNavigate={vi.fn()} onNewChat={vi.fn()} dataMode="real" liveQuotes={{ connected: false, provider: null }}>
        Chat content
      </AppShell>
    );
    expect(screen.getByText(/Observed public daily data · delayed, not live/)).toBeTruthy();

    view.rerender(
      <AppShell activeView="chat" onNavigate={vi.fn()} onNewChat={vi.fn()} dataMode="demo" liveQuotes={{ connected: true, provider: 'angel' }}>
        Chat content
      </AppShell>
    );
    expect(screen.getByText(/Demo research · generated bars, not observed/)).toBeTruthy();
    expect(screen.queryByText('Live quotes · Angel One')).toBeNull();
  });
});
