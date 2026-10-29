// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { AppShell } from '../../components/layout/AppShell';

const renderShell = (onNavigate = vi.fn(), onNewChat = vi.fn()) => {
  render(<AppShell activeView="chat" onNavigate={onNavigate} onNewChat={onNewChat} dataMode="unknown">Chat content</AppShell>);
  return { onNavigate, onNewChat };
};

afterEach(cleanup);

describe('calm app shell', () => {
  it('defaults to a chat-first surface with advanced tools hidden', () => {
    const onNewChat = vi.fn();
    renderShell(vi.fn(), onNewChat);

    expect(screen.getByText('Chat content')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Conversation' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Strategy builder' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Market scanner' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Backtest analytics' })).toBeNull();

    const advanced = screen.getByRole('button', { name: /Advanced tools/ });
    expect(advanced.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(advanced);

    expect(advanced.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: 'Strategy builder' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Market scanner' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Backtest analytics' })).toBeTruthy();
    expect(onNewChat).not.toHaveBeenCalled();
  });

  it('routes advanced navigation without treating it as a new chat', () => {
    const { onNavigate, onNewChat } = renderShell();
    fireEvent.click(screen.getByRole('button', { name: /Advanced tools/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Strategy builder' }));

    expect(onNavigate).toHaveBeenCalledWith('builder');
    expect(onNewChat).not.toHaveBeenCalled();
  });

  it('opens an accessible mobile drawer and navigates from it', () => {
    const { onNavigate } = renderShell();
    const trigger = screen.getByRole('button', { name: 'Open navigation' });
    fireEvent.click(trigger);

    const dialog = screen.getByRole('dialog', { name: 'Navigation menu' });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Close navigation' }));

    fireEvent.click(within(dialog).getByRole('button', { name: /Advanced tools/ }));
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

  it('returns to the conversation without clearing it', () => {
    const { onNavigate, onNewChat } = renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Conversation' }));

    expect(onNavigate).toHaveBeenCalledWith('chat');
    expect(onNewChat).not.toHaveBeenCalled();
  });
});
