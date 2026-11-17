import { describe, expect, it } from 'vitest';
import { marketLoadingMessage } from '../../components/scanner/marketLoading';

describe('market scanner loading copy', () => {
  it('names the queue instead of showing an unexplained skeleton', () => {
    expect(marketLoadingMessage({ status: 'queued' }, 'Nifty 50')).toBe('Waiting for the current scan to finish…');
    expect(marketLoadingMessage({ status: 'queued', queuedBehind: 2 }, 'Nifty 50')).toBe('Waiting for the current scan to finish…');
  });

  it('shows the first-load expectation before any job status arrives', () => {
    expect(marketLoadingMessage(null, 'Nifty 50')).toBe('Loading Nifty 50 prices. The first load takes up to 4 minutes; later loads are instant.');
  });

  it('shows real counts when the server reports them', () => {
    expect(marketLoadingMessage({ status: 'running', stage: 'scan 23/50' }, 'Nifty 50')).toBe('Loading Nifty 50 prices · 23 of 50');
    expect(marketLoadingMessage({ status: 'running', stage: '23 of 50' }, 'Nifty 50')).toBe('Loading Nifty 50 prices · 23 of 50');
  });

  it('falls back to the honest first-load expectation without inventing progress', () => {
    const fallback = 'Loading Nifty 50 prices. The first load takes up to 4 minutes; later loads are instant.';
    for (const stage of ['market symbols', 'market', 'simulation', 'loading constituents', 'fetching quotes']) {
      expect(marketLoadingMessage({ status: 'running', stage }, 'Nifty 50')).toBe(fallback);
    }
    expect(marketLoadingMessage({ status: 'running' }, 'Nifty 50')).toBe(fallback);
  });
});
