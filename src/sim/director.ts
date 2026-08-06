import { Slingshot } from './aim';
import { SIM } from './config';
import { LEVELS, type LevelDef } from './levels';
import { predictShot } from './trajectory';
import type { Colour, SimEvent } from './types';
import { World } from './world';

/**
 * Runs one level of the campaign: builds the board, counts the shot budget down,
 * tops the duck supply back up, and decides cleared vs failed.
 *
 * Cleared = every barrel destroyed and the level's pearl quota collected.
 * Failed  = the budget is spent, goals remain, and the board has come to rest
 *           (so a shot still in flight always gets to finish its chain first).
 *
 * Clams are dispensers, not goals: the goal is the PEARL COUNT, and one clam
 * services it as many times as the level asks. The HUD therefore carries two
 * counters — crates destroyed, and pearls remaining — and a pearl is only
 * counted when it reaches the HUD (`pearlCollected`), never when it is spilled.
 */
/** settled ticks before the board is examined for having no legal shot at all */
const DEAD_BOARD_GRACE = 30;

export class Director {
  readonly world: World;
  readonly slingshot: Slingshot;
  /** events already drained from world.events by step() — kept for the view */
  drained: SimEvent[] = [];
  readonly levelIndex: number;
  readonly level: LevelDef;
  won = false;
  failed = false;
  finaleArmed = false;
  movesLeft: number;
  /**
   * TEST AFFORDANCE, NOT A GAMEPLAY ONE. Freezes the countdown where it stands.
   * Nothing in src/ sets it and the view has no path to it — it exists so a
   * harness can ask a question the clock would otherwise answer on its behalf:
   * playthrough.test.ts gates board SOLVABILITY ("can this be cleared at all?")
   * and tune-levels.mjs measures shot-count percentiles, and neither is asking
   * "does the distracted-thumb bot beat thirty seconds". It is the twin of
   * bot.ts's existing `unlimitedMoves`, which suspends the other limit for
   * exactly that reason. Raising SIM.LEVEL_TICKS to make those suites green was
   * the rejected alternative: it would tune the ad's pacing to suit the bot.
   */
  untimed = false;
  private destroyed = 0;
  /** pearls that have REACHED the HUD — spilled-but-still-flying ones don't count */
  private pearlsCollected = 0;
  private respawnAt: number | null = null;
  /** consecutive settled ticks — the dead-board check only runs after a pause */
  private deadBoardTicks = 0;
  /** shots already fired whose move has not been debited yet (same-frame guard) */
  private pendingLaunches = 0;
  /** fixed steps left on the board's countdown — see SIM.LEVEL_TICKS */
  private ticksLeft = SIM.LEVEL_TICKS;
  /** the last whole second published, so `timeLeft` only fires on a change */
  private lastSeconds = -1;

  constructor(seed: number, levelIndex = 0) {
    this.levelIndex = levelIndex;
    const def = LEVELS[levelIndex];
    if (!def) throw new Error(`no level at index ${levelIndex}`);
    this.level = def;
    this.movesLeft = def.moves;
    this.world = new World(seed);
    this.slingshot = new Slingshot(this.world);
    this.slingshot.assist = def.assist;
    // The launch EVENT stays the authority on spending a move, so any launch
    // is charged. But the debit only lands when the next step drains it, and a
    // second gesture arriving in the same frame would read the old budget and
    // fire for free — so a shot in flight is counted against the budget the
    // instant it leaves, which is what bars the slingshot.
    this.slingshot.onLaunch = (): void => {
      this.pendingLaunches++;
      this.syncBlocked();
    };
  }

  /** the budget is spent when everything already fired has been paid for */
  private syncBlocked(): void {
    this.slingshot.blocked =
      this.movesLeft - this.pendingLaunches <= 0 ||
      this.ticksLeft <= 0 ||
      this.won ||
      this.failed;
  }

  /** crates destroyed — the barrel-icon counter */
  get counter(): { done: number; total: number } {
    return { done: this.destroyed, total: this.level.barrels.length };
  }

  /** pearls REMAINING out of the level's quota — the pearl-icon counter */
  get pearlCounter(): { left: number; total: number } {
    return {
      left: Math.max(0, this.level.pearls - this.pearlsCollected),
      total: this.level.pearls,
    };
  }

  /** seconds left, rounded UP — the clock reads 00 only once time is truly gone */
  get secondsLeft(): number {
    return Math.ceil(this.ticksLeft * SIM.DT);
  }

  /** every outstanding goal, of either kind — what the finale flourish counts */
  get goalsRemaining(): number {
    return this.world.barrels.length + this.pearlCounter.left;
  }

