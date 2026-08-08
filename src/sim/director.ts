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
  private destroyed = 0;
  /** pearls that have REACHED the HUD — spilled-but-still-flying ones don't count */
  private pearlsCollected = 0;
  /**
   * World times at which replacements fall due, one entry per duck popped,
   * oldest first. A pop owes a duck back RESPAWN_DELAY later and the debt is
   * carried per pop rather than per board — see handleRespawns.
   */
  private respawnDue: number[] = [];
  /** consecutive settled ticks — the dead-board check only runs after a pause */
  private deadBoardTicks = 0;
  /** shots already fired whose move has not been debited yet (same-frame guard) */
  private pendingLaunches = 0;
  /**
   * The NEXT launch is the idle demo's, and it plays by every rule except the
   * budget: it is not debited, and it is not held against the budget while it
   * flies either. Set immediately before `slingshot.end()` and cleared by the
   * launch it describes, so it can never leak onto a player's shot.
   *
   * The ad is timed, not counted (user-locked 2026-08-07) — a viewer who looks
   * away must not come back to a board that has spent their shots for them. It
   * is a flag here rather than a correction applied afterwards because the
   * counter is on screen: told before the launch, the HUD never sees the number
   * move; told after, it flickers down and back.
   */
  demoLaunch = false;
  /** fixed steps left on the board's countdown — see SIM.LEVEL_TICKS */
  private ticksLeft: number;
  /** the countdown the board opened with, for the pace governor's progress */
  private readonly ticksTotal: number;
  /** the last whole second published, so `timeLeft` only fires on a change */
  private lastSeconds = -1;

  /**
   * `ticks` is the board's countdown, and it is a constructor parameter rather
   * than a settable field so the clock is DATA, not a mode: there is no switch
   * to flip mid-level, nothing the view (or `window.__scene.director`) can reach
   * to turn the limit off, and "the shipped game always runs the real clock" is
   * true by construction instead of by comment. Harnesses that must outlast it
   * pass `Infinity`; the reasoning for when that is legitimate lives with the
   * harness, in tests/sim/bot.ts.
   */
  constructor(seed: number, levelIndex = 0, ticks: number = SIM.LEVEL_TICKS) {
    this.levelIndex = levelIndex;
    this.ticksLeft = ticks;
    this.ticksTotal = ticks;
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
      if (this.demoLaunch) return; // free: never charged, never even held
      this.pendingLaunches++;
      this.syncBlocked();
    };
  }

  /**
   * When the slingshot is barred: either limit reached — budget spent (once
   * everything fired is paid for) or clock expired — a level already decided, or
   * A TURN STILL RESOLVING.
   *
   * That last clause is the one that makes "one shot at a time" a rule rather
   * than an expectation (user-locked 2026-08-07). Nothing used to stop a player
   * grabbing a second duck while the first was still in flight: `begin` refused
   * a duck that was itself live, matched or popping, and said nothing about the
   * rest of the board — so a shot could be fired into a chain that had not
   * finished, spending a move on a board that was about to rearrange itself.
   *
   * It belongs HERE, not in the pointer handler, for the reason the move budget
   * does: a limit enforced only in the view is not enforced. A bot, a test, or
   * anything else driving the sim directly gets the same rule.
   */
  private syncBlocked(): void {
    this.slingshot.blocked =
      this.movesLeft - this.pendingLaunches <= 0 ||
      this.ticksLeft <= 0 ||
      this.won ||
      this.failed ||
      !this.boardComplete;
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
    for (const d of this.level.ducks) this.world.spawnDuck(d.colour, d.x, d.y);
    for (const b of this.level.barrels) {
      this.world.spawnBarrel('wood', b.x, b.y, b.hp, b.golden ?? false);
    }
    for (const c of this.level.clams) this.world.spawnClam(c.x, c.y, c.skin ?? 'normal');
    // THE BOARD OPENS FULL. Several levels author fewer ducks than they want
    // afloat (4 authored against targetDucks 5), and the shortfall used to be
    // made up by the ordinary respawn timer — so the level opened with four
    // ducks and a fifth dropped in a beat later, on its own. Filling here puts
    // the owed ducks in the SAME event batch as the authored ones, so the whole
    // field arrives on one frame. It has to run after the barrels and clams
    // above, because freeSpot() places around them.
    this.fillField();
    // AFTER the board is populated, not before: the bar now asks whether the
    // board is complete, and an empty field is not. Asked first, it would open
    // every level barred until the first step() cleared it.
    this.syncBlocked();
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
        // the idle demo's shot is the viewer's to watch, not to pay for: it
        // still launches, still chains, still counts for the goals — it just
        // does not spend. The flag is spent HERE, by the launch it was set for.
        if (this.demoLaunch) {
          this.demoLaunch = false;
        } else {
          // only a real launch costs a move; a refused aim never reaches here
          this.movesLeft = Math.max(0, this.movesLeft - 1);
          this.pendingLaunches = Math.max(0, this.pendingLaunches - 1);
          this.pushLocal({ type: 'movesLeft', left: this.movesLeft });
        }
      }
      if (e.type === 'barrelDestroyed') {
        this.destroyed++;
        this.pushCounter();
      }
      // the debt is booked by the POP that created it, and comes due on its own
      // clock — nothing about the rest of the board delays it
      if (e.type === 'duckPopped') {
        this.respawnDue.push(this.world.time + SIM.RESPAWN_DELAY);
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
    if (!this.won && !this.failed && this.ticksLeft > 0) {
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

    // pace-governed assist: the board leans into a lagging run and off a hot
    // one. On a paced board it keeps the dial through the finale too — the
    // flourish's near-max crank is a "help them win" device, and this board's
    // whole brief is to be lost by a hair (a lagging run still gets the lean).
    if (this.level.pace && this.level.pace.assistGain > 0) {
      const a = this.level.assist - this.pacePressure() * this.level.pace.assistGain;
      this.slingshot.assist = Math.max(0.25, Math.min(0.7, a));
    }

    // finale flourish: the last goal standing gets near-max assist — except on
    // a paced board, where the governor above owns the dial and the finale
    // stays what it is to the VIEW: an event, the last-goal drama beat
    if (!this.finaleArmed && !this.won && this.goalsRemaining === 1) {
      this.finaleArmed = true;
      if (!this.level.pace) this.slingshot.assist = Math.max(this.level.assist, 0.9);
      this.pushLocal({ type: 'finaleArmed' });
    }

    this.handleRespawns();
    // LAST, after the respawn: the bar reads the board, so it has to read the
    // board this tick ends with. Run before handleRespawns it would still see
    // the shortfall the respawn just filled, and bar the slingshot for one more
    // tick than the rule asks for.
    this.syncBlocked();
  }

  /**
   * Nothing moving, no fuse burning, no pending pop — and no pearl still in the
   * air over an open shell.
   *
   * A pearl in flight is unfinished business exactly like a burning fuse: it has
   * not been counted yet. Without this an unlucky last shot could crack a clam,
   * let the board come to rest, and be declared FAILED a full second before the
   * pearl it already earned lands on the counter and would have cleared the
   * level. The pearls are asked about directly rather than through the shell's
   * pose, because the two are no longer the same question — every hit spills,
   * so a shell can shut over a pearl that is still climbing.
   */
  boardSettled(): boolean {
    if (this.world.pearls.length > 0) return false;
    if (this.world.clams.some((c) => c.open)) return false;
    return !this.world.ducks.some((d) => d.live || d.matched || d.vx !== 0 || d.vy !== 0);
  }

  /** how many ducks the board is owed. A legal shot needs a second duck to aim
   *  at, so the floor is two however few the level asks for. */
  private get fieldTarget(): number {
    return Math.max(this.level.targetDucks, 2);
  }

  /**
   * Is the board genuinely waiting on the player? This is the question the view
   * asks before it offers anything grabbable.
   *
   * `boardSettled` alone is NOT that question, and reading it as if it were is
   * the bug this exists to close. Settling only asks whether everything has come
   * to REST — but `popDuck` takes its victims out of `world.ducks` on the frame
   * it fires, so the instant a chain finishes the board is perfectly still and
   * two ducks short, with the replacements still sitting on RESPAWN_DELAY. That
   * leaves a ~0.6s window where the turn is visibly unfinished and every settled
   * test says otherwise.
   *
   * Three independent things have to hold:
   *   settled — nothing moving, no fuse burning, no pending pop, no pearl in the
   *             air and no clam still open over one
   *   whole   — every duck the level is owed is back on the water
   *   open    — the player may actually take a shot: budget left, clock left,
   *             outcome not already decided
   *
   * It reads the slingshot's own bar rather than re-deriving any of that,
   * because syncBlocked now folds all three in. THE OFFER AND THE GRAB ARE
   * LITERALLY THE SAME TEST: whatever the rings promise, `begin` honours, and
   * neither can drift from the other by being edited alone.
   */
  get readyForInput(): boolean {
    return !this.slingshot.blocked;
  }

  /**
   * Settled AND whole — the board has finished being a board.
   *
   * Split out of readyForInput because the END OF THE LEVEL asks the same
   * question with the last clause inverted: the banner may only go up once the
   * turn has completely resolved, and by then the slingshot is barred by
   * definition (won/failed both bar it). Anything asking "has the board finished
   * moving" wants this; only "may the player shoot" wants readyForInput.
   */
  get boardComplete(): boolean {
    return this.boardSettled() && this.world.ducks.length >= this.fieldTarget;
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
    // A DECIDED BOARD STILL FILLS BACK UP (user-locked 2026-08-07). This used to
    // return here the moment won/failed latched, which left the ducks a
    // last-shot chain had eaten simply gone. That was invisible while the card
    // arrived on a fixed delay, and became visible the moment the card started
    // waiting for the board to be whole: the level would end a duck short, the
    // count would never recover, and the banner would have waited for ever.
    //
    // The dead-board sweep below is the one thing a decided board does NOT do —
    // it exists to keep a shot available, and nobody is going to shoot.
    const decided = this.won || this.failed;
    // a shot is only valid aimed at another duck, so one duck alone is a
    // softlock — the field must never settle below two, which is baked into
    // fieldTarget. One definition of "owed", shared with readyForInput, so the
    // rings cannot come back on a count the respawn is still working towards.
    const target = this.fieldTarget;
    // …and a stocked board can be just as dead if nothing has a line. Only
    // worth asking once everything has come to rest, and cheap at that rate.
    if (!decided && this.world.ducks.length >= target && this.boardSettled() && !this.slingshot.aiming) {
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
      this.respawnDue.length = 0; // whole board, nothing owed
      return;
    }
    // A REPLACEMENT IS OWED BY ITS POP, NOT BY THE TURN (user-locked
    // 2026-08-08). This used to wait for boardSettled() — nothing in flight, no
    // fuse blinking, no clam still owing a pearl — so a chain that took two
    // seconds to unwind left the board visibly short for all of it, and only
    // then started the RESPAWN_DELAY beat. Each pop now books its own debt and
    // that debt comes due on its own clock, so ducks arrive while a chain is
    // still going off around them. That IS the intent: the board is never
    // visibly short — and the arrivals land OUTSIDE the reach of any fuse still
    // burning (freeSpot), so they join the board rather than feed the funeral:
    // a duck dropped into a pending blast only stretched the chain and the
    // player's wait with it (user-set 2026-08-08).
    //
    // Owed but nothing booked: the field is short for a reason no pop accounted
    // for (an authored board opening short, a duck removed some other way).
    // Book the WHOLE shortfall, one debt per missing duck, so the fallback still
    // lands as a single batch — booking one and re-arming next tick is exactly
    // the duck-per-delay dribble that was taken out on 2026-08-07. This is the
    // guarantee the old settle-gated path gave for free.
    if (this.respawnDue.length === 0) {
      const owed = target - this.world.ducks.length;
      for (let i = 0; i < owed; i++) this.respawnDue.push(this.world.time + SIM.RESPAWN_DELAY);
      return;
    }
    let due = 0;
    while (this.respawnDue.length > 0 && this.respawnDue[0]! <= this.world.time) {
      this.respawnDue.shift();
      due++;
    }
    if (due === 0) return;
    // never overshoot the level's count, however many debts came due at once
    this.fillField(Math.min(target, this.world.ducks.length + due));
  }

  /**
   * Place every duck the board is owed, ON ONE FRAME (user-locked 2026-08-07).
   * The respawn path used to spawn a single duck and re-arm its timer, so a
   * shot that popped four ducks dribbled them back one every 0.6s and the board
   * took two and a half seconds to look whole again.
   *
   * freeSpot() reads world.ducks, so each pick already sees the ones placed a
   * moment earlier in this same loop and the batch cannot stack on itself.
   * Bounded by construction: every pass adds a duck, so the count reaches the
   * target. `target` defaults to fieldTarget — the level's count, floored at the
   * two ducks a legal shot needs.
   */
  private fillField(target = this.fieldTarget): void {
    while (this.world.ducks.length < target) {
      const colour = this.pickRespawnColour();
      const spot = this.freeSpot();
      this.world.spawnDuck(colour, spot.x, spot.y);
    }
  }

  /**
   * Clock-rig pace pressure, −1 (far behind the near-miss line) … +1 (far
   * ahead of it). Zero whenever the level carries no `pace` block or the clock
   * is infinite — and zero means both consumers (the respawn colour pick and
   * the governed assist) take exactly the un-paced path, RNG call for RNG
   * call, so a level without `pace` cannot be told from one that predates the
   * governor. Spawn timing and placement have no pace path at all — the ad's
   * two beats must spawn identically (user-set 2026-08-08).
   */
  private pacePressure(): number {
    const pace = this.level.pace;
    if (!pace || !Number.isFinite(this.ticksTotal)) return 0;
    const q = this.pearlCounter;
    const collected = q.total - q.left;
    const progress = Math.min(1, (this.ticksTotal - this.ticksLeft) / this.ticksTotal);
    const ideal = (q.total - pace.targetLeft) * progress;
    return Math.max(-1, Math.min(1, (collected - ideal) / pace.spread));
  }

  /**
   * The colour a respawn arrives in. Uniform, except under pace steering:
   * behind the near-miss line the board sometimes deals the colour with the
   * most resting mates (matches — and the blasts that crack clams — come
   * easier), ahead of it the colour with the fewest. Odds scale with the
   * pressure, so a run tracking the line is dealt a fair hand. Supply only:
   * nothing already on the water, earned or aimed at, is touched.
   */
  private pickRespawnColour(): Colour {
    const colours: Colour[] = ['yellow', 'green', 'purple', 'red'];
    const pressure = this.pacePressure();
    if (pressure !== 0 && this.world.rng() < Math.abs(pressure) * this.level.pace!.colourGain) {
      const counts = new Map<Colour, number>();
      for (const c of colours) counts.set(c, 0);
      for (const d of this.world.ducks) {
        if (!d.live && !d.popping && !d.matched) counts.set(d.colour, counts.get(d.colour)! + 1);
      }
      let pick = colours[0]!;
      for (const c of colours) {
        const better = pressure < 0
          ? counts.get(c)! > counts.get(pick)!
          : counts.get(c)! < counts.get(pick)!;
        if (better) pick = c;
      }
      return pick;
    }
    return colours[Math.floor(this.world.rng() * colours.length)]!;
  }

  private freeSpot(): { x: number; y: number } {
    const R = this.level.spawnRegion;
    // how much room a candidate has: negative means it overlaps something.
    // A duck with a lit fuse (matched — every pending explosion carries it,
    // contact match and blast victim alike; popOnSettle is belt and braces) is
    // not an obstacle but a SCHEDULED BLAST, so the exclusion is its reach:
    // BLAST_R of centre-distance, padded a duck radius for the drift before it
    // settles and goes off. A replacement dropped inside that circle was
    // doomed on arrival — it fed the chain another generation and stretched
    // the wait between turns with it (user-set 2026-08-08).
    const clearance = (x: number, y: number): number => {
      let worst = Infinity;
      for (const d of this.world.ducks) {
        const keep = d.matched || d.popOnSettle ? SIM.BLAST_R + SIM.DUCK_R : SIM.DUCK_R * 2.4;
        worst = Math.min(worst, Math.hypot(d.x - x, d.y - y) - keep);
      }
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
    // the region's centre, which on a crowded board can sit inside an entity —
    // and "roomiest" already means farthest out of every pending blast
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
