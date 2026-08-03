export type Colour = 'yellow' | 'green' | 'purple' | 'red';

export interface Duck {
  id: number;
  kind: 'duck';
  colour: Colour;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** true from launch until it comes to rest — pops/damage need a live duck */
  live: boolean;
  /** fixed steps spent moving — drives the flight-drag ramp; reset on launch/stop */
  ticksMoving: number;
  /** set the instant the duck leaves the world, so it can't be popped twice */
  popping: boolean;
  /** fuse lit: same-colour contact or a blast caught it. Keeps full physics. */
  matched: boolean;
  /** fixed-step ticks left on the fuse; at 0 the duck pops (see SIM.MATCH_FUSE_TICKS) */
  matchFuse: number;
  /** caught by a blast: pops after settling + a stillness hold (fuse is the failsafe) */
  popOnSettle: boolean;
  /** consecutive fully-static ticks while doomed — resets the moment it moves */
  settleTicks: number;
}

export interface Barrel {
  id: number;
  kind: 'barrel';
  /** every barrel is the standard wooden crate; damage stage lives in hp */
  skin: 'wood';
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  golden: boolean;
  /** fixed-step ticks before contact damage can land again — one hit per collision */
  hitCooldown: number;
}

export type SimEvent =
  | { type: 'duckLaunched'; id: number }
  | { type: 'duckStopped'; id: number }
  /** (x,y) is the contact point, (nx,ny) the outward normal, speed pre-kick */
  | { type: 'wallHit'; id: number; x: number; y: number; nx: number; ny: number;
      speed: number; source: 'wall' | 'bumper' }
  | { type: 'duckMatched'; id: number }
  | { type: 'duckPopped'; id: number; colour: Colour; x: number; y: number }
  | { type: 'blast'; colour: Colour; x: number; y: number; r: number }
  | { type: 'duckSpawned'; duck: Duck }
  | { type: 'barrelDamaged'; id: number; hp: number }
  | { type: 'barrelDestroyed'; id: number; x: number; y: number }
  | { type: 'barrelSpawned'; barrel: Barrel }
  | { type: 'waveStarted'; wave: number }
  | { type: 'counter'; done: number; total: number }
  | { type: 'finaleArmed' }
  | { type: 'won' };
