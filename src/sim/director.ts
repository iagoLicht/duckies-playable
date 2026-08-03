import { Slingshot } from './aim';
import { SIM } from './config';
import { LEVELS, type LevelDef } from './levels';
import type { Colour, SimEvent } from './types';
import { World } from './world';

/**
 * Runs one level of the campaign: builds the board, counts the shot budget down,
 * tops the duck supply back up, and decides cleared vs failed.
 *
 * Cleared = every barrel destroyed and every clam cracked open.
 * Failed  = the budget is spent, goals remain, and the board has come to rest
 *           (so a shot still in flight always gets to finish its chain first).
 */
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
  private respawnAt: number | null = null;

  constructor(seed: number, levelIndex = 0) {
    this.levelIndex = levelIndex;
    const def = LEVELS[levelIndex];
    if (!def) throw new Error(`no level at index ${levelIndex}`);
    this.level = def;
    this.movesLeft = def.moves;
    this.world = new World(seed);
    this.slingshot = new Slingshot(this.world);
    this.slingshot.assist = def.assist;
  }

  /** goals: barrels to break plus clams to crack */
  get counter(): { done: number; total: number } {
    const total = this.level.barrels.length + this.level.clams.length;
    const opened = this.world.clams.filter((c) => c.open).length;
    return { done: this.destroyed + opened, total };
  }

  start(): void {
    this.slingshot.blocked = this.movesLeft === 0;
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
    this.pushLocal({ type: 'movesLeft', left: this.movesLeft });
  }

  step(dt: number): void {
    this.world.step(dt);

    const evs = this.world.events.splice(0, this.world.events.length);
    this.drained.push(...evs); // causes first, then the reactions below
    for (const e of evs) {
      if (e.type === 'duckLaunched') {
        // only a real launch costs a move; a refused aim never reaches here
        this.movesLeft = Math.max(0, this.movesLeft - 1);
        this.pushLocal({ type: 'movesLeft', left: this.movesLeft });
      }
      if (e.type === 'barrelDestroyed') {
        this.destroyed++;
        this.pushCounter();
      }
      if (e.type === 'clamOpened') this.pushCounter();
    }

    const goalsLeft = this.world.barrels.length > 0 || this.world.clams.some((c) => !c.open);
    if (!this.won && !this.failed && !goalsLeft) {
      this.won = true;
      this.pushLocal({ type: 'levelCleared', index: this.levelIndex, movesLeft: this.movesLeft });
      this.pushLocal({ type: 'won' });
    }

    // the budget only bites once everything has settled — a shot in flight, a
    // burning fuse or a drifting blast victim still gets to finish the job
    if (!this.won && !this.failed && this.movesLeft === 0 && goalsLeft && this.boardSettled()) {
      this.failed = true;
      this.pushLocal({ type: 'levelFailed', index: this.levelIndex });
    }

    // finale flourish: the last goal standing gets near-max assist
    if (!this.finaleArmed && !this.won && this.counter.total - this.counter.done === 1) {
      this.finaleArmed = true;
      this.slingshot.assist = Math.max(this.level.assist, 0.9);
      this.pushLocal({ type: 'finaleArmed' });
    }

    // the budget bars the slingshot itself, not just the view
    this.slingshot.blocked = this.movesLeft === 0 || this.won || this.failed;

    this.handleRespawns();
  }

  /** nothing moving, no fuse burning, no pending pop */
  boardSettled(): boolean {
    return !this.world.ducks.some((d) => d.live || d.matched || d.vx !== 0 || d.vy !== 0);
  }

  private handleRespawns(): void {
    if (this.won || this.failed) return;
    let target = this.level.targetDucks;
    // a shot is only valid aimed at another duck, so one duck alone is a
    // softlock — the field must never settle below two
    if (this.world.ducks.length < 2) target = Math.max(target, 2);
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
    for (let tries = 0; tries < 40; tries++) {
      const x = R.x0 + this.world.rng() * (R.x1 - R.x0);
      const y = R.y0 + this.world.rng() * (R.y1 - R.y0);
      const clear =
        this.world.ducks.every((d) => Math.hypot(d.x - x, d.y - y) > SIM.DUCK_R * 2.4) &&
        this.world.barrels.every((b) => Math.hypot(b.x - x, b.y - y) > SIM.DUCK_R + SIM.BARREL_R + 8) &&
        this.world.clams.every((c) => Math.hypot(c.x - x, c.y - y) > SIM.DUCK_R + SIM.CLAM_R + 8);
      if (clear) return { x, y };
    }
    return { x: (R.x0 + R.x1) / 2, y: (R.y0 + R.y1) / 2 };
  }

  private pushCounter(): void {
    const c = this.counter;
    this.pushLocal({ type: 'counter', done: c.done, total: c.total });
  }

  private pushLocal(e: SimEvent): void {
    this.drained.push(e);
  }
}