  start(): void {
    this.syncBlocked();
    for (const d of this.level.ducks) this.world.spawnDuck(d.colour, d.x, d.y);
    for (const b of this.level.barrels) {
      this.world.spawnBarrel('wood', b.x, b.y, b.hp, b.golden ?? false);
    }
    for (const c of this.level.clams) this.world.spawnClam(c.x, c.y, c.skin ?? 'normal');
    // one consistent stream: the setup spawns land in `drained` alongside the
    // level header instead of leaking into the first step()
    this.drained.push(...this.world.events.splice(0, this.world.events.length));
    this.pushLocal({
      type: 'levelStarted', index: this.levelIndex, name: this.level.name, moves: this.movesLeft,
    });
    this.pushCounter();
    this.pushPearlCounter();
    this.pushLocal({ type: 'movesLeft', left: this.movesLeft });
    this.pushTimeLeft();
  }

  step(dt: number): void {
    this.world.step(dt);

    const evs = this.world.events.splice(0, this.world.events.length);
    this.drained.push(...evs); // causes first, then the reactions below
    for (const e of evs) {
      if (e.type === 'duckLaunched') {
        // only a real launch costs a move; a refused aim never reaches here
        this.movesLeft = Math.max(0, this.movesLeft - 1);
        this.pendingLaunches = Math.max(0, this.pendingLaunches - 1);
        this.pushLocal({ type: 'movesLeft', left: this.movesLeft });
      }
      if (e.type === 'barrelDestroyed') {
        this.destroyed++;
        this.pushCounter();
      }
      // a pearl counts when it LANDS on the counter, not when the shell spills
      // it — so the number the player sees drop is the pearl they just watched
      // arrive, and the level cannot clear while one is still in the air
      if (e.type === 'pearlCollected') {
        this.pearlsCollected++;
        this.pushPearlCounter();
      }
    }

    // the clock only runs while the level is live, so a decided board is not
    // left counting down behind a transition
    if (!this.untimed && !this.won && !this.failed && this.ticksLeft > 0) {
      this.ticksLeft--;
      this.pushTimeLeft();
    }

    // quota met: every clam retires to an inert (but solid and visible) bumper.
    // The event lands in world.events and drains on the next step, one tick
    // behind — harmless, and it keeps the drain loop free of world mutation.
    if (this.pearlCounter.left === 0 && this.world.clams.some((c) => c.active)) {
      this.world.spendClams();
    }

    const goalsLeft = this.goalsRemaining > 0;
    if (!this.won && !this.failed && !goalsLeft) {
      this.won = true;
      this.pushLocal({ type: 'levelCleared', index: this.levelIndex, movesLeft: this.movesLeft });
      this.pushLocal({ type: 'won' });
    }

    // Either limit only bites once everything has settled — a shot in flight, a
    // burning fuse or a drifting blast victim still gets to finish the job. The
    // clock bites the same way and for the same reason: it stops the NEXT shot
    // the instant it reaches zero (syncBlocked), but never snatches a board away
    // from a chain that is still resolving. That can push a run a second or two
    // past thirty, which is cheaper than robbing a player mid-chain.
    if (!this.won && !this.failed && goalsLeft && this.boardSettled()) {
      const outOfTime = this.ticksLeft <= 0;
      const outOfMoves = this.movesLeft === 0;
      if (outOfTime || outOfMoves) {
        this.failed = true;
        this.pushLocal({
          type: 'levelFailed',
          index: this.levelIndex,
          reason: outOfTime ? 'time' : 'moves',
        });
      }
    }

    // finale flourish: the last goal standing gets near-max assist
    if (!this.finaleArmed && !this.won && this.goalsRemaining === 1) {
      this.finaleArmed = true;
      this.slingshot.assist = Math.max(this.level.assist, 0.9);
      this.pushLocal({ type: 'finaleArmed' });
    }

    this.syncBlocked(); // the budget bars the slingshot itself, not just the view

    this.handleRespawns();
  }

  /**
   * Nothing moving, no fuse burning, no pending pop — and no clam mid-cycle.
   *
   * An open clam is unfinished business exactly like a burning fuse: it has a
   * pearl in the air that has not been counted yet. Without this an unlucky
   * last shot could crack a clam, let the board come to rest, and be declared
   * FAILED a full second before the pearl it already earned lands on the
   * counter and would have cleared the level.
   */
  boardSettled(): boolean {
    if (this.world.clams.some((c) => c.open)) return false;
    return !this.world.ducks.some((d) => d.live || d.matched || d.vx !== 0 || d.vy !== 0);
  }

