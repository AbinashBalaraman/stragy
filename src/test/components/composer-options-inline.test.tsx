// @vitest-environment jsdom
import React from 'react';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { AiCopilotDock } from '../../components/chat/AiCopilotDock';
import { validStrategy } from '../../server/ai/testFixtures';

vi.mock('../../client/engine', async () => await import('../../test/support/engineMock'));
vi.mock('../../client/api', () => ({ requestScan: vi.fn() }));
vi.mock('../../client/featureSetup', () => ({ requestFeatureSetup: vi.fn() }));

let dom: JSDOM;

beforeEach(() => {
  dom = new JSDOM('', { url: 'https://composer-options.test' });
  vi.stubGlobal('localStorage', dom.window.localStorage);
});

afterEach(() => {
  cleanup();
  dom.window.close();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('composer controls', () => {
  it('removes the Request options control and keeps the research composer usable', () => {
    render(<AiCopilotDock strategy={validStrategy()} />);
    expect(screen.queryByRole('button', { name: 'Request options' })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByText('Allow local keyword fallback (not AI)')).toBeNull();
    expect(screen.getByLabelText('Research request')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Attach chart image' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send request' })).toBeTruthy();
  });
});
