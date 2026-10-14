export function formatNumber(value: number | null | undefined, digits = 2, suffix = ''): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) + suffix : 'N/A';
}
export function formatCurrency(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? '₹' + value.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : 'N/A';
}
