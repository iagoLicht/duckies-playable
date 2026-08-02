import { describe, expect, it } from 'vitest';
import { collideCircle, COLLIDERS } from '../../src/sim/shapes';

describe('tub boundary collision', () => {
  it('does nothing for a circle well inside', () => {
    expect(collideCircle(360, 700, 46)).toBeNull();
  });

  it('pushes a circle back inside through the left wall', () => {
    const hit = collideCircle(30, 700, 46);
    expect(hit).not.toBeNull();
    expect(hit!.x).toBeGreaterThan(30);
    expect(hit!.nx).toBeGreaterThan(0.9); // normal points inward (+x)
  });

  it('pushes back at the bottom edge', () => {
    const hit = collideCircle(360, 1265, 46);
    expect(hit).not.toBeNull();
    expect(hit!.y).toBeLessThan(1265);
    expect(hit!.ny).toBeLessThan(-0.9);
  });

  it('collides with the top-right shoulder region', () => {
    const hit = collideCircle(660, 230, 46);
    expect(hit).not.toBeNull();
  });

  it('collides with the left bumper triangle', () => {
    const hit = collideCircle(120, 950, 46);
    expect(hit).not.toBeNull();
    expect(hit!.nx).toBeGreaterThan(0.3); // deflects rightward off the tip slope
  });

  it('registers bumper hits with source=bumper', () => {
    const hit = collideCircle(120, 950, 46);
    expect(hit!.source).toBe('bumper');
  });

  it('boundary hits report source=wall', () => {
    expect(collideCircle(30, 700, 46)!.source).toBe('wall');
  });
});
