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
  /** set the instant the duck leaves the world, so it can't be popped twice */
  popping: boolean;
  /** fuse lit: same-colour contact or a blast caught it. Keeps full physics. */
  matched: boolean;
  /** fixed-step ticks left on the fuse; at 0 the duck pops (see SIM.MATCH_FUSE_TICKS) */
  matchFuse: number;
}

export interface Barrel {
  id: number;
  kind: 'barrel';
  skin: 'wood' | 'yellow' | 'purple' | 'red';
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  golden: boolean;
}

export type SimEvent =
  | { type: 'duckLaunched'; id: number }
  | { type: 'duckStopped'; id: number }
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
