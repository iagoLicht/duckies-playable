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
    // contact centre sits EXACTLY 2*DUCK_R short of the target — solved, not
    // sampled, so it does not drift with the march resolution
    expect(Math.hypot(500 - pv.points[1]!.x, 700 - pv.points[1]!.y))
      .toBeCloseTo(SIM.DUCK_R * 2, 6);
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
      .toBeCloseTo(SIM.DUCK_R * 2, 6);
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

  it('carom is null unless the shot reaches a duck', () => {
    const w = new World(1);
    const shooter = w.spawnDuck('red', 300, 700);
    w.spawnBarrel('wood', 450, 700, 2);
    for (const dir of [{ x: 1, y: 0 }, { x: 0, y: -1 }]) {
      const pv = predictShot(w, shooter, dir);
      expect(pv.carom).toBeNull();
      expect(pv.caromEnd).toBeNull();
    }
  });

  it('the carom leg runs on from the contact, not from nothing', () => {
    const dir = { x: 0.6, y: -0.8 };
    const w = new World(1);
    const shooter = w.spawnDuck('red', 300, 1000);
    w.spawnDuck('yellow', 300 + dir.x * 320 + 52, 1000 - 0.8 * 320 + 40);
    const pv = predictShot(w, shooter, dir);
    const contact = pv.points[pv.points.length - 1]!;

    // it leaves the contact point along carom, and goes somewhere worth drawing
    const run = Math.hypot(pv.caromEnd!.x - contact.x, pv.caromEnd!.y - contact.y);
    expect(run).toBeGreaterThan(SIM.DUCK_R);
    expect((pv.caromEnd!.x - contact.x) / run).toBeCloseTo(pv.carom!.x, 2);
    expect((pv.caromEnd!.y - contact.y) / run).toBeCloseTo(pv.carom!.y, 2);
    // and it does not leave the tub
    expect(pv.caromEnd!.x).toBeGreaterThan(0);
    expect(pv.caromEnd!.x).toBeLessThan(720);
  });

  it('the carom leg stops on the next body in its way', () => {
    const dir = { x: 0.6, y: -0.8 };
    const clear = new World(1);
    const cs = clear.spawnDuck('red', 300, 1000);
    clear.spawnDuck('yellow', 300 + dir.x * 320 + 52, 1000 - 0.8 * 320 + 40);
    const free = predictShot(clear, cs, dir);
    const contact = free.points[free.points.length - 1]!;
    const half = {
      x: contact.x + free.carom!.x * 200,
      y: contact.y + free.carom!.y * 200,
    };

    // same board, plus a blocker sitting on the carom line
    const w = new World(1);
    const shooter = w.spawnDuck('red', 300, 1000);
    w.spawnDuck('yellow', 300 + dir.x * 320 + 52, 1000 - 0.8 * 320 + 40);
    w.spawnBarrel('wood', half.x, half.y, 2);
    const pv = predictShot(w, shooter, dir);

    // the shot itself is unchanged — the blocker is past the contact
    expect(pv.hitKind).toBe('duck');
    expect(pv.carom!.x).toBeCloseTo(free.carom!.x, 6);
    const run = Math.hypot(pv.caromEnd!.x - contact.x, pv.caromEnd!.y - contact.y);
    const freeRun = Math.hypot(free.caromEnd!.x - contact.x, free.caromEnd!.y - contact.y);
    expect(run).toBeLessThan(freeRun);
    expect(run).toBeLessThanOrEqual(200);
  });

  it('a square hit stops the shooter dead: a stub, not a full lane', () => {
    const w = new World(1);
    const shooter = w.spawnDuck('red', 300, 700);
    w.spawnDuck('yellow', 500, 700);
    const pv = predictShot(w, shooter, { x: 1, y: 0 });
    const contact = pv.points[1]!;

    // sr = 0.96 leaves it 2% of its speed, and drag is linear, so ~2% of the run
    const run = Math.hypot(pv.caromEnd!.x - contact.x, pv.caromEnd!.y - contact.y);
    expect(run).toBeLessThan(SIM.DUCK_R);
  });

  it('head-on hit: the shooter carries straight on through', () => {
    const w = new World(1);
    const shooter = w.spawnDuck('red', 300, 700);
    w.spawnDuck('yellow', 500, 700);
    const pv = predictShot(w, shooter, { x: 1, y: 0 });

    // RESTITUTION_BODY < 1, so it keeps a sliver of the normal component
    expect(pv.carom!.x).toBeCloseTo(1, 6);
    expect(pv.carom!.y).toBeCloseTo(0, 6);
  });

  it('glancing hit: carom is a unit vector just inside 90 deg off the deflect', () => {
    const dir = { x: 0.6, y: -0.8 };
    const w = new World(1);
    const shooter = w.spawnDuck('red', 300, 900);
    // offset off the aim line: a dead-centre hit would make carom === deflect
    w.spawnDuck('yellow', 300 + dir.x * 300 + 50, 900 + dir.y * 300 + 38);
    const pv = predictShot(w, shooter, dir);

    expect(pv.hitKind).toBe('duck');
    expect(Math.hypot(pv.carom!.x, pv.carom!.y)).toBeCloseTo(1, 6);
    // the snooker tangent: perpendicular to the deflect at e=1, leaning a hair
    // forward at e=0.96 — never behind it
    const dot = pv.carom!.x * pv.deflect!.x + pv.carom!.y * pv.deflect!.y;
    expect(dot).toBeGreaterThan(0);
    expect(dot).toBeLessThan(0.1);
  });

  it('carom matches where the sim actually sends the shooter', () => {
    const dir = { x: 0.6, y: -0.8 };
    const w = new World(1);
    const shooter = w.spawnDuck('red', 300, 900);
    // offset off the aim line so the contact is properly glancing
    w.spawnDuck('yellow', 300 + dir.x * 300 + 40, 900 + dir.y * 300 - 30);
    const pv = predictShot(w, shooter, dir);
    expect(pv.hitKind).toBe('duck');

    w.launch(shooter.id, dir.x * SIM.LAUNCH_SPEED, dir.y * SIM.LAUNCH_SPEED);
    // step until the pair has separated — the first contact is the one predicted
    let actual: { x: number; y: number } | null = null;
    for (let i = 0; i < 60; i++) {
      w.step(1 / 60);
      const off = Math.abs(Math.atan2(shooter.vy, shooter.vx) - Math.atan2(dir.y, dir.x));
      if (off > 1e-6) {
        const s = Math.hypot(shooter.vx, shooter.vy);
        actual = { x: shooter.vx / s, y: shooter.vy / s };
        break;
      }
    }
    expect(actual).not.toBeNull();
    const cos = actual!.x * pv.carom!.x + actual!.y * pv.carom!.y;
    // the sweep samples at STEP px, so the predicted contact normal is a touch
    // off the real one — a few degrees, not a different answer
    expect(Math.acos(Math.min(1, cos))).toBeLessThan(0.09);
  });

  it('deflect turns smoothly as the aim sweeps — no stepping', () => {
    const w = new World(1);
    const shooter = w.spawnDuck('red', 300, 1000);
    w.spawnDuck('yellow', 460, 700);

    // creep the aim across the target in tiny increments and watch the arrow
    let prev: number | null = null;
    let worst = 0;
    let samples = 0;
    for (let a = -1.25; a <= -0.85; a += 0.001) {
      const pv = predictShot(w, shooter, { x: Math.cos(a), y: Math.sin(a) });
      if (pv.hitKind !== 'duck') { prev = null; continue; }
      const ang = Math.atan2(pv.deflect!.y, pv.deflect!.x);
      if (prev !== null) {
        let d = Math.abs(ang - prev);
        if (d > Math.PI) d = 2 * Math.PI - d;
        worst = Math.max(worst, d);
        samples++;
      }
      prev = ang;
    }

    expect(samples).toBeGreaterThan(100);
    // a 0.001 rad nudge of the aim must not swing the arrow by a degree. The
    // sampled contact used to step it by up to ~0.065 rad (3.7 deg) at a time.
    expect(worst).toBeLessThan(0.017);
  });

  it('the launch direction is reported back for the view to steer by', () => {
    const w = new World(1);
    const shooter = w.spawnDuck('red', 360, 900);
    // aimed into open water at a wall, where the path's last point is the
    // corrected wall centre and so does NOT lie on the ray
    const dir = { x: Math.SQRT1_2, y: -Math.SQRT1_2 };
    const pv = predictShot(w, shooter, dir);

    expect(pv.dir.x).toBeCloseTo(dir.x, 12);
    expect(pv.dir.y).toBeCloseTo(dir.y, 12);
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
