import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../src/sim/rng';

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(1234);
    const b = mulberry32(1234);
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  it('produces values in [0, 1) with different seeds diverging', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    for (let i = 0; i < 100; i++) {
      const v = a();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(a()).not.toEqual(b());
  });
});
