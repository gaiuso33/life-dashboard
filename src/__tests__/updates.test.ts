import { describe, expect, it } from 'vitest';
import { MIN_GAP_MS, POLL_MS, shouldCheck } from '../updates';

describe('when to look for a new version', () => {
  it('looks straight away the first time', () => {
    expect(shouldCheck(1_000_000, 0)).toBe(true);
  });
  it('does not ask the server again within a minute of the last look', () => {
    expect(shouldCheck(1_000_000 + MIN_GAP_MS - 1, 1_000_000)).toBe(false);
    expect(shouldCheck(1_000_000 + MIN_GAP_MS, 1_000_000)).toBe(true);
  });
  it('honours a custom gap', () => {
    expect(shouldCheck(10_000, 0, 5_000)).toBe(true);
    expect(shouldCheck(4_999, 0, 5_000)).toBe(false);
  });
  it('lets an app left open look more often than the minimum gap', () => {
    expect(POLL_MS).toBeGreaterThan(MIN_GAP_MS);
  });
});
