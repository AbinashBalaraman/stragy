import { describe, expect, it } from 'vitest';
import { sourceCommit } from '../../server/buildInfo';
describe('implementation revision provenance', () => {
  it('uses the verified CI or Render commit, not the original reviewed baseline', () => {
    const sha = 'abcdef0123'.repeat(4);
    expect(sha).toHaveLength(40);
    expect(sourceCommit({ SOURCE_COMMIT: sha.toUpperCase() })).toBe(sha);
    expect(sourceCommit({ RENDER_GIT_COMMIT: sha })).toBe(sha);
  });
  it('does not invent a revision or expose arbitrary environment values', () => {
    expect(sourceCommit({})).toBe('unknown-working-tree');
    expect(sourceCommit({ SOURCE_COMMIT: 'invalid-sensitive-value' })).toBe('unknown-working-tree');
  });
});
