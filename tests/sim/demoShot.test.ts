import { describe, expect, it } from 'vitest';
import { Slingshot } from '../../src/sim/aim';
import { SIM } from '../../src/sim/config';
import { chooseDemoShot } from '../../src/sim/demoShot';
import { collideCircle } from '../../src/sim/shapes';
import { Director } from '../../src/sim/director';
import { AD_SCRIPT } from '../../src/game/flow';
import { World } from '../../src/sim/world';

/**
 * The idle demo's shot chooser. Its one hard promise: whatever it returns, the
 * gesture it describes FIRES. A demo that visibly whiffs in front of a viewer is
 * worse than no demo, and the aim assist makes "this angle points at a duck"
 * insufficient on its own — see chooseDemoShot.
 */
/** perform the returned gesture exactly as the view will, and report the launch */
const perform = (w: World, sling: Slingshot, shot: NonNullable<ReturnType<typeof chooseDemoShot>>):
  boolean => {
  expect(sling.begin(shot.duck.x, shot.duck.y)).toBe(true);
  sling.move(shot.pullTo.x, shot.pullTo.y);
  return sling.end();
};

describe('idle demo — choosing the shot', () => {
  it('returns a gesture that actually fires, on every ad board and seed', () => {
    for (const beat of AD_SCRIPT) {
      for (let seed = 1; seed <= 25; seed++) {
        const d = new Director(seed * 977, beat.level);
        d.start();
        const shot = chooseDemoShot(d.world, d.slingshot);
        expect(shot, `level ${beat.level} seed ${seed}`).not.toBeNull();
        d.world.events.length = 0;
        expect(perform(d.world, d.slingshot, shot!), `level ${beat.level} seed ${seed}`).toBe(true);
        expect(d.world.events.filter((e) => e.type === 'duckLaunched')).toHaveLength(1);
      }
    }
  });

  it('leaves the sling clean: probing candidates does not hold a grab', () => {
    const d = new Director(1, AD_SCRIPT[0]!.level);
    d.start();
    chooseDemoShot(d.world, d.slingshot);
    expect(d.slingshot.aiming).toBe(false);
    expect(d.slingshot.preview()).toBeNull();
  });

  it('the pull lands in the water, and is long enough to count as an aim', () => {
    // a hand hovering over the tub's moulding, or half off the screen, is not a
    // gesture the viewer can copy — and below MIN_PULL the sling would not even
    // aim, let alone fire
    for (const beat of AD_SCRIPT) {
      for (let seed = 1; seed <= 10; seed++) {
        const d = new Director(seed * 31, beat.level);
        d.start();
        const shot = chooseDemoShot(d.world, d.slingshot)!;
        const { x, y } = shot.pullTo;
        expect(collideCircle(x, y, 1), `level ${beat.level} seed ${seed}`).toBeNull();
        expect(Math.hypot(x - shot.duck.x, y - shot.duck.y)).toBeGreaterThan(SIM.MIN_PULL);
      }
    }
  });

  it('takes the biggest gesture among shots that are equally worth taking', () => {
    // A shot clipped short by a wall reads as a twitch. Quality still wins — the
    // tiebreak may never promote a worse shot — but two equal shots are not
    // equally good TEACHING, and the one with room for a full sweep is.
    const w = new World(1);
    // Three colours, no goals: every pair scores zero, so ONLY the pull can
    // decide. The shooter sits near the right wall, so firing at the duck to its
    // left means pulling right into the moulding — clipped to about 100 — while
    // firing at the duck below means pulling up into open water at the full 150.
    // The left-hand pair is offered FIRST, so a chooser that took the first of a
    // tie would settle for the clipped one.
    const shooter = w.spawnDuck('red', 540, 700);
    w.spawnDuck('green', 300, 700);
    w.spawnDuck('yellow', 540, 980);
    const sling = new Slingshot(w);
    sling.assist = 0;
    const shot = chooseDemoShot(w, sling)!;

    expect(shot.duck.id).toBe(shooter.id);
    expect(shot.pullTo.y).toBeLessThan(shooter.y); // pulled UP, so it fires down
    expect(Math.hypot(shot.pullTo.x - shooter.x, shot.pullTo.y - shooter.y))
      .toBeGreaterThan(140);
    expect(perform(w, sling, shot)).toBe(true);
  });

  it('the pull points AWAY from the target — the shot flies the other way', () => {
    const w = new World(1);
    const shooter = w.spawnDuck('red', 200, 640);
    const target = w.spawnDuck('yellow', 520, 640);
    const sling = new Slingshot(w);
    sling.assist = 0;
    const shot = chooseDemoShot(w, sling)!;
    expect(shot.duck.id).toBe(shooter.id);
    expect(shot.pullTo.x).toBeLessThan(shooter.x); // pulled back, target is right
    expect(perform(w, sling, shot)).toBe(true);
    expect(w.ducks.find((d) => d.id === shooter.id)!.vx).toBeGreaterThan(0);
    expect(target.vx).toBe(0); // nothing has moved yet — the shot is in flight
  });

  it('prefers a same-colour mate over a stranger at the same distance', () => {
    const w = new World(1);
    const shooter = w.spawnDuck('red', 360, 900);
    w.spawnDuck('green', 160, 900); // the stranger, to the left
    w.spawnDuck('red', 560, 900);   // the mate, the same distance to the right
    const sling = new Slingshot(w);
    sling.assist = 0;
    const shot = chooseDemoShot(w, sling)!;
    expect(shot.duck.id).toBe(shooter.id);
    // the pull is opposite the target, so a pull to the LEFT means it fires right
    expect(shot.pullTo.x).toBeLessThan(shooter.x);
  });

  it('prefers a line that carries into a goal over one that does not', () => {
    const w = new World(1);
    const shooter = w.spawnDuck('red', 360, 1000);
    w.spawnDuck('green', 360, 700);          // this one deflects into the crate
    w.spawnDuck('green', 160, 1000);         // this one deflects into open water
    w.spawnBarrel('wood', 360, 400, 1);
    const sling = new Slingshot(w);
    sling.assist = 0;
    const shot = chooseDemoShot(w, sling)!;
    expect(shot.duck.id).toBe(shooter.id);
    expect(shot.pullTo.y).toBeGreaterThan(shooter.y); // pulled DOWN, so it fires up
  });

  it('returns null when no shot can reach a duck', () => {
    const w = new World(1);
    w.spawnDuck('red', 360, 640); // one duck alone: nothing to aim at
    expect(chooseDemoShot(w, new Slingshot(w))).toBeNull();
  });

  it('returns null when the sling is blocked — the demo cannot outrank the budget', () => {
    const w = new World(1);
    w.spawnDuck('red', 200, 640);
    w.spawnDuck('yellow', 520, 640);
    const sling = new Slingshot(w);
    sling.blocked = true;
    expect(chooseDemoShot(w, sling)).toBeNull();
  });

  it('never grabs a duck that is live, popping or on a fuse', () => {
    const w = new World(1);
    const a = w.spawnDuck('red', 200, 640);
    const b = w.spawnDuck('red', 520, 640);
    a.matched = true; // blinking on its fuse — a player cannot grab it either
    b.live = true;    // still sliding
    expect(chooseDemoShot(w, new Slingshot(w))).toBeNull();
  });
});
