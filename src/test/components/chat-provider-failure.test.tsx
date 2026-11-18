// @vitest-environment jsdom
import React from 'react';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AiCopilotDock } from '../../components/chat/AiCopilotDock';
import { validStrategy } from '../../server/ai/testFixtures';
import { postEngineMessage } from '../../client/engine';
import { engineReply, engineReplyDefault, resetEngineHarness } from '../../test/support/engineMock';
vi.mock('../../client/engine', async () => await import('../../test/support/engineMock'));

let dom: JSDOM;
beforeEach(() => {
  dom = new JSDOM('', { url: 'https://research.test' });
  vi.stubGlobal('localStorage', dom.window.localStorage);
  resetEngineHarness();
});
afterEach(() => {
  cleanup();
  dom.window.close();
  vi.unstubAllGlobals();
});

function providerFailure(message: string, originatingRevision: number | string | null = null) {
  return {
    schemaVersion: 1 as const,
    kind: 'conversation' as const,
    originatingRevision,
    message,
    method: 'unavailable' as const,
    provider: { name: 'opencode-go', model: null, aiGenerated: false },
    warnings: ['http_error'],
  };
}

function mockFailure(message: string) {
  engineReplyDefault(() => providerFailure(message));
}

function send(text = 'Hello, what can you help me with?') {
  fireEvent.change(screen.getByLabelText('Research request'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
}

describe('D01 provider failure bubble', () => {
  it('shows one friendly rate-limit message with Retry and no duplicate red alert', async () => {
    mockFailure('External AI request failed (http_error): AI provider returned HTTP 429.');
    render(<AiCopilotDock strategy={validStrategy()} />);
    send();
    expect(await screen.findByText('The AI model is busy (rate limit). Try again in a minute.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(/^External AI request failed/).closest('details')).toBeTruthy();
    expect(screen.getByText(/Warnings \(2\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(postEngineMessage).toHaveBeenCalledTimes(2));
  });

  it('shows one friendly refusal message for HTTP 403', async () => {
    mockFailure('External AI request failed (http_error): AI provider refused access (HTTP 403). Check the configured key\'s model permissions.');
    render(<AiCopilotDock strategy={validStrategy()} />);
    send();
    expect(await screen.findByText('The AI model refused the request.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('labels a successful answer with the model that actually answered', async () => {
    engineReplyDefault(async () => ({
      schemaVersion: 1 as const,
      kind: 'conversation' as const,
      originatingRevision: 1,
      message: 'Hello! I can help with screens, drafts and backtests.',
      method: 'external_ai' as const,
      provider: { name: 'opencode-go', model: 'hy4-flash-free', aiGenerated: true },
      warnings: [],
    }));
    render(<AiCopilotDock strategy={validStrategy()} />);
    send();
    expect(await screen.findByText('Hello! I can help with screens, drafts and backtests.')).toBeTruthy();
    const label = screen.getByText('AI · HY4 Flash (free)');
    expect(label.getAttribute('title')).toMatch(/opencode-go/);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});


