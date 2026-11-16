// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MessageText } from '../../components/chat/MessageText';

afterEach(cleanup);

describe('MessageText', () => {
  it('renders "-" lines as a real bullet list', () => {
    const { container } = render(<MessageText text={'Here is what I can do:\n- Screen Nifty 50 stocks\n- Backtest a reviewed screen\n- Explain indicators'} />);
    expect(screen.getByText('Here is what I can do:')).toBeTruthy();
    const list = container.querySelector('ul');
    expect(list).toBeTruthy();
    expect(list!.querySelectorAll('li')).toHaveLength(3);
    expect(list!.textContent).toContain('Backtest a reviewed screen');
  });

  it('renders numbered lines as an ordered list, preserving the start number', () => {
    const { container } = render(<MessageText text={'Steps:\n2. Open the workspace\n3. Run the backtest'} />);
    const list = container.querySelector('ol');
    expect(list).toBeTruthy();
    expect(list!.getAttribute('start')).toBe('2');
    expect(list!.querySelectorAll('li')).toHaveLength(2);
  });

  it('renders **bold** and `code` without showing the markers', () => {
    const { container } = render(<MessageText text={'A **delayed** close from `YAHOO_PUBLIC_CHART`.'} />);
    expect(container.querySelector('strong')?.textContent).toBe('delayed');
    expect(container.querySelector('code')?.textContent).toBe('YAHOO_PUBLIC_CHART');
    expect(container.textContent).toBe('A delayed close from YAHOO_PUBLIC_CHART.');
    expect(container.textContent).not.toContain('**');
    expect(container.textContent).not.toContain('`');
  });

  it('keeps blank-line separated text as separate paragraphs', () => {
    const { container } = render(<MessageText text={'First paragraph.\n\nSecond paragraph.'} />);
    expect(container.querySelectorAll('p')).toHaveLength(2);
  });

  it('never turns model text into HTML', () => {
    const hostile = '<img src=x onerror="alert(1)"> <script>alert(2)</script> **<b>bold</b>**';
    const { container } = render(<MessageText text={hostile} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelector('strong')?.textContent).toBe('<b>bold</b>');
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
  });

  it('shows an empty string without crashing', () => {
    const { container } = render(<MessageText text="" />);
    expect(container.textContent).toBe('');
  });
});
