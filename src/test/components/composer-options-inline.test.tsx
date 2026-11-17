// @vitest-environment jsdom
import React from 'react';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AiCopilotDock } from '../../components/chat/AiCopilotDock';
import { validStrategy } from '../../server/ai/testFixtures';

vi.mock('../../client/researchChat', () => ({ requestResearchChat: vi.fn() }));
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

/**
 * jsdom applies no layout, so this asserts the mechanism that keeps the
 * textarea clear on a phone: the panel is an in-flow block inside the composer
 * (no absolute/fixed positioning, no z-index) sitting directly before the
 * textarea, which stays mounted and editable. The 390 px overlap is measured
 * by qa/fixes-scripts/chat-ui-jump-options.cjs.
 */
describe('composer request options', () => {
  it('opens inline above the textarea and leaves the field intact', () => {
    render(<AiCopilotDock strategy={validStrategy()} />);
    const trigger = screen.getByRole('button', { name: 'Request options' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById('composer-options')).toBeNull();

    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(trigger.getAttribute('aria-controls')).toBe('composer-options');

    const panel = document.getElementById('composer-options');
    expect(panel).toBeTruthy();
    // In flow, inside the composer: an overlay would be absolutely positioned.
    expect(panel?.className).not.toMatch(/\b(absolute|fixed|sticky)\b|z-\d/);
    expect(panel?.closest('form')).toBe(screen.getByTestId('research-composer'));

    const textarea = screen.getByLabelText('Research request') as HTMLTextAreaElement;
    expect(panel?.nextElementSibling).toBe(textarea);
    expect(textarea.className).not.toMatch(/\bhidden\b|overflow-hidden/);
    expect(textarea.disabled).toBe(false);

    // One option, its sentence, and the 44 px label row survive.
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(screen.getByRole('checkbox', { name: /Allow local keyword fallback/ })).toBeTruthy();
    expect(screen.getByText('Local tools only understand explicit stop, target, trailing-stop and symbol edits.')).toBeTruthy();
    expect(panel?.querySelector('label')?.className).toContain('min-h-11');
  });

  it('closes on Escape and returns focus to the trigger', () => {
    render(<AiCopilotDock strategy={validStrategy()} />);
    const trigger = screen.getByRole('button', { name: 'Request options' });
    fireEvent.click(trigger);
    const checkbox = screen.getByRole('checkbox', { name: /Allow local keyword fallback/ });

    fireEvent.keyDown(checkbox, { key: 'Escape' });
    expect(document.getElementById('composer-options')).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);

    // Still one option after reopening, and the choice is unchanged.
    fireEvent.click(trigger);
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(1);
    expect((boxes[0] as HTMLInputElement).checked).toBe(true);
  });
});
