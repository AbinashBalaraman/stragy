/** Never mislabel modified implementation runs with the reviewed baseline revision. */
export function sourceCommit(env: Record<string, string | undefined> = process.env): string {
  const value = env.SOURCE_COMMIT ?? env.RENDER_GIT_COMMIT;
  return value && /^[a-f0-9]{40}$/i.test(value) ? value.toLowerCase() : 'unknown-working-tree';
}
