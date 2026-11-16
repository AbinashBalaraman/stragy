import {
  DEFAULT_USER_PREFERENCES, UserPreferencesSchema, type UserPreferences,
} from '../shared/contracts/featureRegistry';

/**
 * Workspace preference memory: the last symbol, universe, date range, cost
 * preset and risk. It contains no personal data, stays in this browser, and is
 * validated on every read so a corrupted value can never leak into a setup.
 */
export const PREFERENCES_STORAGE_KEY = 'stragy_user_preferences_v1';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export interface PreferencePatch {
  symbolId?: number;
  ticker?: string;
  universe?: UserPreferences['universe'];
  dateRange?: UserPreferences['dateRange'];
  customStart?: string;
  customEnd?: string;
  costPreset?: UserPreferences['costPreset'];
  riskPercent?: number;
}

export function readPreferences(storage: StorageLike | undefined = typeof localStorage === 'undefined' ? undefined : localStorage): UserPreferences {
  if (!storage) return DEFAULT_USER_PREFERENCES;
  try {
    const raw = storage.getItem(PREFERENCES_STORAGE_KEY);
    if (!raw) return DEFAULT_USER_PREFERENCES;
    const parsed = UserPreferencesSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_USER_PREFERENCES;
  } catch {
    return DEFAULT_USER_PREFERENCES;
  }
}

export function writePreferences(preferences: UserPreferences, storage: StorageLike | undefined = typeof localStorage === 'undefined' ? undefined : localStorage): boolean {
  if (!storage) return false;
  const checked = UserPreferencesSchema.safeParse({ ...preferences, updatedAt: new Date().toISOString() });
  if (!checked.success) return false;
  try {
    storage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(checked.data));
    return true;
  } catch {
    return false;
  }
}

export function mergePreferences(preferences: UserPreferences, patch: PreferencePatch): UserPreferences {
  const next: UserPreferences = { ...preferences };
  if (patch.symbolId !== undefined) next.lastSymbolId = patch.symbolId;
  if (patch.ticker !== undefined) next.lastTicker = patch.ticker;
  if (patch.universe !== undefined) next.universe = patch.universe;
  if (patch.dateRange !== undefined) next.dateRange = patch.dateRange;
  if (patch.customStart !== undefined) next.customStart = patch.customStart;
  if (patch.customEnd !== undefined) next.customEnd = patch.customEnd;
  if (patch.costPreset !== undefined) next.costPreset = patch.costPreset;
  if (patch.riskPercent !== undefined) next.riskPercent = patch.riskPercent;
  return UserPreferencesSchema.parse(next);
}

/** Update and persist one remembered choice; returns the stored value. */
export function rememberPreference(patch: PreferencePatch, storage?: StorageLike): UserPreferences {
  const next = mergePreferences(readPreferences(storage), patch);
  writePreferences(next, storage);
  return next;
}
