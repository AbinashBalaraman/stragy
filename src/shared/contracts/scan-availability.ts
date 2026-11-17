/**
 * Membership is verified for the Nifty 50 only. The research chat used to
 * offer sector indices and all-NSE screens, then the scanner refused them at
 * run time. These helpers keep the promise and the failure message identical.
 */
export const VERIFIED_SCREEN_UNIVERSE = 'NIFTY_50' as const;

const UNIVERSE_LABELS: Record<string, string> = {
  NIFTY_50: 'Nifty 50',
  BANK_NIFTY: 'Bank NIFTY',
  NIFTY_IT: 'NIFTY IT',
  NIFTY_AUTO: 'NIFTY Auto',
  NIFTY_PHARMA: 'NIFTY Pharma',
  NIFTY_METAL: 'NIFTY Metal',
  NIFTY_FMCG: 'NIFTY FMCG',
  NSE: 'all NSE stocks',
  ALL: 'all markets',
  BSE: 'BSE stocks',
  BSE_SENSEX: 'BSE Sensex',
  POPULAR_INDICES: 'popular indices',
};

export function universeLabel(universe: string | undefined): string {
  return (universe && UNIVERSE_LABELS[universe]) || 'that universe';
}

export function verifiedScreenMessage(label: string): string {
  return `I can only screen the Nifty 50 with verified membership. Use the Market scanner for ${label}.`;
}

/**
 * Job errors are rendered to users verbatim, so internal membership text must
 * never escape. Returns null for unrelated failures, which keep their own
 * honest message.
 */
export function plainScanFailure(
  code: string | undefined,
  message: string | undefined,
  universe: string | undefined,
): string | null {
  if (
    code === 'MEMBERSHIP_UNAVAILABLE'
    || /verified current membership|constituent list|bundled index pools/i.test(message ?? '')
  ) {
    return verifiedScreenMessage(universeLabel(universe));
  }
  return null;
}