  /**
   * Is there any shot the player could legally take? A release only fires when
   * the guide reaches another duck, so a board can be *fully stocked* and still
   * dead: statics between the ducks, every lane blocked. Counting ducks cannot
   * see that, which is how a walled level soft-locks.
   *
   * Sampled rather than solved: a ring of directions per resting duck, which is
   * what the player can actually try. Conservative by a hair (it may miss a
   * bank shot that threads between two samples), and that is the right way to
   * be wrong — the cost of a false alarm is one extra duck.
   */
  private anyLegalShot(): boolean {
    const STEPS = 48; // every 7.5 degrees
    for (const d of this.world.ducks) {
      if (d.live || d.popping || d.matched) continue;
      for (let i = 0; i < STEPS; i++) {
        const a = (i / STEPS) * Math.PI * 2;
        const dir = { x: Math.cos(a), y: Math.sin(a) };
        if (predictShot(this.world, d, dir).hitKind === 'duck') return true;
      }
    }
    return false;
  }

  private handleRespawns(): void {
    if (this.won || this.failed) return;
    let target = this.level.targetDucks;
    // a shot is only valid aimed at another duck, so one duck alone is a
    // softlock — the field must never settle below two
    if (this.world.ducks.length < 2) target = Math.max(target, 2);
    // …and a stocked board can be just as dead if nothing has a line. Only
    // worth asking once everything has come to rest, and cheap at that rate.
    if (this.world.ducks.length >= target && this.boardSettled() && !this.slingshot.aiming) {
      this.deadBoardTicks++;
      // the sweep is ~20ms on a dead board, so ask once per grace window rather
      // than every tick — otherwise a stuck board pays it twice a second
      if (this.deadBoardTicks % DEAD_BOARD_GRACE === 0 && !this.anyLegalShot()) {
        this.deadBoardTicks = 0;
        const spot = this.freeSpot();
        const colours: Colour[] = ['yellow', 'green', 'purple', 'red'];
        this.world.spawnDuck(colours[Math.floor(this.world.rng() * colours.length)]!, spot.x, spot.y);
        return;
      }
    } else {
      this.deadBoardTicks = 0;
    }
    if (this.world.ducks.length >= target) {
      this.respawnAt = null;
      return;
    }
    if (this.respawnAt === null) {
      this.respawnAt = this.world.time + SIM.RESPAWN_DELAY;
      return;
    }
    if (this.world.time < this.respawnAt) return;
    this.respawnAt = null;

    const colours: Colour[] = ['yellow', 'green', 'purple', 'red'];
    const colour = colours[Math.floor(this.world.rng() * colours.length)]!;
    const spot = this.freeSpot();
    this.world.spawnDuck(colour, spot.x, spot.y);
  }

  private freeSpot(): { x: number; y: number } {
    const R = this.level.spawnRegion;
    // how much room a candidate has: negative means it overlaps something
    const clearance = (x: number, y: number): number => {
      let worst = Infinity;
      for (const d of this.world.ducks) worst = Math.min(worst, Math.hypot(d.x - x, d.y - y) - SIM.DUCK_R * 2.4);
      for (const b of this.world.barrels) worst = Math.min(worst, Math.hypot(b.x - x, b.y - y) - (SIM.DUCK_R + SIM.BARREL_R + 8));
      for (const c of this.world.clams) worst = Math.min(worst, Math.hypot(c.x - x, c.y - y) - (SIM.DUCK_R + SIM.CLAM_R + 8));
      return worst;
    };
    let best = { x: (R.x0 + R.x1) / 2, y: (R.y0 + R.y1) / 2 };
    let bestClear = -Infinity;
    for (let tries = 0; tries < 40; tries++) {
      const x = R.x0 + this.world.rng() * (R.x1 - R.x0);
      const y = R.y0 + this.world.rng() * (R.y1 - R.y0);
      const c = clearance(x, y);
      if (c > 0) return { x, y };
      if (c > bestClear) {
        bestClear = c;
        best = { x, y };
      }
    }
    // nothing was clear: fall back to the roomiest candidate seen rather than
    // the region's centre, which on a crowded board can sit inside an entity
    return best;
  }

  private pushCounter(): void {
    const c = this.counter;
    this.pushLocal({ type: 'counter', done: c.done, total: c.total });
  }

  private pushPearlCounter(): void {
    const p = this.pearlCounter;
    this.pushLocal({ type: 'pearlCounter', left: p.left, total: p.total });
  }

  private pushTimeLeft(): void {
    const s = this.secondsLeft;
    if (s === this.lastSeconds) return;
    this.lastSeconds = s;
    this.pushLocal({ type: 'timeLeft', seconds: s });
  }

  private pushLocal(e: SimEvent): void {
    this.drained.push(e);
  }
}
