/**
 * Screen titles are assembled from rule fragments ("near 52-week low · RSI
 * above its average"), so the displayed heading lifts only its first letter.
 * The stored strategy name never changes, and words like RSI, EMA or 52-week
 * keep their own casing.
 */
export function displayCardTitle(title: string): string {
  if (!title) return title;
  const first = title.charAt(0);
  if (!/\p{Ll}/u.test(first)) return title;
  return first.toUpperCase() + title.slice(1);
}
