import { describe, expect, it } from 'vitest';
import { SIM } from '../../src/sim/config';
import { predictShot } from '../../src/sim/trajectory';
import { World } from '../../src/sim/world';

describe('predictShot', () => {
  it('direct duck hit: stops at contact, deflects along the line of centres', () => {
    const w = new World(1);
    const shooter = w.spawnDuck('red', 300, 700);
    const target = w.spawnDuck('yellow', 500, 700);
    const pv = predictShot(w, shooter, { x: 1, y: 0 });

    expect(pv.hitKind).toBe('duck');
    expect(pv.hitId).toBe(target.id);
    expect(pv.points).toHaveLength(2);
    expect(pv.points[0]).toEqual({ x: 300, y: 700 });
    // contact centre sits ~2*DUCK_R short of the target
    expect(Math.hypot(500 - pv.points[1]!.x, 700 - pv.points[1]!.y))
      .toBeLessThanOrEqual(SIM.DUCK_R * 2);
    expect(pv.deflect!.x).toBeCloseTo(1, 6);
    expect(pv.deflect!.y).toBeCloseTo(0, 6);
  });

  it('the nearer body wins: a barrel in front of a duck is the hit', () => {
    const w = new World(1);
    const shooter = w.spawnDuck('red', 300, 700);
    const barrel = w.spawnBarrel('wood', 450, 700, 2);
    w.spawnDuck('yellow', 600, 700);
    const pv = predictShot(w, shooter, { x: 1, y: 0 });

    expect(pv.hitKind).toBe('barrel');
    expect(pv.hitId).toBe(barrel.id);
    expect(pv.deflect).toBeNull();
    expect(pv.points).toHaveLength(2);
  });

  it('miss: no body, one wall bounce, path stays inside the tub', () => {
    const w = new World(1);
    const shooter = w.spawnDuck('red', 360, 900);
    const pv = predictShot(w, shooter, { x: 0, y: -1 });

    expect(pv.hitId).toBeNull();
    expect(pv.hitKind).toBeNull();
    expect(pv.deflect).toBeNull();
    expect(pv.points).toHaveLength(3); // straight up -> top wall -> back down
    for (const p of pv.points) {
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(720);
      expect(p.y).toBeGreaterThan(200);
      expect(p.y).toBeLessThan(1280);
    }
    // bounced off the top wall and came back down
    expect(pv.points[1]!.y).toBeLessThan(shooter.y);
    expect(pv.points[2]!.y).toBeGreaterThan(pv.points[1]!.y);
  });

  it('one bounce can hit: a duck on the reflected leg is struck', () => {
    const dir = { x: -Math.SQRT1_2, y: -Math.SQRT1_2 };
    // probe the empty bounce first so the receiver sits exactly on leg 2
    const probe = new World(1);
    const ps = probe.spawnDuck('red', 300, 700);
    const path = predictShot(probe, ps, dir);
    expect(path.points).toHaveLength(3);
    const mid = {
      x: (path.points[1]!.x + path.points[2]!.x) / 2,
      y: (path.points[1]!.y + path.points[2]!.y) / 2,
    };

    const w = new World(1);
    const shooter = w.spawnDuck('red', 300, 700);
    const target = w.spawnDuck('green', mid.x, mid.y);
    const pv = predictShot(w, shooter, dir);

    expect(pv.points).toHaveLength(3);
    expect(pv.hitKind).toBe('duck');
    expect(pv.hitId).toBe(target.id);
    // struck on the second leg, past the wall contact
    expect(Math.hypot(pv.points[2]!.x - mid.x, pv.points[2]!.y - mid.y))
      .toBeLessThanOrEqual(SIM.DUCK_R * 2);
  });

  it('popping ducks are transparent to the sweep', () => {
    const w = new World(1);
    const shooter = w.spawnDuck('red', 300, 700);
    const ghost = w.spawnDuck('yellow', 500, 700);
    ghost.popping = true;
    const pv = predictShot(w, shooter, { x: 1, y: 0 });

    expect(pv.hitId).toBeNull();
    expect(pv.hitKind).toBeNull();
  });

  it('deflect is a unit vector', () => {
    const w = new World(1);
    const shooter = w.spawnDuck('red', 300, 900);
    w.spawnDuck('yellow', 460, 620);
    const dir = { x: 160, y: -280 };
    const len = Math.hypot(dir.x, dir.y);
    const pv = predictShot(w, shooter, { x: dir.x / len, y: dir.y / len });

    expect(pv.hitKind).toBe('duck');
    expect(Math.hypot(pv.deflect!.x, pv.deflect!.y)).toBeCloseTo(1, 6);
  });

  it('never hits itself, in any direction', () => {
    const w = new World(1);
    const shooter = w.spawnDuck('red', 360, 760);
    const dirs = [
      { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
      { x: Math.SQRT1_2, y: Math.SQRT1_2 }, { x: -Math.SQRT1_2, y: Math.SQRT1_2 },
    ];
    for (const d of dirs) {
      const pv = predictShot(w, shooter, d);
      expect(pv.hitId).toBeNull();
      expect(pv.points[0]).toEqual({ x: 360, y: 760 });
    }
  });

  it('a duck resting against a wall can still aim away from it', () => {
    const w = new World(1);
    // flush against the left wall (inner face x=46, so centre x=92)
    const shooter = w.spawnDuck('red', 92, 700);
    const target = w.spawnDuck('yellow', 400, 700);
    const pv = predictShot(w, shooter, { x: 1, y: 0 });

    expect(pv.points).toHaveLength(2); // no spurious bounce off the wall behind
    expect(pv.hitId).toBe(target.id);
  });
});
