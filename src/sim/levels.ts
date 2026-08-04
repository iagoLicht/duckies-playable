import type { Colour } from './types';

/**
 * One board of the campaign. A level is cleared when every barrel is destroyed
 * AND the level's pearl quota has been collected; it is failed when the move
 * budget runs out with goals still standing and the board has come to rest.
 *
 * Clams are not goals — they are the DISPENSERS that serve the pearl quota, and
 * they re-arm after every pearl. So `clams` authors the difficulty of reaching a
 * pearl, and `pearls` authors how many you need.
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
  /**
   * Clams are pearl DISPENSERS, not one-shot goals: each one opens, spills a
   * pearl, shuts and re-arms, so a single clam can service a quota of any size.
   * Placement therefore controls *how hard the pearls are to reach*, and
   * `pearls` controls *how many you need* — the two tune independently.
   */
  clams: Array<{ x: number; y: number; skin?: 'normal' | 'gold' | 'baby' }>;
  /** the level's pearl quota. Must be 0 when there are no clams to spill them. */
  pearls: number;
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

/**
 * The campaign. Every `moves` below is MEASURED, not guessed: run
 *
 *     node tests/tools/tune-levels.mjs --seeds=150      (--level=N for one)
 *
 * which plays the shared distracted-thumb bot (tests/sim/bot.ts) over each board
 * with the budget disabled and prints the shots-used percentiles. The run is
 * deterministic — same seeds, same bot, same numbers — so a percentile quoted in
 * a comment here can be reproduced exactly. Budget policy:
 *
 *  - level 1 (tutorial):    moves = p90 + 1   (must be very hard to lose)
 *  - levels 2-3 (teaching): moves = p90
 *  - levels 4-10:           moves = ceil(p75) — the near-miss band. The bot
 *    clears ~3 runs in 4 inside it; a human aims far better than this bot and
 *    usually lands with a shot or two spare, which is the feeling we want.
 *    Never below p50: that is unwinnable, not tense.
 *
 * Length targets for the board itself: bot p50 <= 9 shots and p90 <= 16. A board
 * that runs longer is a grind, and a grind is not tension.
 *
 * RESOLVED (2026-08-04, the clam-fling pass): the dispenser cycle had briefly
 * pushed levels 4, 7 and 10 to p90 17. Giving the clams a real bumper fling
 * (CLAM_KICK/CLAM_KEEP, replacing the barrels' half-energy reflection) more than
 * paid it back — every clam board is now well inside the ceiling, and the
 * budgets fell hard with them:
 *
 *     level          p90 before -> after     moves before -> after
 *     4 Deflection        17 -> 13                12 -> 9
 *     5 Twin Pearls       16 -> 12                12 -> 8
 *     7 Pinball           17 -> 13                12 -> 9
 *     8 The Vault         14 -> 10                11 -> 8
 *    10 The Golden Pearl  17 ->  7                13 -> 5
 *
 * A duck thrown off a shell now carries enough speed to reach another goal, so
 * shots pay two and three times over. Clam-free boards (1, 3, 6, 9) are byte-for
 * -byte unchanged, which is the control that says the fling is the whole cause.
 *
 * CAVEAT on all five: the tuning bot fires random legal aims, and a hard
 * deflection rewards spray more than it rewards a human aiming one target at a
 * time. These budgets are measured but unplayed; level 10 especially.
 *
 * What the tuning pass established about *shortening* one:
 *
 *  - BARRELS ARE SOFT, so hp is a weak knob in both directions: a launched duck
 *    ricochets and re-hits, and dropping an hp2 to hp1 typically buys under a
 *    shot. Useful, rarely sufficient on its own.
 *  - CLAMS ARE THE DIFFICULTY CURRENCY. They need a direct hit above
 *    CLAM_HIT_SPEED or a blast centred within 135, and neither happens by
 *    accident.
 *  - WHAT ACTUALLY COSTS SHOTS IS DISTANCE AND SHADOW, not hit points. Goals
 *    strung far apart, or parked under a clam that roofs them, are paid for one
 *    at a time. The strongest single fix is to move goals into each other's
 *    blast lens — two crates 120..152 apart, or a crate 175..234 from a clam —
 *    so one well-placed pop retires two. That is how levels 4, 5, 7 and 8 came
 *    down, with their geometry and their lesson intact.
 *  - A goal cluster the ducks cannot REACH is the worst case of all (level 10):
 *    three clams deep, no shot budget survives it. Letting respawns land in the
 *    middle chamber, not just the top shelf, was worth more there than any hp
 *    change.
 */
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
    pearls: 0,
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
  // Budget intent: 2 crates + 2 pearls in 9 shots. The pearl quota is 2 from a
  // SINGLE clam on purpose — this is where the player learns the shell re-opens.
  // A quota of 1 would teach the opposite (hit it once, done) and every later
  // level would then contradict the lesson. Still a teaching board, so the budget
  // is the measured p90 — nine runs in ten of a mediocre bot fit inside it. A
  // player who spends two shots pinballing off the clam without cracking it will
  // notice the counter; a player who spends five will still get there.
  {
    name: 'Pearl Diver',
    moves: 9,
    // 2 from the single clam: the teaching level for the dispenser, so it has to
    // show the shell RE-OPENING. One pearl would teach the old one-shot rule.
    pearls: 2,
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
    pearls: 0,
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
  // CLAMS AS DEFLECTORS. The two wall barrels are shoved right up against the
  // side walls at y 640, in the dead angle where a straight duck-to-duck shot
  // from the spawn shelf can't reach them — but the high clam at (300,640) sits
  // on the line to the left one, and the low clam at (430,900) kicks anything
  // that grazes it out toward the right wall. Both clams are goals themselves,
  // so the deflector you need is also the thing you must destroy: crack them too
  // early and you lose the aiming furniture (they stay solid, but the pearl and
  // the counter are gone and the level's remaining slack goes with it).
  //
  // REBALANCE: the wall crates are hp1. They were hp2 and the dead angle made
  // every second hit cost a whole shot — a tax the level charged twice for the
  // same idea. Their awkward position IS the lesson; paying for it once is
  // enough. The low pair also moved up off the floor to y1050, close enough that
  // the low clam's blast lens overlaps both (175 and 234 apart, so a pop placed
  // between clam and crate retires two goals) — the deflector now pays out.
  // Budget intent: 4 crates + 3 pearls in 9 shots (measured p75). Three pearls
  // from two clams, so at least one shell has to be worked twice. The budget
  // fell 12 -> 9 when the clams got their bumper fling: a duck thrown off a
  // shell now carries enough speed to reach a second goal, so shots pay twice.
  {
    name: 'Deflection',
    moves: 9,
    pearls: 3,
    assist: 0.45,
    targetDucks: 4,
    ducks: [
      { colour: 'red', x: 180, y: 400 },
      { colour: 'red', x: 540, y: 400 },
      { colour: 'yellow', x: 360, y: 480 },
      { colour: 'purple', x: 230, y: 540 },
    ],
    barrels: [
      { x: 150, y: 640, hp: 1 },
      { x: 590, y: 640, hp: 1 },
      { x: 250, y: 1050, hp: 1 },
      { x: 520, y: 1050, hp: 1 },
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
  //
  // REBALANCE: the corridor is untouched — it is the level — but the reward got
  // cheaper to collect. The three crates are all hp1 now and sit 120 apart at
  // 240/360/480, so a pop that settles above a gap (e.g. (300,990), 117 from
  // each of two crates) takes a PAIR. Punching through used to buy you four
  // more hits spread across the floor; it now buys the floor in two pops.
  // Budget intent: 3 crates + 4 pearls in 12 shots — two full serves from each
  // clam, which is what earns the name. Doing them one at a time is survivable
  // but leaves almost nothing for the barrels — that is the near-miss. (Pearls
  // are the real difficulty currency: a clam needs a direct fast hit or a blast
  // centred within 135, where a barrel just needs to be bumped.)
  {
    name: 'Twin Pearls',
    moves: 8,
    pearls: 4,
    assist: 0.45,
    targetDucks: 3,
    ducks: [
      { colour: 'green', x: 200, y: 420 },
      { colour: 'yellow', x: 520, y: 420 },
      { colour: 'green', x: 520, y: 560 },
      { colour: 'red', x: 200, y: 600 },
    ],
    barrels: [
      { x: 240, y: 1090, hp: 1 },
      { x: 360, y: 1090, hp: 1 },
      { x: 480, y: 1090, hp: 1 },
    ],
    clams: [{ x: 240, y: 720 }, { x: 480, y: 720 }],
    spawnRegion: { x0: 140, y0: 340, x1: 580, y1: 580 },
  },

  // ── 6 ────────────────────────────────────────────────────────────────────
  // ARMOUR. Two hp3 crates in the upper shoulders, an hp2 keystone dead centre,
  // two hp1 stragglers low. Ten hits, eight shots: this cannot be brute-forced
  // one hit per shot, so the level is really asking "can you get a blast to
  // count twice?". The keystone at (360,900) is 256 from each hp3 — out of blast
  // range from either — but a duck that settles at roughly (330,790) is inside
  // BLAST_R of the keystone *and* of the left hp3. Finding those double-dip
  // positions three or four times over is the solve.
  // Budget intent: 5 goals / 10 hits in 8 shots — still the sharpest
  // hits-per-shot demand in the campaign, and the armour needed no rebalancing:
  // this board already measured inside the length targets, so only the budget
  // moved (to the measured p75, the near-miss band). Assist drops to 0.4 because
  // this is the first level that punishes a shot landing 40px off.
  {
    name: 'Ironclad',
    moves: 8,
    pearls: 0,
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
  //
  // REBALANCE: all four crates are hp1 and pulled into a chain along the lip —
  // 150/300/420/570, so every ADJACENT pair is 120..152 apart and one pop placed
  // above a gap (e.g. (360,1010), 125 from both middle crates) takes two. A bank
  // shot that arrives sideways now pays for two goals instead of chipping one
  // crate twice, which is the fantasy the level was already selling.
  // The low clam moved up from y880 to y800: sitting directly over the lip it
  // shadowed the whole floor, and the bot burned shots bouncing off it into
  // nothing. At 800 it still deflects into the right bumper — it just no longer
  // roofs the crates it is supposed to feed.
  // Budget intent: 4 crates + 4 pearls in 12 shots (measured p75; was 11 before
  // the clams became dispensers), and at least two of those hits really do want
  // to arrive sideways.
  {
    name: 'Pinball',
    moves: 9,
    pearls: 4,
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
      { x: 300, y: 1120, hp: 1 },
      { x: 420, y: 1120, hp: 1 },
      { x: 570, y: 1100, hp: 1 },
    ],
    clams: [
      { x: 170, y: 620 },
      { x: 450, y: 800 },
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
  //
  // REBALANCE: the wall's GEOMETRY is untouched — 240/370/500 at y860, the same
  // 10px of water between faces, the same sealed right end, the same 52px needle
  // on the left. Only its price changed: the two end crates and the low corner
  // crate are hp1, and the keystone at 370 keeps hp2 so the middle of the wall is
  // still the expensive way in. Demolishing the wall used to cost six hits, and
  // at that price it was no choice at all — you smashed, because you could not
  // afford anything else. At four, "smash it" and "thread it" are genuinely
  // competing plans, which is what the level is about.
  // Budget intent: 4 crates + 3 pearls in 11 shots, with the ordering forced.
  {
    name: 'The Vault',
    moves: 8,
    pearls: 3,
    assist: 0.4,
    targetDucks: 4,
    ducks: [
      { colour: 'yellow', x: 180, y: 400 },
      { colour: 'green', x: 360, y: 400 },
      { colour: 'yellow', x: 540, y: 400 },
      { colour: 'green', x: 360, y: 560 },
    ],
    barrels: [
      { x: 240, y: 860, hp: 1 },
      { x: 370, y: 860, hp: 2 },
      { x: 500, y: 860, hp: 1 },
      { x: 180, y: 1120, hp: 1 },
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
  // Budget intent: 6 goals / 11 hits in 8 shots. Only multi-generation chains
  // pay for that; a player trading one shot per hit runs out around the fourth
  // step, with the bottom row untouched and visible. Cruellest near-miss here.
  // The staircase measured inside the length targets untouched — 8 is its p75.
  {
    name: 'The Gauntlet',
    moves: 8,
    pearls: 0,
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
  // those, a keystone, two corner crates, and the golden barrel buried at
  // (360,1130) — five barrel-radii and three clams deep, reachable only once the
  // rest of the board has been dismantled. Because it is last,
  // Director.finaleArmed fires as it becomes the final goal and pushes assist to
  // 0.9, so the ad's closing shot is a guaranteed, gold-showering hit.
  // The three clams are mutually close enough (255, 255 and 260 apart) that ANY
  // pair of them can fall to one perfectly placed pop — three different two-for-
  // one routes, none of them wide. That is the finale's skill ceiling.
  //
  // REBALANCE: this board was the campaign's worst grind by a distance (bot p50
  // 16, p90 30) and the reason was ACCESS, not armour. Everything worth shooting
  // sits below three clams, respawns only ever landed on the top shelf, and shot
  // after shot was spent re-arranging ducks that could not reach the cellar.
  // Cutting hp alone did not fix it: 12 hits down to 8 still measured p90 22,
  // and even 7 hits with no keystone sat at p90 19. Two other changes did:
  //  - the spawn region now reaches y700, into the middle chamber between the
  //    guard clam and the twins, so the board keeps feeding ducks to the side of
  //    the maze that still has work left. This was worth more than every hp
  //    change put together.
  //  - targetDucks 6 (was 5) for the same reason: more ducks, more legal lines
  //    through 36px lanes.
  // The clam triangle is untouched — it IS the level — and so is the golden
  // barrel's burial spot. Every crate is now hp1, the golden included: with
  // finaleArmed at assist 0.9 the closing shot lands, and one hit ends the ad on
  // the gold shower rather than three.
  // Budget intent: 4 crates + 6 pearls in 5 shots — the campaign's largest quota
  // off its smallest budget, and by far the densest board.
  //
  // That budget is the measured p75 and it moved 13 -> 5 in one pass, entirely
  // from the clams' bumper fling. Three clams in narrow lanes is the worst case
  // for a hard deflection: a duck thrown off one shell reaches another, triggers
  // it, and is thrown again, so a single shot can serve three or four pearls.
  // Clam activations did not change (6.8 either way) — the shots to get them
  // halved. p50 fell 8 -> 4.
  //
  // FLAGGED, not settled: this makes the finale the SHORTEST board in the
  // campaign, after an 8-shot Gauntlet, which is odd pacing for a climax. It is
  // also the level where the tuning bot's random spray benefits most from the
  // fling, so its shot count may flatter a bot over a human who aims one clam at
  // a time. Wants human play-testing before the number is trusted; if it plays
  // too easy the honest fix is a harder board, not a tighter budget.
  {
    name: 'The Golden Pearl',
    moves: 5,
    pearls: 6,
    assist: 0.4,
    // 6: the three clams cut the tub into narrow lanes, so the board wants a
    // healthy duck population to guarantee a legal duck-to-duck line at all times
    targetDucks: 6,
    ducks: [
      { colour: 'green', x: 200, y: 360 },
      { colour: 'green', x: 520, y: 360 },
      { colour: 'red', x: 360, y: 420 },
      { colour: 'yellow', x: 180, y: 470 },
    ],
    barrels: [
      { x: 360, y: 930, hp: 1 },
      { x: 170, y: 1060, hp: 1 },
      { x: 550, y: 1060, hp: 1 },
      { x: 360, y: 1130, hp: 1, golden: true },
    ],
    clams: [
      // NOT the 'baby' skin: its shell art is 124x131 against the 112px
      // collision diameter every clam has, so a baby clam bounces ducks and
      // stops the aim guide ~20px out in open water. Until CLAM_R is per-skin,
      // only 'normal' and 'gold' (198x188) match the hitbox.
      { x: 360, y: 560 },
      { x: 230, y: 780 },
      { x: 490, y: 780 },
    ],
    // reaches down past the guard clam into the middle chamber: freeSpot() keeps
    // every sample a duck-radius clear of the clams, so the extra band is real
    // water, not a hole the respawn drops ducks into
    spawnRegion: { x0: 140, y0: 310, x1: 600, y1: 700 },
  },
];
