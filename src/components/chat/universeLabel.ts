/**
 * Universe ids are display strings, not words: lowercasing them turns NIFTY IT
 * into "Nifty it". Keep one explicit map for the supported universes and fall
 * back to the old sentence case only for an id the map does not know.
 */
const UNIVERSE_LABELS: Record<string, string> = {
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

export function universeLabel(universe: string): string {
  const known = UNIVERSE_LABELS[universe];
  if (known) return known;
  return universe.replace(/_/g, ' ').toLowerCase().replace(/^./, character => character.toUpperCase());
}
