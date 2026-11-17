import { describe, expect, it } from 'vitest';
import { universeLabel } from '../../components/chat/universeLabel';

describe('universeLabel', () => {
  it('keeps the acronyms of every supported universe', () => {
    const labels: Record<string, string> = {
      NIFTY_50: 'Nifty 50',
      BANK_NIFTY: 'Bank NIFTY',
      NIFTY_IT: 'NIFTY IT',
      NIFTY_AUTO: 'NIFTY Auto',
      NIFTY_PHARMA: 'NIFTY Pharma',
      NIFTY_METAL: 'NIFTY Metal',
      NIFTY_FMCG: 'NIFTY FMCG',
      BSE_SENSEX_30: 'BSE SENSEX 30',
      NSE: 'NSE',
      BSE: 'BSE',
      ALL: 'All (NSE+BSE)',
    };
    for (const [id, label] of Object.entries(labels)) expect(universeLabel(id), id).toBe(label);
  });

  it('falls back to sentence case for an unknown id', () => {
    expect(universeLabel('MIDCAP_150')).toBe('Midcap 150');
  });
});
