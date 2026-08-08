import { describe, expect, it } from 'vitest';
import { Slingshot } from '../../src/sim/aim';
import { SIM } from '../../src/sim/config';
import { World } from '../../src/sim/world';

describe('Slingshot', () => {
  it('grabs the nearest duck within GRAB_R, ignores far taps', () => {
    const w = new World(1);
    w.spawnDuck('red', 300, 700);
    const s = new Slingshot(w);
    expect(s.begin(310, 710)).toBe(true);
    s.cancel();
    expect(s.begin(600, 300)).toBe(false);
  });

  it('ignores a duck that is already on its match fuse', () => {
    const w = new World(1);
    const a = w.spawnDuck('red', 300, 700);
    w.spawnDuck('red', 393, 700);
    const s = new Slingshot(w);
    expect(s.begin(300, 700)).toBe(true); // grabbable before the match
    s.cancel();
    w.launch(a.id, 900, 0);
    for (let i = 0; i < 20; i++) w.step(SIM.DT); // collide -> both fuses lit
    expect(a.matched).toBe(true);
    expect(s.begin(a.x, a.y)).toBe(false);
  });

  it('tiny pull is a whiff: no launch, duck stays put', () => {
    const w = new World(1);
    const d = w.spawnDuck('red', 300, 700);
    const s = new Slingshot(w);
    s.begin(300, 700);
    s.move(310, 700); // pull 10 < MIN_PULL
    expect(s.end()).toBe(false);
    expect(d.live).toBe(false);
  });

  it('facing() is live below MIN_PULL, where there is still no shot', () => {
    const w = new World(1);
    w.spawnDuck('red', 300, 700);
    const s = new Slingshot(w);
    s.assist = 0;
    s.begin(300, 700);

    expect(s.facing()).toBeNull(); // nothing dragged yet, no direction to give
    s.move(290, 700); // pull 10, well under MIN_PULL 40
    expect(s.preview()).toBeNull(); // no shot to project…
    const f = s.facing();           // …but the view still gets something to aim along
    expect(f!.x).toBeCloseTo(1, 6);
    expect(f!.y).toBeCloseTo(0, 6);
    expect(s.end()).toBe(false);    // and it is still a whiff
  });

  it('facing() is the same direction the shot is projected along', () => {
    const w = new World(1);
    w.spawnDuck('red', 300, 700);
    w.spawnDuck('yellow', 520, 610); // in the cone, so assist actually bends
    const s = new Slingshot(w);
    s.assist = 0.6;
    s.begin(300, 700);
    s.move(300 - 120, 700 + 40);

    const f = s.facing()!;
    const pv = s.preview()!;
    expect(f.x).toBeCloseTo(pv.dir.x, 12);
    expect(f.y).toBeCloseTo(pv.dir.y, 12);
  });

  it('off-centre tap with no drag is a whiff (pull anchors at the pointer)', () => {
    const w = new World(1);
    const d = w.spawnDuck('red', 300, 700);
    const s = new Slingshot(w);
    expect(s.begin(340, 700)).toBe(true); // 40px off-centre, inside GRAB_R
    expect(s.end()).toBe(false); // released without moving
    expect(d.live).toBe(false);
    expect(d.x).toBe(300);
    expect(d.y).toBe(700);
  });

  it('pull back fires the duck in the opposite direction', () => {
    const w = new World(1);
    const d = w.spawnDuck('red', 300, 700);
    w.spawnDuck('green', 300, 300); // straight up the lane — makes the aim valid
    const s = new Slingshot(w);
    s.begin(300, 700);
    s.move(300, 850); // pulled straight down 150
    expect(s.end()).toBe(true);
    expect(d.live).toBe(true);
    expect(d.vy).toBeLessThan(0); // fires up
    expect(Math.abs(d.vx)).toBeLessThan(1);
    expect(Math.hypot(d.vx, d.vy)).toBeCloseTo(SIM.LAUNCH_SPEED, 0);
  });

  it('launch speed is fixed regardless of pull length', () => {
    const short = new World(1);
    const ds = short.spawnDuck('red', 300, 700);
    short.spawnDuck('green', 300, 300);
    const ss = new Slingshot(short);
    ss.begin(300, 700);
    ss.move(300, 760); // 60px pull
    expect(ss.end()).toBe(true);

    const long = new World(1);
    const dl = long.spawnDuck('red', 300, 700);
    long.spawnDuck('green', 300, 300);
    const sl = new Slingshot(long);
    sl.begin(300, 700);
    sl.move(300, 1200); // 500px pull
    expect(sl.end()).toBe(true);

    const speedShort = Math.hypot(ds.vx, ds.vy);
    const speedLong = Math.hypot(dl.vx, dl.vy);
    expect(speedShort).toBeCloseTo(SIM.LAUNCH_SPEED, 0);
    expect(speedLong).toBeCloseTo(SIM.LAUNCH_SPEED, 0);
    expect(speedShort).toBeCloseTo(speedLong, 6);
  });

  it('aim assist bends the shot toward a same-colour duck inside the cone', () => {
    const w = new World(1);
    const d = w.spawnDuck('red', 360, 900);
    w.spawnDuck('red', 460, 300); // up and to the right, ~9.5 deg off vertical
    const s = new Slingshot(w);
    s.assist = 1.0;
    s.begin(360, 900);
    s.move(360, 1050); // aim straight up
    s.end();
    expect(d.vx).toBeGreaterThan(50); // fully bent toward the target
  });

  it('assist 0 leaves the aim unchanged', () => {
    const w = new World(1);
    const d = w.spawnDuck('red', 360, 900);
    // inside the straight-up sweep corridor, so the unassisted shot is valid
    w.spawnDuck('red', 430, 300);
    const s = new Slingshot(w);
    s.assist = 0;
    s.begin(360, 900);
    s.move(360, 1050);
    expect(s.end()).toBe(true);
    expect(d.live).toBe(true);
    expect(Math.abs(d.vx)).toBeLessThan(1);
  });

  it('refuses to release into empty space — the aim must reach a duck', () => {
    const w = new World(1);
    const d = w.spawnDuck('red', 300, 700); // alone in the tub
    const s = new Slingshot(w);
    s.begin(300, 700);
    s.move(300, 850); // real pull, aims up at nothing
    expect(s.preview()?.hitKind ?? null).not.toBe('duck'); // the UI shows the X
    expect(s.end()).toBe(false);
    expect(d.live).toBe(false);
    expect(d.x).toBe(300);
    expect(d.y).toBe(700);
  });

  it('refuses a shot whose lane a barrel blocks before the duck', () => {
    const w = new World(1);
    const d = w.spawnDuck('red', 300, 900);
    w.spawnDuck('green', 300, 400); // the intended target…
    w.spawnBarrel('wood', 300, 700, 3); // …with a barrel square in the lane
    const s = new Slingshot(w);
    s.assist = 0;
    s.begin(300, 900);
    s.move(300, 1050); // aim straight up
    expect(s.preview()?.hitKind).toBe('barrel'); // X at the barrel face
    expect(s.end()).toBe(false);
    expect(d.live).toBe(false);
  });
});
