// @vitest-environment jsdom
import React from 'react';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AiCopilotDock } from '../../components/chat/AiCopilotDock';
import { validStrategy } from '../../server/ai/testFixtures';
import { requestResearchChat } from '../../client/researchChat';

vi.mock('../../client/researchChat', () => ({ requestResearchChat: vi.fn() }));
vi.mock('../../client/api', () => ({ requestScan: vi.fn() }));
vi.mock('../../client/featureSetup', () => ({ requestFeatureSetup: vi.fn() }));

let dom: JSDOM;

beforeEach(() => {
  dom = new JSDOM('', { url: 'https://chat-anatomy.test' });
  vi.stubGlobal('localStorage', dom.window.localStorage);
});

afterEach(() => {
  cleanup();
  dom.window.close();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const send = (text: string) => {
  fireEvent.change(screen.getByLabelText('Research request'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
};

describe('chat message anatomy', () => {
  it('keeps aria-live off the log and announces through one hidden status region', async () => {
    vi.mocked(requestResearchChat).mockReturnValue(new Promise(() => {}) as never);
    render(<AiCopilotDock strategy={validStrategy()} />);
    const log = screen.getByRole('log', { name: 'Conversation' });
    expect(log.getAttribute('aria-live')).toBeNull();
    expect(document.querySelectorAll('[aria-live]')).toHaveLength(1);
    expect(document.querySelector('[aria-live="polite"]')?.className).toContain('sr-only');
    send('Explain RSI');
    await waitFor(() => expect(document.querySelector('[aria-live="polite"]')?.textContent).toBe('Stragy is working on your request.'));
    expect(log.getAttribute('aria-busy')).toBe('true');
  });

  it('shows one in-flow placeholder instead of a composer status line', async () => {
    vi.mocked(requestResearchChat).mockReturnValue(new Promise(() => {}) as never);
    render(<AiCopilotDock strategy={validStrategy()} />);
    send('Explain RSI');
    expect(await screen.findByTestId('assistant-pending')).toBeTruthy();
    expect(screen.queryByText(/Preparing a response/)).toBeNull();
    expect(screen.queryByText(/Scanning actual current daily data/)).toBeNull();
  });

  it('keeps focus in the composer after sending', async () => {
    vi.mocked(requestResearchChat).mockReturnValue(new Promise(() => {}) as never);
    render(<AiCopilotDock strategy={validStrategy()} />);
    send('Explain RSI');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Research request')));
  });

  it('labels only the first assistant turn of a run', () => {
    dom.window.localStorage.setItem('stragy_copilot_review_history_v2', JSON.stringify([
      { id: 'u1', sender: 'user', text: 'First question', timestamp: 1 },
      { id: 'a1', sender: 'assistant', text: 'First answer', timestamp: 2 },
      { id: 'a2', sender: 'assistant', text: 'Second answer in the same run', timestamp: 3 },
      { id: 'u2', sender: 'user', text: 'Second question', timestamp: 4 },
      { id: 'a3', sender: 'assistant', text: 'Third answer', timestamp: 5 },
    ]));
    render(<AiCopilotDock strategy={validStrategy()} />);
    expect(screen.getAllByText('Stragy')).toHaveLength(2);
  });

  it('renders links, headings and fenced code without parsing HTML', () => {
    dom.window.localStorage.setItem('stragy_copilot_review_history_v2', JSON.stringify([
      { id: 'a1', sender: 'assistant', text: '### RSI below 30\n\nRead [the guide](https://example.com/rsi) or https://example.com/docs.\n\n```ts\nconst rsi = 28;\n```\n\n<script>alert(1)</script>', timestamp: 1 },
    ]));
    render(<AiCopilotDock strategy={validStrategy()} />);
    expect(screen.getByRole('heading', { level: 3, name: 'RSI below 30' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'the guide' }).getAttribute('href')).toBe('https://example.com/rsi');
    expect(screen.getByRole('link', { name: 'https://example.com/docs' })).toBeTruthy();
    expect(screen.getByText('const rsi = 28;')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
    expect(document.querySelector('script')).toBeNull();
    expect(document.body.textContent).toContain('<script>alert(1)</script>');
  });
});
