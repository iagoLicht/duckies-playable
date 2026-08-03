import { Slingshot } from './aim';
import { LEVEL, SIM } from './config';
import type { Colour, SimEvent } from './types';
import { World } from './world';

/**
 * Level orchestration: waves, barrel counter, duck respawns, aim-assist ramp,
 * and the rigged finale (golden barrel at 1hp -> respawns thin out to the
 * final PAIR: with duck-only shot validation one lone duck would be unaimable,
 * so the closing beat is slinging one duck into the other by the barrel).
 */
export class Director {
  readonly world: World;
  readonly slingshot: Slingshot;
  /** events already drained from world.events by step() — kept for the view */
  drained: SimEvent[] = [];
  wave = 0;
  won = false;
  finaleArmed = false;
  private destroyed = 0;
  private respawnAt: number | null = null;

  constructor(seed: number) {
    this.world = new World(seed);
    this.slingshot = new Slingshot(this.world);
  }

  get counter(): { done: number; total: number } {
    return { done: this.destroyed, total: LEVEL.TOTAL_BARRELS };
  }

  start(): void {
    for (const d of LEVEL.DUCKS) {
      this.world.spawnDuck(d.colour as Colour, d.x, d.y);
    }
    this.startWave(1);
    // present one consistent stream: the init spawns/waveStarted land in
    // `drained` alongside the counter instead of leaking into the first step()
    this.drained.push(...this.world.events.splice(0, this.world.events.length));
    this.pushCounter();
  }

  private startWave(n: number): void {
    this.wave = n;
    const w = LEVEL.WAVES[n - 1];
    if (!w) return;
    for (const b of w.barrels) {
      this.world.spawnBarrel(
        b.skin, b.x, b.y, b.hp, (b as { golden?: boolean }).golden ?? false,
      );
    }
    this.slingshot.assist = w.assist;
    this.world.events.push({ type: 'waveStarted', wave: n });
  }

  step(dt: number): void {
    this.world.step(dt);

    // drain world events, reacting to the ones the director cares about
    const evs = this.world.events.splice(0, this.world.events.length);
    this.drained.push(...evs); // causes first, then the reactions below
    for (const e of evs) {
      if (e.type === 'barrelDestroyed') {
        this.destroyed++;
        this.pushLocal({ type: 'counter', done: this.destroyed, total: LEVEL.TOTAL_BARRELS });
      }
    }

    if (!this.won && this.destroyed >= LEVEL.TOTAL_BARRELS) {
      this.won = true;
      this.pushLocal({ type: 'won' });
    }

    // wave advance
    const waveDef = LEVEL.WAVES[this.wave - 1];
    if (!this.won && waveDef && this.world.barrels.length === 0 && this.wave < LEVEL.WAVES.length) {
      this.startWave(this.wave + 1);
    }

    // finale arming: golden at 1hp
    const golden = this.world.barrels.find((b) => b.golden);
    if (!this.finaleArmed && golden && golden.hp === 1) {
      this.finaleArmed = true;
      this.slingshot.assist = LEVEL.ASSIST_FINALE;
      this.pushLocal({ type: 'finaleArmed' });
    }

    this.handleRespawns(dt);
  }

  private handleRespawns(_dt: number): void {
    if (this.won) return;
    const waveDef = LEVEL.WAVES[this.wave - 1];
    if (!waveDef) return;
    let target = waveDef.targetDucks as number;
    if (this.finaleArmed) target = 2; // the "final pair" moment
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
    const R = LEVEL.DUCK_SPAWN_REGION;
    for (let tries = 0; tries < 40; tries++) {
      const x = R.x0 + this.world.rng() * (R.x1 - R.x0);
      const y = R.y0 + this.world.rng() * (R.y1 - R.y0);
      const clear =
        this.world.ducks.every((d) => Math.hypot(d.x - x, d.y - y) > SIM.DUCK_R * 2.4) &&
        this.world.barrels.every((b) => Math.hypot(b.x - x, b.y - y) > SIM.DUCK_R + SIM.BARREL_R + 8);
      if (clear) return { x, y };
    }
    return { x: (R.x0 + R.x1) / 2, y: (R.y0 + R.y1) / 2 };
  }

  private pushCounter(): void {
    this.pushLocal({ type: 'counter', done: this.destroyed, total: LEVEL.TOTAL_BARRELS });
  }

  private pushLocal(e: SimEvent): void {
    this.drained.push(e);
  }
}
