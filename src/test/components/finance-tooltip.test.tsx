// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FinanceTooltip } from '../../components/common/Tooltip';
afterEach(cleanup);
describe('financial help tooltip', () => {
  it('opens on focus and dismisses with Escape', () => {
    render(<FinanceTooltip term="Sharpe" content="Risk-adjusted historical returns, not a forecast." />);
    const trigger = screen.getByRole('button', { name: 'Explain Sharpe' });
    fireEvent.focus(trigger);
    expect(screen.getByRole('tooltip').textContent).toContain('not a forecast');
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
  it('opens on touch/click and closes on blur', () => {
    render(<FinanceTooltip content="Undefined ratios are unavailable." />);
    const trigger = screen.getByRole('button', { name: 'Explain financial term' });
    fireEvent.click(trigger);
    expect(screen.getByRole('tooltip').id).toBe(trigger.getAttribute('aria-describedby'));
    fireEvent.blur(trigger);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
