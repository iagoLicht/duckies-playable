/** All tunables. Units: design px (720x1280 stage), seconds, px/s. */
export const SIM = {
  DT: 1 / 60,
  SUBSTEPS: 4,

  DUCK_R: 46,
  BARREL_R: 60,

  FRICTION: 0.6,        // exponential damping per second while live
  STOP_SPEED: 30,       // below this a live duck comes to rest
  RESTITUTION_WALL: 0.82,
  RESTITUTION_BODY: 0.95,

  GRAB_R: 80,           // pointer-to-duck pickup radius
  MIN_PULL: 40,         // below this, release is a whiff (no shot)
  // official threshold: pulls under this neither aim nor fire
  LAUNCH_SPEED: 1200,   // fixed launch speed — drag sets direction only (official-example mechanic)

  // Match constants below are the official example's, converted at our 90 px/unit.
  // (decomp `or`: POP_SPEED 1.4 u/s, BLAST_RADIUS 1.5 u, MATCH_FUSE_TICKS 90,
  // MATCH_BLINK_TICKS 9.) Same-colour contact at speed does NOT pop on impact —
  // it lights a fuse: the duck keeps full physics, blinks white, and pops when
  // the fuse runs out. Each blast relights a fresh fuse on the ducks it catches,
  // so a chain costs one full fuse per generation.
  POP_SPEED: 126,       // min relative speed for a same-colour pair to match
  BARREL_HIT_SPEED: 90, // min impact speed for a direct hit to damage a barrel
  BLAST_R: 135,
  MATCH_FUSE_TICKS: 90, // fixed steps from match to pop (60 ticks = 1 s)
  MATCH_BLINK_TICKS: 9, // fixed steps per white/normal blink band

  RESPAWN_DELAY: 0.6,
  ASSIST_CONE_DEG: 28,
} as const;

const WAVES = [
  {
    assist: 0.35,
    targetDucks: 4,
    barrels: [
      { skin: 'yellow', x: 250, y: 800, hp: 2 },
      { skin: 'red', x: 470, y: 800, hp: 2 },
      { skin: 'wood', x: 120, y: 1090, hp: 2 },
      { skin: 'wood', x: 285, y: 1090, hp: 2 },
      { skin: 'wood', x: 450, y: 1090, hp: 2 },
      { skin: 'wood', x: 615, y: 1090, hp: 2 },
    ],
  },
  {
    assist: 0.55,
    targetDucks: 4,
    barrels: [
      { skin: 'purple', x: 250, y: 620, hp: 2 },
      { skin: 'red', x: 470, y: 620, hp: 2 },
      { skin: 'wood', x: 120, y: 640, hp: 2 },
      { skin: 'wood', x: 615, y: 640, hp: 2 },
      { skin: 'wood', x: 250, y: 1090, hp: 2 },
      { skin: 'wood', x: 470, y: 1090, hp: 2 },
    ],
  },
  {
    assist: 0.85,
    targetDucks: 2,
    barrels: [{ skin: 'yellow', x: 360, y: 700, hp: 3, golden: true }],
  },
] as const;

/** Level data — mirrors the locked visual layout for wave 1. */
export const LEVEL = {
  DUCKS: [
    { colour: 'green', x: 175, y: 360 },
    { colour: 'red', x: 455, y: 345 },
    { colour: 'yellow', x: 285, y: 485 },
    { colour: 'green', x: 550, y: 470 },
  ],
  WAVES,
  /** derived: every barrel across every wave */
  TOTAL_BARRELS: WAVES.reduce((n, w) => n + w.barrels.length, 0) as number,
  ASSIST_FINALE: 0.95,
  DUCK_SPAWN_REGION: { x0: 110, y0: 300, x1: 610, y1: 560 },
} as const;
