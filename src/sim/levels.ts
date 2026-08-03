import type { Colour } from './types';

/**
 * One board of the campaign. A level is cleared when every barrel is destroyed
 * AND every clam has been cracked open; it is failed when the move budget runs
 * out with goals still standing and the board has come to rest.
 *
 * Design note — the move budget is the whole tension knob. Levels are tuned so
 * a competent player clears with roughly one shot to spare, which is what makes
 * the last shot feel like it matters.
 */
export interface LevelDef {
  name: string;
  /** shot budget; a whiff (refused aim) costs nothing, only real launches count */
  moves: number;
  /** aim assist strength, 0..1 — higher is more forgiving */
  assist: number;
  /** how many ducks the board keeps afloat (respawns top it up) */
  targetDucks: number;
  ducks: Array<{ colour: Colour; x: number; y: number }>;
  barrels: Array<{ x: number; y: number; hp: number; golden?: boolean }>;
  clams: Array<{ x: number; y: number; skin?: 'normal' | 'gold' | 'baby' }>;
  /** where respawning ducks may appear */
  spawnRegion: { x0: number; y0: number; x1: number; y1: number };
}

/**
 * Playfield bounds for level authors. The tub interior runs x 46..674,
 * y 220..1234 (main.ts tub geometry inset by the collision margin); the two
 * pink wall bumpers sit at y 950 on both walls. Keep entity centres at least
 * one radius clear of these: duck 46, barrel 60, clam 56.
 *
 * Two shapes of the tub that bite level authors:
 *  - the top is NARROW. The shoulders squeeze x to 98..622 above y≈262 and the
 *    bezier only flares back to the full 46..674 at y≈306, so nothing static
 *    should sit above y≈380.
 *  - the bottom corners are rounded (r 26 at the inner face), so a barrel below
 *    y≈1100 wants x in roughly 130..590.
 *
 * Authoring rules of thumb used throughout this file:
 *  - a duck squeezes through a gap only if its centre can stay one duck radius
 *    plus the blocker radius clear of BOTH sides: 212px between barrel centres,
 *    204px between clam centres. Anything tighter is a wall.
 *  - a blast reaches BLAST_R 135 from the popping duck's CENTRE, and a duck's
 *    centre can never be closer than 106 to a barrel or 102 to a clam. So a
 *    single pop can take two clams only when they are 204..270 apart, and the
 *    firing position is a narrow lens between them. That lens is the puzzle in
 *    several levels below.
 */
export const FIELD = { x0: 46, y0: 220, x1: 674, y1: 1234, bumperY: 950 } as const;

