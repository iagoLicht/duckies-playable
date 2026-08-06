import { SIM } from '../../src/sim/config';
import { Director } from '../../src/sim/director';
import { mulberry32 } from '../../src/sim/rng';

/**
 * The shared "distracted thumb" bot. Deliberately mediocre: every ~2s it grabs a
 * random resting duck and slings it at another duck — favouring a same-colour
 * mate and targets whose deflection line carries into a goal — with +/-10 degrees
 * of aim noise. A shot only fires when the guide locks a DUCK, so the bot hunts
 * the aim outward in +/-3 degree steps until `preview().hitKind === 'duck'`,
 * exactly as a player nudging past the red X does. That hunt is what produces the
 * bank shots, so do not "simplify" it away.
 *
 * Used by two callers that must agree: tests/sim/playthrough.test.ts (the
 * per-level solvability gate) and tests/tools/tune-levels.mjs (the budget
 * tuning harness). Keep it here, not duplicated.
 */
export interface BotStats {
  levelIndex: number;
  seed: number;
  won: boolean;
  /** real launches spent — a refused aim is free and never counted */
  shots: number;
  seconds: number;
  blasts: number;
  clamsOpened: number;
  finaleArmed: boolean;
  /** goals the level asked for (barrels + clams) */
  goals: number;
  /** the level's shipped move budget, for comparison; not enforced when unlimited */
  budget: number;
  /** why the run stopped — 'won' | 'failed' | 'timeout' | 'shotCap' */
  end: 'won' | 'failed' | 'timeout' | 'shotCap';
}

export interface BotOpts {
  /**
   * Ignore the level's shot budget (default true). The gate we care about is
   * "is this board SOLVABLE", not "is the shipped budget winnable" — the budget
   * is what tests/tools/tune-levels.mjs exists to choose.
   */
  unlimitedMoves?: boolean;
  /**
   * Ignore the board's 30 s countdown (default true) — `Director.untimed`. Same
   * argument as `unlimitedMoves`: the bot fires roughly every 2 s, so thirty
   * seconds is about thirteen shots, and both callers here routinely need more
   * than that. Leaving the clock running would turn the solvability gate and the
   * budget tuner into measurements of the BOT's pace instead of the board's.
   */
  unlimitedTime?: boolean;
  /** sim-seconds before the run is abandoned */
  maxSeconds?: number;
  /** launches before the run is abandoned */
  maxShots?: number;
}

const HUGE_BUDGET = 1e9;

export function playLevel(levelIndex: number, seed: number, opts: BotOpts = {}): BotStats {
  const unlimitedMoves = opts.unlimitedMoves ?? true;
  const unlimitedTime = opts.unlimitedTime ?? true;
  const maxSeconds = opts.maxSeconds ?? 150;
  const maxShots = opts.maxShots ?? 120;

  const rng = mulberry32(seed * 7919 + 1);
  const dir = new Director(seed, levelIndex);
  dir.untimed = unlimitedTime;
  dir.start();
  const goals = dir.level.barrels.length + dir.level.clams.length;
  const budget = dir.level.moves;

  let nextShotAt = 1.2;
  let shots = 0;
  let blasts = 0;
  let clamsOpened = 0;
  let finaleArmed = false;

  while (!dir.won && !dir.failed && dir.world.time < maxSeconds && shots < maxShots) {
    if (unlimitedMoves) dir.movesLeft = HUGE_BUDGET;
    dir.step(SIM.DT);
    for (const e of dir.drained.splice(0, dir.drained.length)) {
      if (e.type === 'blast') blasts++;
      else if (e.type === 'clamOpened') clamsOpened++;
      else if (e.type === 'duckLaunched') shots++;
      else if (e.type === 'finaleArmed') finaleArmed = true;
    }
    if (dir.world.time < nextShotAt) continue;
    nextShotAt = dir.world.time + 1.6 + rng() * 0.9;

    // matched ducks wear no ring and refuse a grab — a player wouldn't tap one
    const resting = dir.world.ducks.filter((d) => !d.live && !d.popping && !d.matched);
    if (resting.length === 0) continue;
    const duck = resting[Math.floor(rng() * resting.length)]!;

    // pick a target DUCK (barrel/clam aims are refused). Play the game the way
    // the white deflection arrow teaches: a dead-on hit sends the STRUCK duck
    // onward along the line of centres, so favour targets whose deflection line
    // carries into a surviving goal — a barrel to smash or a shut clam to crack
    // — and same-colour mates for the match. A dash of preference noise keeps it
    // a thumb, not a snooker engine.
    const others = dir.world.ducks.filter((d) => d.id !== duck.id && !d.popping);
    if (others.length === 0) continue;
    const caromsIntoGoal = (t: { x: number; y: number }): boolean => {
      const ux = t.x - duck.x, uy = t.y - duck.y;
      const len = Math.hypot(ux, uy) || 1;
      const dx = ux / len, dy = uy / len;
      const reaches = (gx: number, gy: number, r: number): boolean => {
        const bx = gx - t.x, by = gy - t.y;
        const along = bx * dx + by * dy;
        if (along <= 0 || along > 700) return false;
        return Math.abs(bx * dy - by * dx) < r + SIM.DUCK_R * 0.6;
      };
      return dir.world.barrels.some((b) => reaches(b.x, b.y, SIM.BARREL_R))
        || dir.world.clams.some((c) => !c.open && reaches(c.x, c.y, SIM.CLAM_R));
    };
    const scored = others.map((t) => ({
      t,
      s: (caromsIntoGoal(t) ? 3 : 0) + (t.colour === duck.colour ? 2 : 0) + rng() * 1.5,
    }));
    scored.sort((a, b) => b.s - a.s);
    const best = scored[0]!.t;

    let ang = Math.atan2(best.y - duck.y, best.x - duck.x);
    ang += ((rng() - 0.5) * 20 * Math.PI) / 180; // +/-10 deg noise
    const pull = 140 + rng() * 60;
    if (dir.slingshot.begin(duck.x, duck.y)) {
      const aimAt = (a: number): void =>
        dir.slingshot.move(duck.x - Math.cos(a) * pull, duck.y - Math.sin(a) * pull);
      aimAt(ang);
      // like a player: the release is refused while the X shows, so swing the
      // aim outward from the intended angle until the guide locks a duck —
      // all the way around if needed (that's how the bank shots happen)
      if (dir.slingshot.preview()?.hitKind !== 'duck') {
        for (let s = 1; s <= 60; s++) {
          const off = (s * 3 * Math.PI) / 180;
          aimAt(ang + off);
          if (dir.slingshot.preview()?.hitKind === 'duck') break;
          aimAt(ang - off);
          if (dir.slingshot.preview()?.hitKind === 'duck') break;
        }
      }
      dir.slingshot.end();
    }
  }

  const end: BotStats['end'] = dir.won ? 'won'
    : dir.failed ? 'failed'
    : shots >= maxShots ? 'shotCap'
    : 'timeout';

  return {
    levelIndex, seed, won: dir.won, shots, seconds: dir.world.time,
    blasts, clamsOpened, finaleArmed, goals, budget, end,
  };
}

/** p-th percentile (0..1) of a numeric sample, nearest-rank. */
export function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[i]!;
}