export const LEVELS: LevelDef[] = [
  // ── 1 ────────────────────────────────────────────────────────────────────
  // TEACH THE VERB. Open water, four barrels in two clean rows, a same-colour
  // green pair sitting on an unobstructed line. There is no puzzle here beyond
  // "pull back, let go, watch two ducks of a colour blow up a crate".
  // Budget intent: 6 hits in 8 shots — deliberately loose, the only level that
  // is meant to be survivable by flailing. Assist raised from 0.45 to 0.55 so a
  // first-timer's sloppy drag still locks a target and never eats a refusal.
  {
    name: 'Bath Time',
    moves: 8,
    assist: 0.55,
    targetDucks: 4,
    ducks: [
      { colour: 'green', x: 175, y: 360 },
      { colour: 'red', x: 455, y: 345 },
      { colour: 'yellow', x: 285, y: 485 },
      { colour: 'green', x: 550, y: 470 },
    ],
    barrels: [
      { x: 250, y: 800, hp: 2 },
      { x: 470, y: 800, hp: 2 },
      { x: 285, y: 1090, hp: 1 },
      { x: 450, y: 1090, hp: 1 },
    ],
    clams: [],
    spawnRegion: { x0: 110, y0: 300, x1: 610, y1: 560 },
  },

  // ── 2 ────────────────────────────────────────────────────────────────────
  // TEACH THE CLAM. One clam alone in the middle of open water, directly in the
  // path of every shot aimed down the board, with the two barrels parked behind
  // it so the natural follow-through carries on into them. The lesson is that a
  // clam is a target you *hit*, and that it kicks the duck back at you.
  // Budget intent: 3 goals / 3 hits in 5 shots. Loose but no longer free — a
  // player who spends two shots pinballing off the clam without cracking it
  // will notice the counter.
  {
    name: 'Pearl Diver',
    moves: 5,
    assist: 0.6,
    targetDucks: 4,
    ducks: [
      { colour: 'green', x: 180, y: 380 },
      { colour: 'green', x: 540, y: 380 },
      { colour: 'yellow', x: 360, y: 470 },
      { colour: 'red', x: 250, y: 570 },
    ],
    barrels: [
      { x: 190, y: 1080, hp: 1 },
      { x: 530, y: 1080, hp: 1 },
    ],
    clams: [{ x: 360, y: 800 }],
    spawnRegion: { x0: 130, y0: 330, x1: 590, y1: 600 },
  },

  // ── 3 ────────────────────────────────────────────────────────────────────
  // TEACH THE CHAIN. The four barrels sit on a diamond whose centre (360,820) is
  // 110..120 from every one of them — inside BLAST_R — and is *just* wide enough
  // for a duck to stand in (106 minimum). So one pop landed in the middle of the
  // diamond chips all four crates at once, and a second-generation victim that
  // settles anywhere in there does it again. Two same-colour pairs on the board
  // so the player can find that centre twice.
  // Budget intent: 5 hits in 5 shots, but only if the pops land in the pocket;
  // pops that go off outside the diamond waste a shot entirely, which is exactly
  // the near-miss this level sells. (Measured: a zero-skill bot firing random
  // legal aims cleared this 98% of the time at 7 moves — barrels are far softer
  // than their hp suggests, because a launched duck ricochets and re-hits. 5 is
  // the number that makes the pocket matter.)
  {
    name: 'Chain Gang',
    moves: 5,
    assist: 0.5,
    targetDucks: 5,
    ducks: [
      { colour: 'yellow', x: 200, y: 400 },
      { colour: 'yellow', x: 520, y: 400 },
      { colour: 'green', x: 360, y: 520 },
      { colour: 'green', x: 180, y: 600 },
    ],
    barrels: [
      { x: 360, y: 700, hp: 1 },
      { x: 250, y: 820, hp: 1 },
      { x: 470, y: 820, hp: 1 },
      { x: 360, y: 940, hp: 2 },
    ],
    clams: [],
    spawnRegion: { x0: 130, y0: 330, x1: 600, y1: 600 },
  },

  // ── 4 ────────────────────────────────────────────────────────────────────
  // CLAMS AS DEFLECTORS. The two hp2 barrels are shoved right up against the
  // side walls at y 640, in the dead angle where a straight duck-to-duck shot
  // from the spawn shelf can't reach them — but the high clam at (300,640) sits
  // on the line to the left one, and the low clam at (430,900) kicks anything
  // that grazes it out toward the right wall. Both clams are goals themselves,
  // so the deflector you need is also the thing you must destroy: crack them too
  // early and you lose the aiming furniture (they stay solid, but the pearl and
  // the counter are gone and the level's remaining slack goes with it).
  // Budget intent: 6 goals / 8 hits in 8 shots. The wall barrels are the tax.
  {
    name: 'Deflection',
    moves: 8,
    assist: 0.45,
    targetDucks: 4,
    ducks: [
      { colour: 'red', x: 180, y: 400 },
      { colour: 'red', x: 540, y: 400 },
      { colour: 'yellow', x: 360, y: 480 },
      { colour: 'purple', x: 230, y: 540 },
    ],
    barrels: [
      { x: 150, y: 640, hp: 2 },
      { x: 590, y: 640, hp: 2 },
      { x: 200, y: 1120, hp: 1 },
      { x: 520, y: 1120, hp: 1 },
    ],
    clams: [
      { x: 300, y: 640 },
      { x: 430, y: 900 },
    ],
    spawnRegion: { x0: 130, y0: 340, x1: 600, y1: 560 },
  },

  // ── 5 ────────────────────────────────────────────────────────────────────
  // TWO CLAMS, ONE BLAST. The clams are 240 apart: a pop whose centre lands in
  // the lens between them (x 342..378, y 658..782) opens BOTH, and nothing else
  // does it in one shot. The gap is 128px of free water — a duck fits through
  // with 18px to spare — so getting a same-colour pair to meet *inside* the
  // corridor is the whole level. The greens are deliberately parked so the lazy
  // shot pops them up at y≈500, well short of the lens; you have to nudge one
  // green down into the throat first and match it on the next shot. Three
  // barrels wait underneath as the reward for punching through.
  // Budget intent: 5 goals / 6 hits in 8 shots. Doing the clams one at a time
  // is survivable but leaves almost nothing for the barrels — that is the
  // near-miss. (Clams are the real difficulty currency: they need a direct fast
  // hit or a blast centred within 135, where a barrel just needs to be bumped.)
  {
    name: 'Twin Pearls',
    moves: 8,
    assist: 0.45,
    targetDucks: 3,
    ducks: [
      { colour: 'green', x: 200, y: 420 },
      { colour: 'yellow', x: 520, y: 420 },
      { colour: 'green', x: 520, y: 560 },
      { colour: 'red', x: 200, y: 600 },
    ],
    barrels: [
      { x: 180, y: 1090, hp: 1 },
      { x: 360, y: 1090, hp: 2 },
      { x: 540, y: 1090, hp: 1 },
    ],
    clams: [{ x: 240, y: 720 }, { x: 480, y: 720 }],
    spawnRegion: { x0: 140, y0: 340, x1: 580, y1: 580 },
  },

  // ── 6 ────────────────────────────────────────────────────────────────────
  // ARMOUR. Two hp3 crates in the upper shoulders, an hp2 keystone dead centre,
  // two hp1 stragglers low. Ten hits, nine shots: this cannot be brute-forced
  // one hit per shot, so the level is really asking "can you get a blast to
  // count twice?". The keystone at (360,900) is 256 from each hp3 — out of blast
  // range from either — but a duck that settles at roughly (330,790) is inside
  // BLAST_R of the keystone *and* of the left hp3. Finding those double-dip
  // positions three or four times over is the solve.
  // Budget intent: 5 goals / 10 hits in 7 shots. Assist drops to 0.4 because
  // this is the first level that punishes a shot landing 40px off.
  {
    name: 'Ironclad',
    moves: 7,
    assist: 0.4,
    targetDucks: 5,
    ducks: [
      { colour: 'purple', x: 180, y: 400 },
      { colour: 'yellow', x: 360, y: 380 },
      { colour: 'purple', x: 540, y: 400 },
      { colour: 'yellow', x: 360, y: 540 },
    ],
    barrels: [
      { x: 200, y: 700, hp: 3 },
      { x: 520, y: 700, hp: 3 },
      { x: 360, y: 900, hp: 2 },
      { x: 150, y: 1060, hp: 1 },
      { x: 570, y: 1060, hp: 1 },
    ],
    clams: [],
    spawnRegion: { x0: 130, y0: 330, x1: 600, y1: 580 },
  },

  // ── 7 ────────────────────────────────────────────────────────────────────
  // PINBALL. Asymmetric on purpose: a clam high on the left, a clam low right of
  // centre, four crates strung along the bottom lip, and the two pink wall
  // bumpers at y 950 left wide open on both sides. Every barrel down there is
  // easier to reach off a wall bumper or a clam face than head-on, and assist is
  // low (0.4) precisely so a bank shot survives the aim bend instead of being
  // snapped back onto the nearest duck. The left clam doubles as the rail that
  // sends a duck into the left bumper.
  // Budget intent: 6 goals / 8 hits in 9 shots, and at least two of those hits
  // really do want to arrive sideways.
  {
    name: 'Pinball',
    moves: 9,
    assist: 0.4,
    targetDucks: 4,
    ducks: [
      { colour: 'red', x: 240, y: 400 },
      { colour: 'red', x: 480, y: 400 },
      { colour: 'green', x: 360, y: 560 },
      { colour: 'yellow', x: 560, y: 620 },
    ],
    barrels: [
      { x: 150, y: 1100, hp: 1 },
      { x: 310, y: 1140, hp: 2 },
      { x: 470, y: 1140, hp: 2 },
      { x: 600, y: 1100, hp: 1 },
    ],
    clams: [
      { x: 170, y: 620 },
      { x: 450, y: 880 },
    ],
    spawnRegion: { x0: 150, y0: 340, x1: 580, y1: 560 },
  },

  // ── 8 ────────────────────────────────────────────────────────────────────
  // THE VAULT. Three crates at y 860, 130 apart centre to centre — 10px of water
  // between their faces, so neither a duck nor the aim guide threads between
  // them — and the right-hand end is sealed too: 114px of water to the wall,
  // where a duck needs 92 of clearance from the wall and 106 from the crate at
  // once. The clam at (360,1010) sits behind all of that, out of blast range of
  // anywhere a duck can stand in front of the wall. The ONE way in is the needle
  // on the far left: between the tub wall and (240,860) a duck's centre can pass
  // through x 92..144, a 52px-wide lane, and the aim guide can follow it. So the
  // level offers a choice — spend three or four shots demolishing the wall, or
  // thread the needle once and take the vault early. The clam at (480,650) is
  // the deflector that makes the second option thinkable.
  //
  // NOTE for future editors: the left lane is not decoration, it is a SAFETY
  // requirement. A wall that fully partitions the tub can strand every duck on
  // the far side with no duck-to-duck line, and since respawns only fire below
  // targetDucks the board can reach a state where no shot is legal at all. Keep
  // a lane open in any level that walls the board across.
  // Budget intent: 6 goals / 10 hits in 9 shots, with the ordering forced.
  {
    name: 'The Vault',
    moves: 9,
    assist: 0.4,
    targetDucks: 4,
    ducks: [
      { colour: 'yellow', x: 180, y: 400 },
      { colour: 'green', x: 360, y: 400 },
      { colour: 'yellow', x: 540, y: 400 },
      { colour: 'green', x: 360, y: 560 },
    ],
    barrels: [
      { x: 240, y: 860, hp: 2 },
      { x: 370, y: 860, hp: 2 },
      { x: 500, y: 860, hp: 2 },
      { x: 180, y: 1120, hp: 2 },
    ],
    clams: [
      { x: 480, y: 650 },
      { x: 360, y: 1010 },
    ],
    spawnRegion: { x0: 150, y0: 330, x1: 590, y1: 570 },
  },

  // ── 9 ────────────────────────────────────────────────────────────────────
  // THE GAUNTLET. A staircase: (180,560) → (360,660) → (540,760) → (360,900),
  // each step ~206..228 from the next, i.e. just OUTSIDE blast reach of its
  // neighbour. A blast never jumps a step by itself; what jumps is the duck it
  // doomed, which drifts a little and detonates where it comes to rest. So
  // clearing this board is about aiming the *knock*, one generation at a time,
  // down the staircase to the hp3 keystone and the two low crates. Lowest assist
  // in the campaign (0.35) — the drift you want is measured in tens of pixels.
  // Budget intent: 6 goals / 11 hits in 7 shots. Only multi-generation chains
  // pay for that; a player trading one shot per hit runs out around the third
  // step, with the bottom row untouched and visible. Cruellest near-miss here.
  {
    name: 'The Gauntlet',
    moves: 7,
    assist: 0.35,
    targetDucks: 5,
    ducks: [
      { colour: 'purple', x: 200, y: 360 },
      { colour: 'purple', x: 520, y: 360 },
      { colour: 'yellow', x: 360, y: 460 },
      { colour: 'red', x: 560, y: 520 },
    ],
    barrels: [
      { x: 180, y: 560, hp: 2 },
      { x: 360, y: 660, hp: 2 },
      { x: 540, y: 760, hp: 2 },
      { x: 360, y: 900, hp: 3 },
      { x: 180, y: 1030, hp: 1 },
      { x: 540, y: 1030, hp: 1 },
    ],
    clams: [],
    spawnRegion: { x0: 150, y0: 320, x1: 590, y1: 490 },
  },

  // ── 10 ───────────────────────────────────────────────────────────────────
  // THE GOLDEN PEARL. Everything the campaign taught, stacked. A lone clam at
  // (360,560) guards the mouth of the board and splits the approach into two
  // 36px-wide lanes. Below it the twin clams at 260 apart repeat level 5's
  // trick, but tighter: the both-at-once lens is only ~73px tall now. Behind
  // those, an hp2 keystone, two hp2 corner crates, and the golden hp3 barrel
  // buried at (360,1130) — five barrel-radii and three clams deep, reachable
  // only once the rest of the board has been dismantled. Because it is last,
  // Director.finaleArmed fires as it becomes the final goal and pushes assist to
  // 0.9, so the ad's closing shot is a guaranteed, gold-showering hit.
  // The three clams are mutually close enough (255, 255 and 260 apart) that ANY
  // pair of them can fall to one perfectly placed pop — three different two-for-
  // one routes, none of them wide. That is the finale's skill ceiling.
  // Budget intent: 7 goals / 12 hits in 11 shots. The intended clear takes two
  // clams with one pop and still arrives at the golden barrel on the last shot.
  {
    name: 'The Golden Pearl',
    moves: 11,
    assist: 0.4,
    // 5: the three clams cut the tub into narrow lanes, so the board wants a
    // healthy duck population to guarantee a legal duck-to-duck line at all times
    targetDucks: 5,
    ducks: [
      { colour: 'green', x: 200, y: 360 },
      { colour: 'green', x: 520, y: 360 },
      { colour: 'red', x: 360, y: 420 },
      { colour: 'yellow', x: 180, y: 470 },
    ],
    barrels: [
      { x: 360, y: 930, hp: 2 },
      { x: 170, y: 1060, hp: 2 },
      { x: 550, y: 1060, hp: 2 },
      { x: 360, y: 1130, hp: 3, golden: true },
    ],
    clams: [
      { x: 360, y: 560, skin: 'baby' },
      { x: 230, y: 780 },
      { x: 490, y: 780 },
    ],
    spawnRegion: { x0: 140, y0: 310, x1: 600, y1: 470 },
  },
];
