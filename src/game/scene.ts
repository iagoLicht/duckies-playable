import { Application, Container, Graphics, Rectangle, Sprite, Text, Texture } from 'pixi.js';
import {
  Skin, type Attachment, type Color, type SkeletonData, type Spine, type TrackEntry,
} from '@esotericsoftware/spine-pixi-v8';
import { Director } from '../sim/director';
import { LEVELS } from '../sim/levels';
import { SIM } from '../sim/config';
import type { AimPreview } from '../sim/trajectory';
import type { Barrel, Clam, Colour, Duck, SimEvent } from '../sim/types';
import { SpinePool, loadSkeleton, makeSpine } from '../engine/spineLoader';
import { Audio, impactGain } from './audio';
import { AD_SCRIPT, outcomeFor, STORE_URL, type Outcome } from './flow';
import { IdleDemo } from './idleDemo';
import {
  buildEndCard, loadEndCardTextures, showEndCard,
  type EndCardOpts, type EndCardTextures, type PreparedEndCard,
} from './endCard';
import { DESIGN_H, DESIGN_W } from './layout';
import type { StageLayers } from './stage';

import duckySkelUrl from '../assets/entities/ducky/ducky.skel';
import duckyAtlasText from '../assets/entities/ducky/ducky.atlas?raw';
import duckyPageUrl from '../assets/entities/ducky/ducky.webp';
import crateSkelUrl from '../assets/entities/crate-round/crate-round.skel';
import crateAtlasText from '../assets/entities/crate-round/crate-round.atlas?raw';
import cratePageUrl from '../assets/entities/crate-round/crate-round.webp';
import oysterSkelUrl from '../assets/entities/oyster/oyster.skel';
import oysterAtlasText from '../assets/entities/oyster/oyster.atlas?raw';
import oysterPageUrl from '../assets/entities/oyster/oyster.webp';
import pearlUrl from '../assets/entities/oyster/pearl.webp';
import handJsonUrl from '../assets/entities/tutorial-hand/tutorial-hand.json?url';
import handAtlasText from '../assets/entities/tutorial-hand/tutorial-hand.atlas?raw';
import handPageUrl from '../assets/entities/tutorial-hand/tutorial-hand.webp';
import starUrl from '../assets/vfx/impact-star.webp';
import blobUrl from '../assets/vfx/explode-particle.webp';
import trailUrl from '../assets/vfx/trail-noise-short.webp';
// ── the pack textures the asset audit put back, one switch each: see
// OFFICIAL_SPLASH_RING, OFFICIAL_DEBRIS and OFFICIAL_AIM_TIP below ──────────
import domeUrl from '../assets/vfx/dome.webp';
import ptxStarsUrl from '../assets/vfx/ptx-stars.webp';
import aimArrowUrl from '../assets/vfx/aim/aim-fire-arrow.webp';
import aimDotUrl from '../assets/vfx/aim/aim-dot.webp';
import touchBgUrl from '../assets/vfx/aim/aim-touch-bg.webp';
import touchFrontUrl from '../assets/vfx/aim/aim-touch-front.webp';
import iconXUrl from '../assets/ui/icon-x.webp';
import goalIconUrl from '../assets/icons/goal-Barrel.webp';
import clamIconUrl from '../assets/icons/goal-Bumper.webp';
import avatarUrl from '../assets/ui/hud-avatar.webp';
import asapBlackUrl from '../assets/fonts/asap-black.woff2';

/**
 * ══ THE ASSET-AUDIT VFX SWAPS — ONE SWITCH EACH ══════════════════════════════
 *
 * Each swaps a hand-drawn effect for the Candivore pack's own art. Setting one
 * to `false` puts that drawn original back, with nothing else to undo.
 *
 * THREE SWITCHES RATHER THAN ONE, because the A/B came back split. Both states
 * of all three were captured in the running game — see shots/probe-official-
 * vfx.mjs, and the pairs it wrote to shots/vfx-{on,off}-*.png. The drawn
 * originals were each traced from real-game footage rather than guessed, so
 * "it is the official asset" does not settle the question, and two of the three
 * measured plainly worse on the water:
 *
 *   AIM_TIP  the wedge is a solid WHITE tail that begins under the duck and
 *            fuses with its white base ring. The pack chevron is a small
 *            DETACHED mark in the pack's aim yellow, which against a yellow
 *            duck all but vanishes — and the wedge marks where the struck duck
 *            DEPARTS, which is not the job a line-tip chevron was drawn for.
 *            Two different signals, not two drawings of one. Off.
 *   RING     `dome` is a soft filled gradient (73% of its pixels are partial
 *            alpha, measured) authored as a shockwave seen in perspective.
 *            Dropped into a flat top-down cartoon it hazes the splash into a
 *            misty bubble, where the drawn 7px stroke gives the crisp lace ring
 *            the footage actually shows. Off.
 *   DEBRIS   the one that held up. `ptx-stars` is the sheet authored for
 *            scattering; impact-star is a single hero flash that was being used
 *            six at a time to stand in for it. On.
 *
 * TEMPORARY SCAFFOLDING. Once a call is settled, delete the losing branch and
 * its flag — a permanent pair of code paths for a decided question is two
 * things to keep working instead of one. Every guard carries its flag's name in
 * a comment, so the branch to delete is greppable.
 *
 * All three are annotated `boolean` rather than left to infer their literal
 * type: without it TypeScript narrows each guard to the live branch, stops
 * checking the dead one, and flipping a switch would surface errors that had
 * been sitting there all along.
 */
const OFFICIAL_AIM_TIP: boolean = false;
const OFFICIAL_SPLASH_RING: boolean = false;
const OFFICIAL_DEBRIS: boolean = true;

/**
 * Tint applied to the chevron. Pixi's tint MULTIPLIES, so 0xffffff is "leave it
 * alone" and the arrow arrives in its authored yellow (#ffee37, measured off
 * the source) — the pack's own aim colour, which the white `aim-dot` line is
 * built to end in.
 *
 * Named, because the colour is the swap's single biggest visual risk and is
 * worth judging separately from the shape: the drawn wedge was WHITE and
 * deliberately fused with the duck's own white base ring, so a yellow tip
 * changes what the marker reads as, not just what it looks like. A multiply can
 * only darken — 0xffc000 pushes it amber, 0x8899ff to a cool grey-blue — so if
 * the verdict is "right shape, wrong colour, make it white", that is a
 * re-export of the source rather than a number here.
 */
const ARROW_TINT = 0xffffff;

const DUCK_SCALE = 0.9;
const BARREL_SCALE = 0.85;
/**
 * The oyster rig's SHELL art (its `base` attachment) is 198x188 — the rig's
 * 126x155 "size" is only the Spine editor viewport, and scaling to that reads
 * half again too big on the water. This puts the shell at ~115px across, a
 * shade over its 112px collision diameter, the same slight overhang the crate
 * and duck art carry over their own bodies.
 */
const CLAM_SCALE = 0.58;

const COLOURS: readonly Colour[] = ['yellow', 'green', 'purple', 'red'];
const TINTS: Record<Colour, number> = {
  yellow: 0xffd94d, green: 0x5cc80e, purple: 0xa44aed, red: 0xec273f,
};
/** the same hues pulled nearly all the way to white — the reference frame's
 *  splash is white with only a whisper of the popped body's hue, and anything
 *  more saturated reads as a grubby smear against the blue water */
const BURST_TINTS: Record<Colour, number> = (() => {
  const wash = (c: number): number => {
    const ch = (sh: number): number => {
      const v = (c >> sh) & 0xff;
      return Math.round(v + (255 - v) * 0.85) << sh;
    };
    return ch(16) | ch(8) | ch(0);
  };
  return { yellow: wash(TINTS.yellow), green: wash(TINTS.green), purple: wash(TINTS.purple), red: wash(TINTS.red) };
})();

// Duck spine tracks. The body idle, the selection ring and the ring's slow spin
// drive disjoint bones/slots, so they layer cleanly on separate tracks.
const T_BODY = 0;
const T_RING = 1;
const T_SPIN = 2;
/** looping water ripple under every duck, always on (official: track 2) */
const T_RIPPLE = 3;
/**
 * The rig's `glow` on the duck the aim is resting on. It gets its own track
 * because it must layer OVER whatever the body is doing: measured, `glow` is
 * four timelines and they drive nothing but the `head-glow`/`body-glow` slots
 * (attachment on, then an alpha pulse 0.48 -> 0.69 -> 0.48 over its 1s loop),
 * so it collides with nothing else on the skeleton.
 */
const T_GLOW = 4;
/** how long the glow takes to fade once the aim leaves the duck */
const GLOW_FADE = 0.12;
/**
 * One-shot spawn_enter as a duck's view appears (official: track 22). It MUST
 * be mixed back out when it finishes: a completed non-looping track keeps
 * applying its final frame, and this one keys `master` + the `head*` bones —
 * held, it would outrank and freeze idle, jump, dance and the aim recoil.
 *
 * (An earlier note here claimed the rig's `turn` anim is invisible on plain
 * colour skins — that a duck at 0° and at 180° renders identically. It does
 * not: rendered against the real combined skin, t=3 shows the back of the head
 * with no eyes and no beak. `turn` is a genuine facing turntable and drives the
 * held duck's aim facing, see TURNTABLE_BONE and setTurn. It is a per-pull
 * track swap, not an always-on one, so the idle bob, match jump, dance and ring
 * spin all still have track 0 whenever nobody is aiming.)
 */
const T_SPAWN = 22;
// a spawning duck enters with a Back.easeOut scale-up from ~zero plus a small
// white star splash. (The official also staggered the views 55ms apart; we
// don't — see drainSpawnQueue.)
//
// This is not decoration, it is a GATE: boardReady() withholds the slingshot
// until every spawning duck has finished growing, so the number is the last
// slice of the wait between a turn ending and the next one starting. 300ms →
// 200ms for the ad (user-locked 2026-08-08), alongside the sim-side cuts to
// RESPAWN_DELAY and the fuse. Back.easeOut overshoots and settles, so the duck
// is at readable size well before the end of it — 200ms keeps the pop of the
// overshoot and drops the tail the player was waiting through.
const SPAWN_SCALE_TIME = 0.2;
/** a random settled duck dances every 2.8s (official idle-flavor timer) */
const DANCE_PERIOD = 2.8;
// The MINIMUM the cleared/failed beat gets before the board swaps or the card
// goes up. A floor, not the whole wait: applyOutcome holds past it until the
// board has actually finished resolving — see afterSettled.
const LEVEL_ADVANCE_DELAY = 1.8;
const LEVEL_RETRY_DELAY = 1.4;
/**
 * How long the board must hold still before the result is allowed to land.
 *
 * A chain is not one event, it is generations: a pop dooms its neighbours, and
 * between the bang and the next fuse catching there can be a frame or two with
 * nothing in flight. Requiring the stillness to PERSIST is what stops the card
 * dropping into one of those gaps. 0.4s was lifted from the sim's own answer to
 * the same question, BLAST_SETTLE_CONFIRM_TICKS. The two have since parted: the
 * ad pacing pass cut the sim's hold to 10 ticks because it is paid on every
 * generation of every chain, whereas this one is paid ONCE per level. There is
 * nothing to gain by shaving it and a real cost if a chain's between-generation
 * gap ever grows past it, so it stays at 0.4s as an independent number.
 */
const RESULT_SETTLE_HOLD = 0.4;
/**
 * …and the wait gives up here regardless. AN AD WHOSE CARD CAN FAIL TO APPEAR IS
 * A DEAD AD — flow.ts's rule, and it outranks every nicety above: a board that
 * somehow never comes to rest must still reach the store link.
 *
 * Set above the worst chain the sim can actually produce, so a legitimate one
 * can never trip it and land the card mid-motion — which would be the very bug
 * this wait exists to fix. A chain is at most one generation per duck on the
 * board (5), the first costing a full MATCH_FUSE_TICKS (0.60s) and the rest at
 * most the same: 3.0s, plus RESPAWN_DELAY, the spawn scale-up and the hold
 * above, ~3.8s. The ad pacing pass more than halved that budget; the cap is left
 * at twelve deliberately. It is a LAST RESORT against a board that never rests,
 * not a pacing knob — no legitimate run gets near it either way, and lowering it
 * only buys a bigger chance of guillotining a real chain mid-motion.
 */
const RESULT_SETTLE_CAP = 12;

// Clam spine tracks. The shell owns track 0, and its whole state machine is
// `idle` -> `bump` -> `idle`: it sits awake and open-eyed, and a hit costs it
// 0.30s of jolt-and-blink before it is back. The rig's shut poses (`inactive`,
// `bump-inactive`) are not in that loop at all — see addClam. The water ring
// loops forever beside it, the same split the ducks use.
const CT_SHELL = 0;
const CT_RIPPLE = 1;

// ── the duck's facing ───────────────────────────────────────────────────────
// The rig carries a `turn` animation that sweeps the duck through a FULL 360
// degrees over its 12s: measured by parsing the .skel, the head bone's world
// rotation runs 90deg at t=0 through 180 at t=3, 270 at t=6 and 0/360 at t=9,
// i.e. exactly 30 deg/s, linear and wrapping. `idle` by contrast never rotates
// it at all, which is why every duck used to stare straight at the camera
// whichever way it was aimed.
//
// So the facing is not animated, it is SCRUBBED: the track is pinned at
// timeScale 0 and its trackTime is set from the aim angle every frame.
// Verified against pixels at four quarter-turns — t=3 genuinely shows the
// duck's back, with no face at all.
const TURN_DEG_PER_SEC = 30;
/**
 * Screen aim angle -> `turn` trackTime. The rig turns the opposite way to
 * screen-space (its y is up, the stage's is down), so the angle is negated —
 * which is the same negation `aimBoneRot` already applies for the teardrop, and
 * this takes that value directly rather than recomputing it.
 */
const turnTimeFor = (rigDeg: number): number =>
  (((rigDeg % 360) + 360) % 360) / TURN_DEG_PER_SEC;
/** the official's bumper-hit burst tint on this rig */
const CLAM_TINT = 0xFFB0D9;
// the pearl the shell spills: a quick Back.easeOut pop, a lift clear of the
// shell's top rim (~55px above centre), then the flight to the HUD counter.
const PEARL_POP_TIME = 0.25;
const PEARL_RISE = 66;
const PEARL_RISE_TIME = 0.45;

/** Phaser's Back.easeOut, used by the official spawn pop-in */
const backOut = (t: number): number => {
  const s = 1.70158;
  const u = t - 1;
  return 1 + (s + 1) * u * u * u + s * u * u;
};
/**
 * How long the popped duck's own rig stays. explode_vfx is authored at 0.17s,
 * but the real-game footage cuts the duck's remains ~3 frames (~100ms) after
 * the splash pancake lands (Explosion.mp4 f118 -> f121) — held longer, the
 * shrinking body squats on top of the splash's star hole and muddies it.
 */
const POP_TIME = 0.11;

// ── the pop splash, traced from real-game footage (Explosion.mp4 f118-f127,
// 30fps). The rig's explode_vfx only bursts the DUCK — the water answer is a
// separate effect: an opaque white pancake snaps up under the duck (2 frames),
// a water-blue star-shaped hole opens mid-disc while duck-coloured chips
// scatter, then the disc dissolves into white lace — a thin ring, X-cross
// spokes and droplets — that swells a touch and fades. ~0.3s all told.
// The star hole is drawn, not sampled: the shipped ssa-explosion sheet holds a
// soft shader-gradient star that never crispens into the footage's flat
// cartoon cutout, so the shape is traced from the frames instead.
const SPLASH_R = 92;            // pancake radius: video shows 2.0x the duck body
const SPLASH_WATER = 0x46c8ee;  // the tub water sampled where the star punches through
const SPLASH_GROW = 0.066;      // f118-f119: pancake reaches full size
const SPLASH_STAR_AT = 0.066;   // f120: the star hole starts opening…
const SPLASH_STAR_TIME = 0.1;   // …and is fully open by f122
const SPLASH_LACE_AT = 0.166;   // f123: pancake -> lace
const SPLASH_TIME = 0.3;        // f127: gone
const SPLASH_CHIPS = 6;
// ── OFFICIAL_SPLASH_RING: `vfx/dome` in place of the lace's drawn ring ──────
// The manifest calls dome a "scale-up shockwave ring on impact", which is the
// motion the lace ring already performs (swell 12%, fade). Only the RING is
// replaced — the X-cross spokes, the droplets and the speckles are separate
// features of the footage and stay drawn.
//
// THE SOURCE IS 403x325 AND THIS DRAWS IT SQUARE, i.e. stretched ~24% on the
// vertical. Deliberate: dome is authored as a shockwave seen in perspective,
// and this game is straight top-down, where the same ring is a circle. Drawn at
// its native aspect it reads as an ellipse lying on the water. If the stretch
// shows, that is the argument for keeping the drawn ring, not for a new number.
const DOME_R = SPLASH_R;
// ── OFFICIAL_DEBRIS: `vfx/ptx-stars` in place of impact-star as the debris ──
// A 256x128 sheet of TWO 128x128 sparkles — a fat four-point star and a thinner
// one (mapped by alpha, not by guessing: each fills its own half edge to edge).
// The manifest calls it the "multi-star confetti sheet … twinkle sparkle on
// pop", i.e. the asset actually authored for scattering, where impact-star is
// the single hero flash and was being pressed into service six at a time.
const PTX_FRAME = 128;
const PTX_FRAMES = 2;

// ── pop feel, lifted from the official example (decomp GameScene.onPop) ──────
/** additive flash: their duck-tinted `foam` image, 30 -> 70 px over 220ms QuadOut */
const FLASH_R0 = 15, FLASH_R1 = 35, FLASH_TIME = 0.22, FLASH_ALPHA = 0.75;
/** their `time2.freeze(scene, 40)` — 40ms of dead sim while the vfx play on */
const HITSTOP = 0.04;
/** their `cameras.main.shake(70, 0.003)`; Phaser scales intensity by camera size */
const SHAKE_TIME = 0.07, SHAKE_INTENSITY = 0.003;
/** their `hit()`: 1.22x scale punch over 100ms, yoyo, Quad.easeOut */
const PUNCH_SCALE = 1.22, PUNCH_TIME = 0.1;
/** their match burst is the pop burst at 0.7 */
const MATCH_BURST = 0.7;
/**
 * How far a fuse blink pulls the duck's hue toward white. The official goes
 * all the way (1 = flat-white silhouette, decomp syncMatchFlash); deliberately
 * softened here so the pulse reads as a warning while the duck stays clearly
 * its own colour. Timing/cadence of the blink is untouched — only intensity.
 */
const MATCH_FLASH_MIX = 0.35;

// ── motion wake ──────────────────────────────────────────────────────────────
// The OFFICIAL duck wake, verbatim (decomp In.syncWake/makeWake at 90 px/unit):
// while a duck moves faster than 3 u/s — however it got moving — a soft
// radial-gradient foam puff is dropped 0.2u BEHIND it (along −velocity), at
// most one per frame and only after 0.4·radius of travel. Each puff lives
// 300ms, shrinking to half size and fading 0.9 -> 0 linearly, normal blend,
// with a whisper of random drift (Phaser's speed 0-10). Distance-gated, so the
// wake follows launches, bounces, blast shoves and collision knocks alike and
// stops by itself with the duck; killWake takes the leftovers out with a pop.
const WAKE_MIN_SPEED = 270;             // 3 u/s
const WAKE_SPACING = 0.4 * SIM.DUCK_R;  // px of travel between puffs
const WAKE_BACK = 18;                   // 0.2 u — the puff lands this far behind
const WAKE_LIFE = 0.3;                  // s
const WAKE_D0 = 3.8 * SIM.DUCK_R;       // birth length: their 64px foam at scale ppu·r·3.8/64
const WAKE_SHRINK = 0.5;                // scale end = start/2
const WAKE_DRIFT = 10;                  // px/s max random per-puff drift
const WAKE_MAX_PUFFS = 64;              // safety cap (the official has none; Phaser pools)
/**
 * The pack's own trail texture, per its manifest entry: "Tileable noisy streak
 * for motion trails behind launched ducks. Sells speed in the shooter loop."
 * (priority: core.) It replaces the generated round foam puff.
 *
 * It is a 191x77 greyscale streak WITH an alpha falloff — grey noise 0..255,
 * alpha mostly opaque with soft ends — so it is composited ADDITIVELY: drawn
 * normally its dark half would smear grey over the water, where additively the
 * dark half contributes nothing and only the bright streaks register. That is
 * what the texture is authored for.
 *
 * Being a streak rather than a disc, it is laid ALONG the duck's heading and
 * keeps its own 191:77 aspect instead of being forced square.
 */
const WAKE_ASPECT = 77 / 191;
/**
 * Birth alpha, then linear to 0. Deliberately low: this is a wake, not an
 * effect you should notice — at 0.9 (the round puff's value) an additive noise
 * streak reads as a bright smear that competes with the ducks.
 */
const WAKE_ALPHA = 0.22;

const quadOut = (t: number): number => 1 - (1 - t) * (1 - t);

// aim visuals. Spacing/start/crawl are the official example's (0.4/0.42 ppu,
// 100 px/s); the dot size is the REAL game's — the reference video shows small
// ~11px dots of constant size, not the example's shrinking 18px discs.
const DOT_SPACING = 36;
const DOT_START = 38;
// the pool covers the post-collision carom leg as well as the way in, AND the
// outgoing ghost tail that overlaps it mid-morph, so it is sized for the longest
// path the tub can produce plus a full bounce leg on top. A long aim used to
// simply run out of dots partway; running out mid-morph would pop the very
// transition the ghost exists to smooth.
const DOT_MAX = 96;
const DOT_CRAWL = 100; // px/s
const DOT_SIZE = 11;
/**
 * Deflection wedge geometry, in duck-radii along the deflect axis: base centre,
 * the control waist, and the tip.
 *
 * Originally traced whole from the reference video (wallBounce-HowToAim.mp4) at
 * BASE 0.85 / WAIST 1.5 / TIP 2.3. The tip has since been pulled in to 2.05 and
 * the base narrowed (user-requested 2026-08-07): the traced arrow read as too
 * long and too wide over our art, so the whole wedge is a sixth smaller than the
 * trace while keeping its proportions.
 *
 * THE BASE DOES NOT MOVE. It is tucked UNDER the duck — this layer draws below
 * the ducks, so the wide end fuses with the duck's own white base ring — and
 * sliding it along the axis would break that join rather than shorten anything
 * you can see. Length comes off the tip, which is the visible end.
 *
 * WAIST TRACKS THE TIP. It is not an independent number: at the traced values it
 * sat (1.5-0.85)/(2.3-0.85) = 0.448 of the way from base to tip, and that
 * fraction is what gives the edges their concavity. Held at 1.5 against a
 * shorter tip it would drift to two-thirds of the way along and flatten them, so
 * it is placed FROM the fraction and re-derives whenever the tip moves.
 */
const DEFLECT_BASE = 0.85;
const DEFLECT_TIP = 2.05;
/** where the control waist sits between base and tip — the traced 0.448 */
const DEFLECT_WAIST_F = 0.448;
const DEFLECT_WAIST = DEFLECT_BASE + DEFLECT_WAIST_F * (DEFLECT_TIP - DEFLECT_BASE);
/**
 * Base half-width. 0.6 is the traced value; 0.5 is the narrowing above — 46px
 * across the base rather than 55.2px.
 *
 * The waist controls are expressed as a FRACTION of this (DEFLECT_PINCH), and
 * everything along the deflect axis is independent of it, so changing this one
 * number slims the whole silhouette in proportion and leaves the direction, the
 * angle, the length and the concavity of the edges exactly where they were.
 */
const DEFLECT_BASE_W = 0.5;
const DEFLECT_PINCH = 0.35;
// ── OFFICIAL_AIM_TIP: the pack chevron in place of the drawn wedge ──────────
// `vfx/aim/aim-fire-arrow` — 52x76, art at x2..49 / y2..73, pointing +x. The
// manifest's aim entry names it as the tip of the dotted line the aim-dots
// already draw ("Rebuild the dotted aim line from aim-dot + aim-fire-arrow"),
// so the two halves of that instruction finally come from the same set.
//
// NOT a like-for-like, and worth watching for: the wedge was a solid tail that
// started UNDER the duck at 0.85R and fused with its white base ring. A chevron
// is an end-of-line marker — it floats clear of the duck, which is the idiom it
// was drawn for, but it does mean the join the wedge had is gone.
const ARROW_SRC_W = 52, ARROW_SRC_H = 76;
/** the art's point in source px — used as the anchor, so `position` IS the tip */
const ARROW_POINT_X = 50;
/** across the deflect axis, in duck-radii. Matches the wedge's base width. */
const ARROW_ACROSS = DEFLECT_BASE_W * 2;
/**
 * How long the guides take to morph when the prediction changes branch — the aim
 * sliding on or off a duck, or onto a different one.
 *
 * That flip is a genuine discontinuity in the geometry, not a rendering artefact:
 * a lane that stopped at a duck suddenly runs on to the wall and picks up a whole
 * bounce leg. Nothing about the physics can be smoothed to hide it, so the VIEW
 * carries the transition — the old tail fades out along its own path while the
 * new one fades in along its own, and the shared stretch nearer the shooter is
 * left alone. Short enough to feel immediate, long enough not to read as a snap.
 */
const AIM_MORPH_TIME = 0.13;

/** an aim polyline flattened for arc-length walking */
interface AimPath {
  segs: Array<{ x0: number; y0: number; ux: number; uy: number; len: number }>;
  total: number;
}
// the red contact crescent on the aimed-at duck (reference video): the rig-pack
// aim-touch pills, white bg + red-tinted front, ~33px along the duck's rim
const CRESCENT_COLOR = 0xE8354A; // the pack's marker red, matching icon-x
/**
 * The refused-aim X: the pack's own `ui/icon-x` art (43x49, #F12A45 on a dark
 * rim) in place of the two red strokes this used to draw itself.
 *
 * Sized by HEIGHT, not by scale, so the 43x49 source keeps its aspect and the
 * marker's on-screen size stays fixed if the art is ever re-exported. 52px is
 * what the drawn cross measured — 40px of diagonal reach plus its 12px round
 * cap — so the marker lands at the weight players already had.
 */
const AIM_X_H = 52;
const CRESCENT_SCALE = 0.55; // 60px-tall pill -> ~33px
/**
 * The rig's aim assembly root: rotating it swings the whole sling — teardrop
 * (tip authored along +x) AND the duck's pull-back recoil (master, authored -x)
 * — toward the launch direction. The `aim` anim itself is a STRETCH TIMELINE:
 * t=0 no pull, t=0.33s full pull. We freeze it and scrub trackTime by how far
 * the player has dragged, which is what the reference footage shows (short pull
 * = small round ring, long pull = long teardrop + recoiled duck).
 */
const AIM_BONE = 'a_target';
/**
 * `turn`'s turntable drivers, and what makes the facing and the sling fight.
 *
 * AIM_BONE has two sub-assemblies hanging off it, each with its own root:
 *
 *   a_target > all  > master > body …          the duck
 *   a_target > AcIRCLES > all2 > … > active-ring3   the aim teardrop
 *
 * Rotating a_target toward the shot swings both, which is exactly what the
 * sling should do. But `turn` ALSO rotates both roots, 0 -> 360 over its 12s
 * (a 2-frame timeline apiece), so the facing angle lands a second time on the
 * aim frame. Zeroing only `all` fixes the duck and leaves the band behind:
 * measured, pulling down with the facing on put the duck art in the right place
 * (cy 82.0 against 81.7 with the facing off) while the teardrop turned 90° onto
 * its side — 197x118 where it should have been 118x197 — so the duck sat
 * outside the band instead of inside its round end.
 *
 * So both roots are stripped every frame, in the same
 * beforeUpdateWorldTransforms hook that steers AIM_BONE. Nothing is lost: the
 * duck's facing comes from `turn`'s attachment, deform, RGBA and head/body
 * timelines, not from these two. And nothing else is disturbed — checked
 * against all 34 animations in the rig, `turn` is the only one that rotates
 * either, and both have a setup rotation of 0.
 *
 * NOT included, deliberately: `active-ring`/`active-ring2`, the circular
 * selection ring's roots. `turn` spins those too, but so does `spin_ring` — the
 * slow idle rotation on T_SPIN — and zeroing them would kill it. They sit under
 * `root` rather than a_target, so the sling never touches them anyway.
 */
const TURNTABLE_BONES = ['all', 'all2'];
/** drag distance (px) that maps to the aim anim's full stretch */
const AIM_PULL_FULL = 260;
/** even the shortest valid pull shows some stretch (reference: s044 small oval) */
const AIM_PULL_MIN_T = 0.22;
/** the anim's tail recoils the duck art way off its spot — the reference never
 *  shows more than a moderate pull-back, so the scrub tops out early */
const AIM_PULL_MAX_T = 0.65;
/**
 * Stiffness of the spring carrying the sling's DRAWN facing to the aim it is
 * handed, rad/s. Critically damped, so it never overshoots or wobbles.
 *
 * The aim itself is NOT continuous, and cannot be made so without changing how
 * the game plays: assist bends the launch toward the nearest duck inside a cone,
 * so crossing the cone edge steps the direction by assist x cone in one frame —
 * measured at 26.7 degrees on a finale board at assist 0.9 — and it steps again
 * whenever the drag crosses the midpoint between two candidate ducks. The FIRED
 * direction keeps every one of those steps; only the art is filtered.
 *
 * A spring rather than an exponential lag because the input is step-shaped. An
 * exponential moves hardest on the first frame — it still passed ~9 degrees of a
 * 26.7 degree step straight through, which is what was still being seen. A
 * spring starts from zero velocity, so it eases out of a step (~2.4 degrees on
 * the first frame) while tracking an ordinary sweep just as closely: at a brisk
 * 90 deg/sec drag the art sits 2r/w = 6 degrees behind, which is not visible on
 * a duck, and at the slow rates used for real aiming it is a fraction of that.
 */
const AIM_FACING_W = 30;
/**
 * Stiffness for the struck duck's white deflection arrow, rad/s.
 *
 * Softer than the sling's, because the arrow's angle moves FASTER than the aim
 * that drives it: rotating the aim slides the contact point across the target's
 * face, and the normal swings through that contact, so a step in the aim comes
 * out magnified. The assist step measured at 26.7 degrees on the sling arrives
 * here as 72. Matched by measurement rather than by eye — at 10 the arrow's
 * worst drawn step is 5.5 deg/frame against the sling's 5.6, so the two read as
 * equally smooth, and it still sits only ~5 degrees behind an ordinary sweep.
 */
const AIM_ARROW_W = 10;

/**
 * One step of a critically damped angular spring, in closed form:
 *
 *   e(t) = (e0 + (v0 + w·e0)·t)·exp(-w·t)
 *
 * Closed form rather than an integration step so it is exact at any dt — a
 * stepped version blows up on a long frame. Chases the nearest representative of
 * the target angle, so 179 -> -179 is a 2 degree move and not a 358 degree spin
 * back through the front, and the modulo is written to survive a `cur` that has
 * wound far past a single turn.
 */
function springAngle(
  cur: number, vel: number, want: number, w: number, dt: number,
): { angle: number; vel: number } {
  const delta = ((((want - cur) % 360) + 540) % 360) - 180;
  const target = cur + delta;
  const e0 = cur - target;
  const c = vel + w * e0;
  const decay = Math.exp(-w * dt);
  return { angle: target + (e0 + c * dt) * decay, vel: (vel - w * c * dt) * decay };
}

// ── HUD ─────────────────────────────────────────────────────────────────────
// Everything lives in the strip ABOVE the tub (main.ts puts the rim at y=200),
// so the counters can never sit over the playfield.
//
// The bar is the board reassembly's "GAME HUD BAR": a dark slate panel with the
// avatar breaking out of its top-left, MOVES as white digit tiles, and a GOALS
// inset holding one icon per goal type with its REMAINING count.
//
// EVERY number below is measured, from one of two sources:
//  - the reassembly's own boxes, rendered and read back: bar 622x118, avatar
//    frame at +10,+10 (128x98), first digit tile at +155,+14 (50x92, gap 5),
//    goals inset at +276,+10 (323x98).
//  - the real game's HUD screenshot (642x160) where the reassembly disagrees
//    with it. The one place it does is the goal icons: measured off the
//    screenshot they run ~58px in a 96px-tall inset, a ratio of 0.60, where the
//    reassembly draws them at 52 in 98 (0.53). The game's ratio wins, which is
//    why GOAL_ICON is a fraction of the inset rather than a fixed 52.
//
// The reference bar is then scaled by REF_K to fill our narrower canvas, so the
// HUD occupies the same share of the screen width it does in the real game
// (its bar spans 607 of a 642-wide capture, ~95%).
//
// This also collapses what used to be three separate plates (pearls | moves |
// crates) into two groups.
/**
 * The one face we register a woff2 under — the file's own name is irrelevant.
 * It is the pack's `asap-semicondensed-black`, which the manifest calls the
 * "Heavy condensed number/counter font (moves/score)".
 *
 * ONE FACE, ON PURPOSE. The pack ships a second, CherryBombOne, billed as the
 * "Primary display/title face (rounded bubbly). Headers/CTA/score." We used to
 * register it too and hold it for "anything titular that comes later" — but
 * when the end card was built it deliberately took the condensed face as well
 * (see CARD_FONT in endCard.ts), so nothing in the ad ever asked for it. A
 * registered font that renders no glyphs is still ~21 KB of base64 in a
 * single-file build, so it was dropped outright: import, FontFace, woff2 and
 * its prepare-assets entry (user-locked 2026-08-08).
 *
 * Every string in the ad is therefore this face — HUD labels, timer digits,
 * goal counts, the aim hint, and all four end-card texts.
 */
const HUD_NUM_FONT = 'AsapBlack';
/**
 * The one line of words in the whole ad, and it is the shooting mechanic.
 *
 * The hand mimes the gesture; this says it. Neither is much use alone — a hand
 * dragging a duck backwards is ambiguous about what the drag DOES, and a line of
 * text on a board nobody has touched is wallpaper — so they run together and say
 * the same thing two ways.
 *
 * Kept to one short line on purpose: it sits over the water at the top of the
 * tub, above the first row of ducks (y 350), and anything that wrapped to two
 * lines would start crowding them.
 */
const HINT_LINE = 'Drag a duck back, release to shoot';
/**
 * In the open water, not on the rim. The tub's top rim band runs ~190..216 in
 * design space and the first row of ducks sits at y 350 with a 45 radius, so
 * anything between ~240 and ~300 is clear of both. Sitting it at 218 put the
 * letters straddling the rim's edge, which read as a caption stuck to the tub
 * rather than one floating over the board.
 */
const HINT_Y = 262;
const HINT_SIZE = 32;
/** it has said its piece once the player takes a shot: fade over this long */
const HINT_FADE = 0.4;
/** the reassembly's bar, and ours: everything else scales between them */
const REF_BAR_W = 622;
const BAR_W = 681, BAR_X = 360, BAR_TOP = 45;
const REF_K = BAR_W / REF_BAR_W;
const BAR_H = 118 * REF_K;
const BAR_RADIUS = 18 * REF_K;
/** reference palette */
const BAR_TOP_COL = '#615c78', BAR_BOT_COL = '#565169';
const BAR_EDGE = '#3f3a54';
const INSET_TOP_COL = '#b5aed4', INSET_BOT_COL = '#a49cc4';
/** digit tile: 50x92, gap 5, and its own palette */
const TILE_W = 50 * REF_K, TILE_H = 92 * REF_K, TILE_GAP = 5 * REF_K;
const TILE_RADIUS = 8 * REF_K;
const TILE_EDGE = '#a9a1c4';
const TILE_INK = 0x4a4571;
/** MOVES starts here, past the avatar's reserved slot */
const MOVES_DX = 155 * REF_K, MOVES_DY = 14 * REF_K;
/** the goals inset, and the icon row inside it */
const INSET_DX = 276 * REF_K, INSET_DY = 10 * REF_K, INSET_H = 98 * REF_K;
/** measured off the real game: icon height is 0.60 of the inset's, not 0.53 */
const GOAL_ICON = INSET_H * 0.6, GOAL_GAP = 44 * REF_K;
// reference: `left:32px; bottom:-2px` against its 52-square icon, kept as a
// fraction of the icon so the bigger icon carries its count with it
const GOAL_COUNT_DY = 2;
/** the avatar's frame, and the character breaking out of its top */
const AVATAR_DX = 10 * REF_K, AVATAR_DY = 10 * REF_K;
const AVATAR_W = 128 * REF_K, AVATAR_H = 98 * REF_K;
/**
 * Character width as a share of the frame. The reassembly says 84%, but the
 * real game's own HUD says otherwise: measured off the screenshot the character
 * spans ~118px against a ~128px frame, so it very nearly fills it and spills
 * past the sides. 0.92 is the game's number and the game wins.
 */
const AVATAR_ART_W = AVATAR_W * 0.92;
/** section labels: 18px, 1.5 letter-spacing, white with a soft drop */
const HUD_LABEL_SIZE = 18 * REF_K;
/**
 * Where a label's Text ORIGIN goes relative to the bar's top edge, so the caps
 * end up bisected by it — half the glyph above the bar, half below. Not zero,
 * because a Text box is centred on ascent+descent while these all-caps labels
 * only ever occupy the top part of it. Measured off the render.
 */
const HUD_LABEL_BASE = 1.8;
/**
 * Black keyline round the labels, so they read against the board as well as the
 * bar. Canvas centres a stroke on the glyph outline and the fill then paints
 * over the inner half, so only half of this shows: 4 gives ~2px of visible ink.
 * That is the game's own weight — measured off its HUD, the keyline runs 3px
 * against a 19px cap (0.16), and ours is 2.1 against 14.2 (0.15).
 */
const HUD_LABEL_STROKE = 4;
/** the counter number punches this big for a beat whenever it changes */
const HUD_PUNCH = 1.3, HUD_PUNCH_TIME = 0.12;

/**
 * The countdown lives in the bar's left slot, in the two digit tiles that used
 * to carry MOVES — seconds fit those tiles exactly, since both are a two-digit
 * zero-padded number and the clock never passes 99.
 *
 * DISPLAY ONLY: the digits count down, but reaching zero does nothing. The
 * level is still decided by the move budget, which the sim enforces and the
 * HUD no longer shows. See the endcard spec for the fail path this wants.
 */
const LEVEL_SECONDS = 30;
/** at and below this many seconds the digits go red and stay red */
const TIMER_URGENT = 10;
/** the game's own red — the red duck's, off the pack's colour table */
const TIMER_URGENT_INK = 0xec273f;
/**
 * One digit roll. Short enough that it can never collide with the next second
 * (a roll is 16% of the gap between ticks) but long enough to read as motion
 * rather than as a flicker.
 */
const FLIP_TIME = 0.16;

/** Decode an image URL (path or data URI) into a Pixi texture — same one code
 *  path for dev URLs and the build's inlined data URIs. */
async function loadTexture(url: string): Promise<Texture> {
  const img = new Image();
  img.src = url;
  await img.decode();
  return Texture.from(img);
}

/**
 * The splash's star-shaped hole, traced from the footage: a fat four-point
 * star with concave sides (tips at N/E/S/W) over four thin diagonal spikes.
 * Flat water colour, crisp edge — it reads as the tub showing THROUGH the
 * white pancake, which is exactly what the real effect is.
 */
function drawSplashStar(g: Graphics): Graphics {
  const R1 = SPLASH_R * 0.72; // tip radius
  const R2 = R1 * 0.2;        // waist radius between tips
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    g.moveTo(0, 0).lineTo(Math.cos(a) * R1 * 0.9, Math.sin(a) * R1 * 0.9);
  }
  g.stroke({ width: 5, color: SPLASH_WATER, cap: 'round' });
  g.moveTo(0, -R1);
  for (let i = 0; i < 4; i++) {
    const tip = -Math.PI / 2 + ((i + 1) * Math.PI) / 2;
    const waist = tip - Math.PI / 4;
    g.quadraticCurveTo(
      Math.cos(waist) * R2, Math.sin(waist) * R2,
      Math.cos(tip) * R1, Math.sin(tip) * R1,
    );
  }
  return g.closePath().fill(SPLASH_WATER);
}

/** oversample the baked HUD panels so their corners stay clean when scaled */
const PANEL_SS = 3;

function roundRectPath(
  c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number,
): void {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

interface PanelSpec {
  w: number; h: number; r: number;
  /** vertical gradient stops, [offset 0..1, css colour] */
  fill: Array<[number, string]>;
  edge?: { colour: string; width: number };
  /** CSS `inset 0 Npx 0 rgba(...)`: a band hugging the top (+) or bottom (−) */
  insets?: Array<{ y: number; colour: string }>;
  /** CSS `0 Npx 0 rgba(...)`: a hard drop, baked in by inflating the canvas */
  drop?: { y: number; colour: string };
}

/**
 * Bake one of the reassembly's CSS boxes into a texture.
 *
 * Those boxes are a vertical gradient, a solid border, and a stack of hard
 * inset/outset shadows. Pixi has no box-shadow and its Graphics gradients do
 * not do multi-stop verticals cleanly, so each panel is drawn once through the
 * 2D canvas API instead — which reproduces the spec exactly rather than
 * approximating it. They are static, so this costs one draw at startup.
 */
function panelTexture(spec: PanelSpec): Texture {
  const drop = spec.drop?.y ?? 0;
  const cv = document.createElement('canvas');
  cv.width = spec.w * PANEL_SS;
  cv.height = (spec.h + drop) * PANEL_SS;
  const c = cv.getContext('2d')!;
  c.scale(PANEL_SS, PANEL_SS);

  if (spec.drop) {
    c.fillStyle = spec.drop.colour;
    roundRectPath(c, 0, spec.drop.y, spec.w, spec.h, spec.r);
    c.fill();
  }
  const g = c.createLinearGradient(0, 0, 0, spec.h);
  for (const [at, colour] of spec.fill) g.addColorStop(at, colour);
  c.fillStyle = g;
  roundRectPath(c, 0, 0, spec.w, spec.h, spec.r);
  c.fill();

  // the inset bands are clipped to the panel so they follow its corners
  if (spec.insets?.length) {
    c.save();
    roundRectPath(c, 0, 0, spec.w, spec.h, spec.r);
    c.clip();
    for (const band of spec.insets) {
      c.fillStyle = band.colour;
      if (band.y > 0) c.fillRect(0, 0, spec.w, band.y);
      else c.fillRect(0, spec.h + band.y, spec.w, -band.y);
    }
    c.restore();
  }
  if (spec.edge) {
    c.strokeStyle = spec.edge.colour;
    c.lineWidth = spec.edge.width;
    // stroke inside the box, matching CSS border-box
    roundRectPath(
      c, spec.edge.width / 2, spec.edge.width / 2,
      spec.w - spec.edge.width, spec.h - spec.edge.width, spec.r,
    );
    c.stroke();
  }
  return Texture.from(cv);
}

/**
 * Remaining hp IS the visible damage stage, and the rig's pose names line up
 * exactly: hpN shows N-1 metal straps. 3 hp = two straps (hp3), 2 hp = one
 * strap (hp2), 1 hp = bare planks (hp1). Every hit steps down exactly one
 * stage. (hp4/hp5 poses — three and four straps — are deliberately unused:
 * two straps is the deepest stage this game deals.)
 */
/**
 * One tile's worth of split-flap. Two Texts share a masked box the size of the
 * tile: `cur` is the digit on screen, `out` is the one leaving. They swap roles
 * every roll rather than being created per tick, so a 30-second countdown costs
 * four Texts for its whole life.
 */
interface DigitRoller {
  box: Container;
  cur: Text;
  out: Text;
  /**
   * The ink both Texts are currently carrying. Tracked here rather than read
   * back off `style.fill`, which Pixi normalises into its own fill object, and
   * written only when it actually changes — assigning it re-rasterises the
   * glyph, which is not something to do twice a second for no reason.
   */
  ink: number;
  /** the running ticker fn, so a roll can be cut short by the next one */
  anim: ((t: { deltaMS: number }) => void) | null;
}

function stageFor(b: { hp: number }): string {
  return b.hp >= 3 ? 'hp3' : b.hp === 2 ? 'hp2' : 'hp1';
}

export class GameScene {
  /** rebuilt by loadLevel() as the campaign advances */
  director: Director;
  private duckViews = new Map<number, Spine>();
  private barrelViews = new Map<number, Spine>();
  /** crates already flinched this drain — see flinchBarrel */
  private crateFlinched = new Set<number>();
  private clamViews = new Map<number, Spine>();
  private layer = new Container();
  private fx = new Container();
  /** counters, always on top and always above the tub rim */
  private hud = new Container();
  private aimLine = new Graphics();
  /**
   * OFFICIAL_AIM_TIP: the pack chevron replacing the drawn wedge, one instance
   * reused every frame (there is only ever one deflection to mark).
   *
   * NOT to be confused with `aimArrow` below, which is a NUMBER — the wedge's
   * sprung angle in degrees. This is the thing on screen; that is the angle it
   * points. This sprite takes its rotation from `aimWedge`, which is already
   * built out of that spring, so the smoothing applies to both alike.
   */
  private aimTip = new Sprite();
  /** OFFICIAL_SPLASH_RING: `dome`, the splash ring. Only loaded when that flag
   *  is on, so it is `!`-asserted and must not be read on the drawn path. */
  private domeTex!: Texture;
  /** OFFICIAL_DEBRIS: the two sparkle frames cut out of the `ptx-stars` sheet */
  private ptxTex: Texture[] = [];
  private hand: Spine | null = null;
  /**
   * The idle teaching shot. Built only on the ad's own beats — see AD_SCRIPT —
   * so a dev deep-link to level 4 and the level-1 tap tutorial are both left
   * alone, and null everywhere else means the whole feature is one `?.` away
   * from not existing.
   */
  private idleDemo: IdleDemo | null = null;
  /** the shooting instruction over the water — see HINT_LINE */
  private hintText: Text | null = null;
  /** seconds of hint fade-out left; 0 when it is not going anywhere */
  private hintFading = 0;
  /** the player has fired, so the instruction never comes back — run-wide */
  private hintSpent = false;
  private handData!: SkeletonData;
  private duckyData!: SkeletonData;
  private crateData!: SkeletonData;
  private oysterData!: SkeletonData;
  /** rig free-lists, prewarmed in init(): constructing a Spine clones the whole
   *  bone/slot tree, and a board's worth in one frame was the level-load hitch */
  private duckPool!: SpinePool;
  private cratePool!: SpinePool;
  private oysterPool!: SpinePool;
  /** bumped by loadLevel. Rigs are pooled, not destroyed, and duck ids restart
   *  per level — so a lingering closure must notice the board it animated for
   *  is gone, which `s.destroyed` no longer tells it. */
  private viewEpoch = 0;
  /** verdict cards rasterized ahead of time (keyed by cleared) — building a
   *  card's Texts on the verdict frame was a measured ~370ms spike on a weak
   *  phone, so scripted boards prepare both endings during quiet moments */
  private preparedCards: { level: number; byResult: Map<boolean, PreparedEndCard> } | null = null;
  /** crate one-shots that already had their completed pose applied — the rig
   *  sleeps after that (see syncViews); keyed by entry so any setAnimation
   *  naturally wakes the crate back up */
  private appliedBarrelPoses = new WeakSet<TrackEntry>();
  private pearlTex!: Texture;
  /** per-colour "duck + ring bones + aim bones" skin, built once (see init) */
  private duckSkins = new Map<Colour, Skin>();
  /** what each duck's ring track is showing: absent = nothing */
  private ringMode = new Map<number, 'ring' | 'aim'>();
  /** aim-teardrop rotation (deg, rig space) applied per duck before world transforms */
  private aimBoneRot = new Map<number, number>();
  /** the duck the aim is resting on, when it is a same-colour (i.e. matching) one */
  private targetedDuck: number | null = null;
  /** ducks posed by the rig's `turn` (facing the shot) instead of idling */
  private turning = new Set<number>();
  /** pooled trajectory-dot sprites (official aim-dot), laid out each frame */
  private dotPool: Sprite[] = [];
  /** the aim UI layer — dots, crescent, X — sits UNDER the ducks like the official */
  private aimUnder = new Container();
  /** red contact crescent on the aimed-at duck: white pill under a red-tinted one */
  private crescent = new Container();
  /** the refused-aim marker, the pack's X art */
  private xMark = new Sprite();
  private starTex!: Texture;
  /** soft white disc standing in for the official's blurred `foam` sprite */
  private blobTex!: Texture;
  /** pop splashes live here — under the ducks, so the pancake reads as water */
  private fxUnder = new Container();
  /** motion-trail puffs live here — under the ducks, so the wake reads behind */
  private trailLayer = new Container();
  /** where each duck last dropped a trail puff */
  private trailLast = new Map<number, { x: number; y: number }>();
  /** live puffs, advanced every frame in syncViews; sprites recycle via the pool */
  private trailPuffs: Array<{ s: Sprite; t: number; id: number; dx: number; dy: number }> = [];
  private trailPool: Sprite[] = [];
  /** the pack's noisy motion-trail streak (see WAKE_ASPECT) */
  private trailTex!: Texture;
  /** sim ducks whose view has not been built yet (official drainSpawnQueue) */
  private spawnQueue: Duck[] = [];
  /** duck ids still inside the spawn scale-up (scale is theirs until it ends) */
  private spawning = new Set<number>();
  private danceTimer = 0;
  /** duck ids currently whited-out by the match blink */
  private flashOn = new Set<number>();
  /** per-duck isolated attachment colours backing the current white band */
  private flashSlots = new Map<number, Array<{ color: Color; orig: [number, number, number, number] }>>();
  /** seconds of hitstop left — the sim is dead while this is positive */
  private hitstop = 0;
  /** seconds of camera shake left */
  private shake = 0;
  private accumulator = 0;
  /** monotonic clock driving the aim dot crawl */
  private aimClock = 0;
  /** the sling's drawn facing in rig degrees, sprung toward the raw aim. Null
   *  between grabs so a fresh pull starts pointing where it is aimed instead of
   *  sweeping round from wherever the last one finished. */
  private aimFacing: number | null = null;
  /** that spring's velocity, deg/s */
  private aimFacingVel = 0;
  /** last frame's aim polyline, and which branch of the prediction drew it */
  private aimPath: AimPath | null = null;
  private aimShape = '';
  /** the polyline we were drawing when the branch last flipped, fading out under
   *  the new one so the tail extends or retracts instead of appearing whole */
  private aimGhost: (AimPath & { t: number }) | null = null;
  /** 0 = showing the red X, 1 = showing the struck-duck guides; the two cross-fade */
  private aimHit = 0;
  /** last struck-duck pose (centre + deflect), held so the wedge and crescent can
   *  fade out in place after the aim has already left the duck */
  private aimWedge: { sx: number; sy: number; dx: number; dy: number } | null = null;
  /** likewise the last red-X spot */
  private aimX: { x: number; y: number } | null = null;
  /** the arrow's drawn angle in degrees, sprung toward the predicted deflect,
   *  plus that spring's velocity and which duck the arrow currently belongs to */
  private aimArrow: number | null = null;
  private aimArrowVel = 0;
  private aimArrowId: number | null = null;
  /** pointerId that owns the current grab — other pointers are ignored */
  private activePointer: number | null = null;
  /** the bar's two digit tiles — the countdown's seconds, one roller each */
  private clockTiles: DigitRoller[] = [];
  private goalText!: Text;
  private pearlText!: Text;
  private clamIcon!: Sprite;
  private crateIcon!: Sprite;
  /** green ticks that take a goal count's place the moment it reaches zero */
  private goalCheck!: Graphics;
  private pearlCheck!: Graphics;
  /** centre of the GOALS inset and the icon row's top, resolved in buildHud */
  private goalsCentre = BAR_X;
  private goalsIconY = BAR_TOP + 10;
  /** clam icon + count; hidden wholesale on a level with no clams */
  private pearlGroup = new Container();
  /** where a spilled pearl flies to — set once the HUD is laid out */
  private pearlTarget = { x: BAR_X, y: BAR_TOP + 60 };
  /** in-flight pearls by PEARL id — two from one shell can overlap, since every
   *  contact spills — and `pearlCollected` lands the matching one */
  private pearlFlights = new Map<number, () => void>();
  /** the sound layer. Built once and NEVER rebuilt, so a mute survives a level
   *  swap and the decoded buffers are paid for exactly once per session. */
  readonly audio = new Audio();
  /** end-card art, loaded once at boot with everything else */
  private endCardTex!: EndCardTextures;
  /** the card currently up, if any — a second must never stack on it */
  private endCard: Container | null = null;

  constructor(
    private app: Application,
    /**
     * Where this scene draws. `board` is design space plus the camera shake,
     * `overlay` is design space without it — see game/stage.ts. The scene is
     * handed them rather than reaching for app.stage because the stage is in
     * SCREEN pixels now, and every number in this file is a design number.
     */
    private layers: StageLayers,
    private seed: number,
    startLevel = 0,
  ) {
    // clamped so a stray ?level= can never ask the Director for a level that
    // does not exist (it throws) — the campaign just starts at the last one
    const i = Math.min(Math.max(0, startLevel), LEVELS.length - 1);
    this.director = new Director(seed + i, i);
  }

  async init(): Promise<void> {
    this.duckyData = await loadSkeleton({
      skelUrl: duckySkelUrl, atlasText: duckyAtlasText, pageUrl: duckyPageUrl,
    });
    this.crateData = await loadSkeleton({
      skelUrl: crateSkelUrl, atlasText: crateAtlasText, pageUrl: cratePageUrl,
    });
    this.oysterData = await loadSkeleton({
      skelUrl: oysterSkelUrl, atlasText: oysterAtlasText, pageUrl: oysterPageUrl,
    });
    // capacity for the busiest board plus explode-animation overlap, paid once
    // here behind the load instead of as a mid-session frame spike
    this.duckPool = new SpinePool(this.duckyData);
    this.duckPool.prewarm(8);
    this.cratePool = new SpinePool(this.crateData);
    this.cratePool.prewarm(6);
    this.oysterPool = new SpinePool(this.oysterData);
    this.oysterPool.prewarm(2);
    this.starTex = await loadTexture(starUrl);
    this.blobTex = await loadTexture(blobUrl);
    this.pearlTex = await loadTexture(pearlUrl);
    this.endCardTex = await loadEndCardTextures();

    // aim UI: official aim-dot sprites + the red contact crescent, all layered
    // UNDER the ducks (the official parks dots/cross at depth 6-8.5, ducks at 10+,
    // which is why the reference dots vanish cleanly behind the target duck)
    const aimDotTex = await loadTexture(aimDotUrl);
    for (let i = 0; i < DOT_MAX; i++) {
      const d = new Sprite(aimDotTex);
      d.anchor.set(0.5);
      d.width = DOT_SIZE;
      d.height = DOT_SIZE;
      d.visible = false;
      this.dotPool.push(d);
      this.aimUnder.addChild(d);
    }
    const cb = new Sprite(await loadTexture(touchBgUrl));
    cb.anchor.set(0.5);
    cb.scale.set(CRESCENT_SCALE);
    const cf = new Sprite(await loadTexture(touchFrontUrl));
    cf.anchor.set(0.5);
    cf.scale.set(CRESCENT_SCALE);
    cf.tint = CRESCENT_COLOR;
    this.crescent.addChild(cb, cf);
    this.crescent.visible = false;
    // the refused-aim X. Height-locked so the art's own 43x49 aspect survives
    const xTex = await loadTexture(iconXUrl);
    this.xMark.texture = xTex;
    this.xMark.anchor.set(0.5);
    this.xMark.height = AIM_X_H;
    this.xMark.width = AIM_X_H * (xTex.width / xTex.height);
    this.xMark.visible = false;
    // ── the pack textures the audit put back, each behind its own switch ─────
    // Loaded only when its swap is live, so a flag left off costs no fetch and
    // no GPU upload — and, in the build, no inlined bytes at all.
    if (OFFICIAL_SPLASH_RING) this.domeTex = await loadTexture(domeUrl);
    if (OFFICIAL_DEBRIS) {
      // The sheet is cut by arithmetic, not by an atlas: it ships as a bare png
      // with no region data, and the two sparkles each fill their own 128px
      // half edge to edge (verified by alpha, see PTX_FRAME).
      const ptxSheet = await loadTexture(ptxStarsUrl);
      for (let i = 0; i < PTX_FRAMES; i++) {
        this.ptxTex.push(new Texture({
          source: ptxSheet.source,
          frame: new Rectangle(i * PTX_FRAME, 0, PTX_FRAME, PTX_FRAME),
        }));
      }
    }
    if (OFFICIAL_AIM_TIP) {
      this.aimTip.texture = await loadTexture(aimArrowUrl);
      // anchored ON THE POINT, so `position` is the tip and the rotation pivots
      // about it — the tip is the only part of a chevron whose placement is
      // load-bearing, and pivoting anywhere else swings it off the deflect line
      this.aimTip.anchor.set(ARROW_POINT_X / ARROW_SRC_W, 0.5);
      // sized ACROSS the axis to the wedge's old base width, so the marker
      // carries the same weight on the water whatever its length works out to
      this.aimTip.scale.set((ARROW_ACROSS * SIM.DUCK_R) / ARROW_SRC_H);
      this.aimTip.tint = ARROW_TINT;
      this.aimTip.visible = false;
      this.aimUnder.addChild(this.aimTip);
    }
    this.aimUnder.addChild(this.aimLine, this.crescent, this.xMark);
    this.trailTex = await loadTexture(trailUrl);
    this.layers.board.addChild(
      this.aimUnder, this.trailLayer, this.fxUnder, this.layer, this.fx, this.hud,
    );
    await this.buildHud();

    // The rig's `active-ring` and `aim` skins ship ZERO attachments — they exist
    // to carry BONES (the circular selection ring's, and the drag teardrop's).
    // Without them those bones are inactive and the `active`/`aim` animations'
    // attachment timelines silently no-op, so every duck wears all three merged.
    const ringSkin = this.duckyData.findSkin('active-ring');
    const aimSkin = this.duckyData.findSkin('aim');
    if (!ringSkin || !aimSkin) throw new Error('ducky rig is missing the active-ring/aim skin');
    for (const c of COLOURS) {
      const colourSkin = this.duckyData.findSkin(c);
      if (!colourSkin) throw new Error(`ducky rig is missing the ${c} skin`);
      const combined = new Skin(`${c}+ring`);
      combined.addSkin(colourSkin);
      combined.addSkin(ringSkin);
      combined.addSkin(aimSkin);
      this.duckSkins.set(c, combined);
    }

    this.wireInput();
    this.director.start();
    this.drainEvents(); // creates initial views

    // tutorial hand taps beside the red duck until first successful drag
    const handData = await loadSkeleton({
      jsonUrl: handJsonUrl, atlasText: handAtlasText, pageUrl: handPageUrl,
    });
    this.hand = makeSpine(handData);
    this.hand.state.setAnimation(0, 'tap', true);
    this.hand.position.set(495, 365);
    this.hand.scale.set(0.25);
    // only level 1 is being taught — deep-linking to level 7 must not park a
    // tutorial hand on top of a duck (loadLevel applies the same rule)
    this.hand.visible = this.director.levelIndex === 0;
    this.fx.addChild(this.hand);
    this.handData = handData;
    this.syncIdleDemo();

    // the opening board's verdict cards, rasterized here behind the load where
    // the cost is invisible (prepareEndCard no-ops for off-script boards)
    this.prepareEndCard(this.director.levelIndex, true);
    this.prepareEndCard(this.director.levelIndex, false);

    this.app.ticker.add((t) => this.tick(t.deltaMS / 1000));
  }

  private wireInput(): void {
    // Events are bound to the STAGE — it is the root, and its hitArea covers
    // the whole canvas including the letterbox margins the wall shows through.
    // Positions are read against `board`, which is where the ducks actually
    // are: design space, camera shake included. A tap on the margin resolves to
    // a design coordinate outside 0..720 and simply finds no duck to grab.
    const stage = this.app.stage;
    const space = this.layers.board;
    stage.eventMode = 'static';
    stage.hitArea = { contains: () => true };
    stage.on('pointerdown', (e) => {
      // FIRST thing on every pointerdown, before any refusal below can return:
      // browsers only let audio start from inside a user gesture, and in this
      // game the first gesture IS the first aim grab. Doing it here means the
      // grab that unlocks the context is also the one that gets to be heard.
      this.audio.unlock();
      // …and SECOND, before any refusal below can return: a touch always ends
      // the idle demo. It runs on the same slingshot the player is about to
      // grab, so it has to let go before the handler asks for it — and because
      // the abort happens inside this same event, the touch that interrupts is
      // also the touch that grabs. The player never spends one just stopping it.
      //
      // takeOver, not abort: a touch also spends the run's teaching shot, so
      // the next turn's hand holds its aim for the player instead of firing.
      this.idleDemo?.takeOver();
      if (this.activePointer !== null) return; // a grab is in flight — ignore extra fingers
      // NO GREEN RING, NO GRAB (user-locked 2026-08-07). One test for what the
      // board is offering and what it will accept: boardReady is what puts the
      // rings up, so refusing on it here means the player can never start a drag
      // the board has not advertised. It covers the move budget and a decided
      // level too — those bar the slingshot — as well as every way a turn can
      // still be resolving, right down to a respawned duck still scaling in.
      //
      // The sim enforces the same rule itself (Director.syncBlocked), so this is
      // the courteous refusal, not the load-bearing one.
      if (!this.boardReady()) return;
      const d = this.director;
      const p = e.getLocalPosition(space);
      if (!d.slingshot.begin(p.x, p.y)) return;
      // a duck waiting in the spawn queue has no view yet: refuse the grab
      // rather than let the player sling an invisible duck
      const grabbed = this.director.slingshot.pull?.duck.id;
      if (grabbed === undefined || !this.duckViews.has(grabbed)) {
        this.director.slingshot.cancel();
        return;
      }
      this.activePointer = e.pointerId;
      this.startAim(); // a fresh pull points where it aims from its first pixel
      // event map: launch-pull is "grab/pull a floating duck to aim". It fires on
      // the GRAB, not on the first drag pixel — the grab is the moment the rig
      // shows its selection ring, and a sound that waited for movement would
      // leave a tap-and-hold silent.
      this.audio.play('launchPull');
      if (this.hand) this.hand.visible = false; // tutorial done
    });
    stage.on('pointermove', (e) => {
      // a moving pointer is a viewer who is present, whether or not they are
      // mid-grab: the idle clock restarts either way
      this.idleDemo?.poke();
      if (e.pointerId !== this.activePointer) return;
      const p = e.getLocalPosition(space);
      this.director.slingshot.move(p.x, p.y);
    });
    const up = (e: { pointerId: number }): void => {
      if (e.pointerId !== this.activePointer) return;
      this.activePointer = null;
      this.idleDemo?.poke();
      const pull = this.director.slingshot.pull;
      const held = pull?.duck.id ?? null;
      // a pull that never reached MIN_PULL is a whiff and stays silent; a pull
      // that DID aim and was still refused (the red X — no duck on the line) is
      // the case that needs an answer, and gets the nope blip
      const aimed = (pull?.len ?? 0) >= SIM.MIN_PULL;
      const fired = this.director.slingshot.end();
      if (aimed && !fired) this.audio.play('uiClick', { gain: 0.7 });
      this.endAim(held, fired);
    };
    stage.on('pointerup', up);
    stage.on('pointerupoutside', up);
    // NOTE: Pixi v8's EventSystem registers NO DOM pointercancel/touchcancel
    // listener (it wires move/down/up/over/leave only — verified against
    // node_modules/pixi.js/lib/events/EventSystem.js), so a stage-level
    // 'pointercancel' handler would never fire from a real cancel. On phones a
    // cancelled touch (notification shade, browser back-gesture, palm
    // rejection) ends the sequence with NO pointerup — without this DOM-level
    // listener the grab would stay stuck and, because pointerdown refuses
    // while a grab is active, every later touch would be ignored: a bricked
    // playable. Registered once for the page's lifetime, like the stage's own.
    window.addEventListener('pointercancel', (e: PointerEvent) => {
      if (e.pointerId !== this.activePointer) return;
      this.activePointer = null;
      this.idleDemo?.poke();
      this.director.slingshot.cancel(); // cancelled: drop the grab without firing
      this.aimLine.clear();
      this.xMark.visible = false;
      this.aimTip.visible = false; // OFFICIAL_AIM_TIP: a sprite, so clearing the line misses it
    });
  }

  /**
   * The view side of taking hold: a grab has just begun, so the sling's DRAWN
   * facing starts at whatever the new pull aims at instead of sweeping round
   * from the last one.
   *
   * This is called on the frame of the grab rather than inferred later, because
   * the inference does not work. syncRings can only see "was anything held last
   * frame", and the idle demo hands the sling over INSIDE a single pointerdown —
   * takeOver() cancels its pull and begin() starts the player's before the next
   * frame — so `held` never passes through null. Keying on the duck's id does
   * not save it either: the player often grabs the very duck the demo was
   * already holding, which is a new grab that looks identical to the old one.
   *
   * Left to spring, the player's brand-new pull was carried in from whatever
   * angle the DEMO had been aiming at — measured at 24-29 degrees to travel,
   * ~250ms of the duck's art rotating into place before it would follow the
   * finger. That is the hesitation at the start of a drag, and it is why this
   * has to be an event and not a guess.
   */
  private startAim(): void {
    this.aimFacing = null;
    this.aimFacingVel = 0;
  }

  /**
   * The view side of letting go: the rig's snap-back on a duck that actually
   * fired, and the aim UI cleared either way.
   *
   * Shared by the pointer-up handler and the idle demo, and that sharing is the
   * point — the demo drives the same slingshot the player does, so if the two
   * releases were written twice they would drift, and the demo would leave a
   * duck wearing an aim ring nobody was aiming.
   */
  private endAim(duckId: number | null, fired: boolean): void {
    // A SHOT CAN ONLY BE THE PLAYER'S. The hint hand lets go with `cancel()` and
    // reaches here with fired=false, so this needs no test for who is holding.
    if (fired) this.spendHint();
    if (fired && duckId !== null) {
      const v = this.duckViews.get(duckId);
      if (v) {
        v.state.setAnimation(T_RING, 'aim_release', false);
        v.state.addEmptyAnimation(T_RING, 0.1, 0);
        this.ringMode.delete(duckId);
        this.aimBoneRot.delete(duckId);
      }
    }
    this.aimLine.clear();
    this.xMark.visible = false;
    this.aimTip.visible = false; // OFFICIAL_AIM_TIP: a sprite, so clearing the line misses it
  }

  private tick(dt: number): void {
    this.aimClock += dt;
    if (this.hitstop > 0) {
      // Official hitstop: `time2.freeze` zeroes the SIM's timescale only — the
      // decomp's GameScene.update gates `sim.update` and nothing else, so the
      // pop's own vfx and the spine rigs keep playing through the 40ms.
      this.hitstop = Math.max(0, this.hitstop - dt);
    } else {
      // fixed-step the sim regardless of render rate
      this.accumulator += Math.min(dt, 0.1);
      while (this.accumulator >= SIM.DT) {
        this.director.step(SIM.DT);
        this.accumulator -= SIM.DT;
      }
    }
    this.drainEvents();
    this.drainSpawnQueue();
    this.tickTimer();
    this.tickDance(dt);
    // BEFORE the probe below, not after: a demo frame moves the synthetic
    // pointer, and the aim line the viewer is being taught to read is drawn off
    // that same probe. Ticked after it, every demo frame would draw the aim it
    // held one frame ago and the hand would lead its own line.
    this.idleDemo?.update(dt);
    if (this.hintFading > 0 && this.hintText) {
      this.hintFading = Math.max(0, this.hintFading - dt);
      this.hintText.alpha = 0.92 * (this.hintFading / HINT_FADE);
      if (this.hintFading === 0) this.hintText.visible = false;
    }
    // one trajectory probe per frame — the rings and the aim UI both read it
    const pv = this.director.slingshot.preview();
    this.syncViews(dt);
    this.syncRings(pv, dt);
    this.drawAim(pv, dt);
    this.syncShake(dt);
  }

  /**
   * Show the sim's clock. Not a clock of its own: the HUD used to run a parallel
   * `timerLeft` in real seconds, and the two drifted, because the sim's ticks
   * stop during hitstop and only advance in whole DT chunks while a wall-clock
   * float does neither.
   *
   * That drift is what ended levels on 01. The view clock was left holding a
   * sub-frame remainder (~0.04s) when the sim hit zero, `ceil` rounded it up to
   * 1, and the old early-out on `director.failed` then froze it there forever —
   * so the last second was displayed as 01 and 00 was never drawn at all.
   * Reading `secondsLeft` makes the digits show 00 on exactly the frame the
   * clock runs out, because it is the same number the failure tests.
   *
   * No freeze guard is needed here either: Director.step stops decrementing once
   * the level is decided, so a won board is not left counting down behind the
   * transition.
   */
  private tickTimer(): void {
    this.setTimer(this.director.secondsLeft);
  }

  /**
   * Official idle-flavor: every 2.8s, while the board is settled, one random
   * duck does a little dance. The official gates on its 'aim' state, which it
   * only re-enters once every body is at rest AND no fuse is burning — so this
   * checks the same three things (`live` alone is not enough: a duck nudged by
   * a collision glides with `live` still false). View-only, so the Math.random
   * here can't perturb the deterministic sim.
   */
  private tickDance(dt: number): void {
    this.danceTimer += dt;
    if (this.danceTimer < DANCE_PERIOD) return;
    this.danceTimer = 0;
    const busy = this.director.world.ducks.some(
      (k) => k.live || k.matched || k.vx !== 0 || k.vy !== 0,
    );
    if (busy) return;
    const held = this.director.slingshot.pull?.duck.id;
    // the duck being aimed at is busy answering the aim — a dance on top of the
    // `targeted` hop would read as noise, and would outrank it on the body track
    const ids = [...this.duckViews.keys()].filter(
      (id) => id !== held && id !== this.targetedDuck && !this.spawning.has(id),
    );
    if (ids.length === 0) return;
    const v = this.duckViews.get(ids[(Math.random() * ids.length) | 0]!)!;
    v.state.setAnimation(T_BODY, 'dance', false);
    v.state.addAnimation(T_BODY, 'idle', true, 0);
  }

  /**
   * Phaser's camera shake, ported: a fresh uniform offset every frame for the
   * duration (no falloff), scaled by the viewport, snapping back to zero at the
   * end. The board is otherwise always at its layer's origin.
   *
   * It moves `board` and not the whole stage: the wall behind it must hold
   * still, or the shake drags the backdrop off the edge of the glass and a band
   * of empty canvas flashes along the side of the phone. (The old build got
   * away with shaking everything only because the canvas ended exactly where
   * the board did.) The offsets stay in DESIGN px, so the shake is the same
   * fraction of the board on every screen.
   */
  private syncShake(dt: number): void {
    if (this.shake <= 0) return;
    this.shake -= dt;
    if (this.shake <= 0) {
      this.shake = 0;
      this.layers.board.position.set(0, 0);
      return;
    }
    this.layers.board.position.set(
      (Math.random() * 2 - 1) * SHAKE_INTENSITY * DESIGN_W,
      (Math.random() * 2 - 1) * SHAKE_INTENSITY * DESIGN_H,
    );
  }

  /**
   * Reference-video ring rules. Board ready + nobody aiming: every grabbable
   * duck wears the circular green ring. While aiming: everything goes quiet
   * except the HELD duck, which swaps to the rig's `aim` teardrop, its tip
   * rotated live toward the launch direction. Any other time — a duck sliding,
   * a fuse burning, a chain unwinding, the field still refilling — no rings at
   * all. The ring is an OFFER, so it may only be up when the offer is real.
   */
  private syncRings(pv: AimPreview | null, dt: number): void {
    const aiming = this.director.slingshot.aiming;
    const held = aiming ? this.director.slingshot.pull?.duck.id ?? null : null;
    // One board-wide gate, deliberately not a per-duck one. The old test mixed
    // `anyLive` with per-duck flags, and every hole was in the same place: a
    // duck knocked by a collision drifts with `live` false, a duck on a fuse
    // left its NEIGHBOURS ringed, and a popped duck is out of world.ducks
    // entirely so no per-duck flag could speak for the gap it left behind.
    const ready = this.boardReady();
    for (const d of this.director.world.ducks) {
      const v = this.duckViews.get(d.id);
      if (!v) continue;
      if (d.id === held) {
        this.setRingMode(d.id, v, 'aim');
      } else if (!aiming && ready) {
        this.setRingMode(d.id, v, 'ring');
      } else {
        this.setRingMode(d.id, v, null);
      }
      // Let go without firing — a refused shot on the red X, or a pull under the
      // whiff threshold — and the duck never becomes live, so `duckStopped`
      // never comes for it. Without this it would sit frozen in its aim facing
      // for the rest of the level.
      if (d.id !== held && !d.live) this.setTurn(d.id, v, null);
    }
    // steer the sling: rotate the assembly toward the (assist-bent) launch
    // direction and scrub the stretch by how far the player has pulled
    // Nobody is holding anything, so nothing owns the spring. The load-bearing
    // reset is startAim()'s, on the frame a grab BEGINS — see the note there.
    if (held === null) {
      this.aimFacing = null;
      this.aimFacingVel = 0;
    }
    if (held !== null) {
      const hv = this.duckViews.get(held);
      const pull = this.director.slingshot.pull;
      if (hv && pull) {
        // Steer by the LAUNCH DIRECTION, never by points[0]->points[1]. A leg
        // that ends on a wall reports collideCircle's corrected centre, which is
        // off the ray, so reading the angle back off the path swung the duck
        // about whenever the aim crossed between a duck, a wall and open water.
        //
        // facing() rather than pv.dir: the same direction, but alive from the
        // first pixel of the drag instead of only once the pull clears MIN_PULL.
        // Waiting for pv left the rig in its setup pose until the threshold and
        // then snapped it onto the aim.
        const aim = this.director.slingshot.facing();
        if (aim) {
          // rig space is y-up, stage y-down: negate the screen angle
          const want = (-Math.atan2(aim.y, aim.x) * 180) / Math.PI;
          if (this.aimFacing === null) {
            this.aimFacing = want; // first frame of a grab: start where it aims
            this.aimFacingVel = 0;
          } else {
            const sp = springAngle(
              this.aimFacing, this.aimFacingVel, want, AIM_FACING_W, dt,
            );
            this.aimFacing = sp.angle;
            this.aimFacingVel = sp.vel;
          }
          const rigDeg = this.aimFacing;
          this.aimBoneRot.set(held, rigDeg);
          // …and turn the duck itself to face the same way, so pulling back
          // toward yourself shows you its back rather than its eyes
          this.setTurn(held, hv, rigDeg);
        }
        const entry = hv.state.getCurrent(T_RING);
        if (entry && entry.animation?.name === 'aim') {
          // Scrub CONTINUOUSLY across MIN_PULL. Both arms used to scale the same
          // `len / AIM_PULL_FULL` ramp, so at the threshold the scrub leapt from
          // ~0.03 to ~0.29 of the animation and the duck's art visibly snapped
          // back mid-drag. Below the threshold the sling now wakes from nothing
          // to exactly MIN_T over the whiff zone, and above it carries on from
          // MIN_T to MAX_T — the two arms meet at the same value.
          const stretch = pull.len < SIM.MIN_PULL
            ? (pull.len / SIM.MIN_PULL) * AIM_PULL_MIN_T
            : AIM_PULL_MIN_T + Math.min(
              1, (pull.len - SIM.MIN_PULL) / (AIM_PULL_FULL - SIM.MIN_PULL),
            ) * (AIM_PULL_MAX_T - AIM_PULL_MIN_T);
          entry.trackTime = stretch * entry.animation.duration;
        }
      }
    }

    // The aim resting on a duck of the HELD duck's colour is the one preview
    // that promises a pop, so the target says so itself. Same gate as the red
    // contact crescent (a 'duck' hit is the only legal shot), narrowed to a
    // colour match — a different colour is a legal shot but not a match, and
    // marking it would be a lie.
    let mark: number | null = null;
    if (held !== null && pv?.hitKind === 'duck' && pv.hitId !== null) {
      const shooter = this.director.slingshot.pull?.duck;
      const struck = this.director.world.ducks.find((k) => k.id === pv.hitId);
      // a struck duck already spoken for (matched, or mid-pop) is not a target
      if (shooter && struck && struck.colour === shooter.colour && !struck.popping && !struck.matched) {
        mark = struck.id;
      }
    }
    this.setTargeted(mark);
  }

  /**
   * Mark the duck the aim is promising to pop: the rig's own `targeted` react —
   * a 33px hop with a squash-and-settle and the happy eyes, measured off the
   * .skel — plus its `glow` pulse held for as long as the aim stays there.
   *
   * The hop fires ONCE per acquisition rather than looping. It is a reaction:
   * the duck notices you, then sits there glowing. Looping it would have the
   * target bouncing every 0.53s for as long as you hold the drag, which reads
   * as an idle animation rather than an answer to the aim.
   *
   * `targeted` is one-shot with `idle` queued behind it, so the body restores
   * itself and clearing only has to deal with the glow. That also means letting
   * go mid-hop lets the hop finish instead of snapping back.
   *
   * (`jump` is the other candidate and is deliberately not used here: measured,
   * it lifts 73px against this one's 33 — and it is already the match reaction,
   * so reusing it would make "about to match" and "matched" the same picture.)
   */
  private setTargeted(id: number | null): void {
    if (this.targetedDuck === id) return;
    const prev = this.targetedDuck === null ? null : this.duckViews.get(this.targetedDuck);
    if (prev) prev.state.setEmptyAnimation(T_GLOW, GLOW_FADE);
    this.targetedDuck = id;
    if (id === null) return;
    const v = this.duckViews.get(id);
    if (!v) {
      this.targetedDuck = null;
      return;
    }
    v.state.setAnimation(T_BODY, 'targeted', false);
    v.state.addAnimation(T_BODY, 'idle', true, 0);
    v.state.setAnimation(T_GLOW, 'glow', true);
  }

  /**
   * Point the duck along the shot. `turn` replaces `idle` on the body track and
   * is held at timeScale 0 — nothing about it plays, it is a lookup table for
   * facings that we index with trackTime (see turnTimeFor).
   *
   * Passing null hands the body back to `idle`. That is deliberately NOT done on
   * release: a duck that snapped back to front-on the instant it launched would
   * pop, so the facing is kept through the flight and only surrendered once the
   * sim reports the duck stopped.
   */
  private setTurn(id: number, v: Spine, rigDeg: number | null): void {
    if (rigDeg === null) {
      if (!this.turning.delete(id)) return;
      v.state.setAnimation(T_BODY, 'idle', true);
      return;
    }
    if (!this.turning.has(id)) {
      v.state.setAnimation(T_BODY, 'turn', true).timeScale = 0;
      this.turning.add(id);
    }
    const entry = v.state.getCurrent(T_BODY);
    // guard the name: a `jump` or `dance` can be stacked on this track by other
    // code paths, and scrubbing THAT would freeze it mid-pose
    if (entry && entry.animation?.name === 'turn') {
      entry.trackTime = turnTimeFor(rigDeg);
    }
  }

  /**
   * The view's half of "ready for the next move".
   *
   * The sim answers for the board itself (settled, whole, and the shot actually
   * allowed — see Director.readyForInput). The two clauses below are the part
   * the sim cannot see: a respawned duck is in `world.ducks` from the frame it
   * spawns, but its VIEW is either not built yet (still queued) or is a dot
   * growing through SPAWN_SCALE_TIME. Ringing that reads as the board being
   * ready a third of a second before the ducks have finished arriving, which is
   * exactly the "returned/respawned" case the rings must wait out.
   */
  private boardReady(): boolean {
    return (
      this.director.readyForInput
      && this.spawnQueue.length === 0
      && this.spawning.size === 0
    );
  }

  /**
   * Has the board finished MOVING — the same question minus "may the player
   * shoot", which is meaningless once the level is decided (won and failed both
   * bar the slingshot). This is what the end-of-level banner waits on.
   */
  private boardComplete(): boolean {
    return (
      this.director.boardComplete
      && this.spawnQueue.length === 0
      && this.spawning.size === 0
    );
  }

  /**
   * Build (or retire) the idle teaching shot for the board just loaded.
   *
   * ONLY THE AD'S OWN BEATS. The run the viewer sees is AD_SCRIPT and nothing
   * else, so that is the whole audience for a hint; the dev level picker and the
   * level-1 tap tutorial keep the boards they had. Asking the script rather than
   * hard-coding two indices means the gate follows the script if it is ever
   * re-cut.
   *
   * One instance for the run, re-parented per level: loadLevel empties the fx
   * layer, and a rig that answered to nothing but its own constructor would
   * quietly stop being drawn on the second board.
   */
  private syncIdleDemo(): void {
    const wanted = AD_SCRIPT.some((b) => b.level === this.director.levelIndex);
    if (!wanted) {
      this.idleDemo?.reset(this.fx);
      this.idleDemo = null;
      this.syncHint(); // the line belongs to the same boards the hand does
      return;
    }
    if (this.idleDemo) {
      this.idleDemo.reset(this.fx);
      this.syncHint();
      return;
    }
    // `director` is a GETTER, not a captured reference: loadLevel builds a new
    // Director for every board, and a host holding the one that existed when the
    // demo was constructed would be driving last level's slingshot.
    const scene = this;
    this.idleDemo = new IdleDemo({
      get director(): Director { return scene.director; },
      ready: () => this.boardReady() && this.hitstop === 0 && this.endCard === null
        && !this.director.slingshot.aiming && this.activePointer === null,
      grab: (): void => {
        // the same sound the player's grab makes, from the same event map entry:
        // the demo is showing the gesture, so it should sound like the gesture
        this.audio.play('launchPull');
        // …and the same fresh start for the facing, so a demo taking the sling
        // back off a player's cancelled grab does not sweep round either
        this.startAim();
      },
      release: (id, fired): void => this.endAim(id, fired),
    }, this.handData, this.fx);
    this.syncHint();
  }

  /**
   * The instruction is up wherever the teaching hand is — the same boards, for
   * the same reason — and it is not re-shown on the second beat once the player
   * has fired: somebody who has taken a shot has read it.
   */
  private syncHint(): void {
    if (!this.hintText) return;
    this.hintText.visible = this.idleDemo !== null && !this.hintSpent;
  }

  /** the player has shot: the line has done its job and gets out of the way */
  private spendHint(): void {
    if (this.hintSpent) return;
    this.hintSpent = true;
    if (this.hintText?.visible) this.hintFading = HINT_FADE;
  }

  private setRingMode(id: number, v: Spine, mode: 'ring' | 'aim' | null): void {
    const cur = this.ringMode.get(id) ?? null;
    if (cur === mode) return;
    if (mode === 'ring') {
      // `active` attaches the ring to its slots and scales it in; it doesn't loop,
      // so the entry holds the last frame and the ring simply stays up
      v.state.setAnimation(T_RING, 'active', false);
      this.ringMode.set(id, 'ring');
    } else if (mode === 'aim') {
      // THE AIM OWNS `master` FROM HERE, so nothing above it may still be keying
      // that bone. T_SPAWN outranks this track and `spawn_enter` keys `master`
      // and `head*` — and boardReady only waits out the 200ms scale-in TICKER,
      // never the animation, which runs longer. So a duck grabbed as soon as the
      // board opens is still pinned by its own entrance: measured, the pull-back
      // recoil stayed at 0 for the whole 450ms drag and then slid in over the
      // 0.1s the spawn entry took to mix out — the duck reaching the band's edge
      // a fifth of a second after the finger had stopped pulling.
      //
      // Dropping the track with no mix releases the bone on the frame of the
      // grab. All that is lost is the tail of an entrance pop on a duck somebody
      // has just taken hold of, which is not a pose worth defending.
      v.state.setEmptyAnimation(T_SPAWN, 0);
      // frozen at t=0 — syncRings scrubs trackTime along the pull each frame
      const entry = v.state.setAnimation(T_RING, 'aim', false);
      entry.timeScale = 0;
      this.ringMode.set(id, 'aim');
    } else {
      // mixing out to empty restores the setup pose — i.e. detaches everything
      v.state.setEmptyAnimation(T_RING, 0);
      this.ringMode.delete(id);
      this.aimBoneRot.delete(id);
    }
  }

  private drainEvents(): void {
    this.crateFlinched.clear();
    for (const e of this.director.drained.splice(0, this.director.drained.length)) {
      this.onEvent(e);
    }
  }

  /**
   * The crate's little bounce: `hit` layered over whatever damage stage it is
   * wearing, plus the knock.
   *
   * Every duck that touches a crate gets one — that is what `barrelBumped`
   * exists to say. It used to hang off `barrelDamaged` instead, which at the
   * time asked a narrower question (was the approach past a speed bar, and was
   * the crate's one-stage-per-0.2s cooldown clear), so one campaign contact in
   * ten bounced the duck off a crate that never moved. Both of those gates are
   * gone now — every contact costs a stage — so the two events fire together
   * on an ordinary hit. They stay separate all the same: `barrelBumped` asks
   * "was it touched", `barrelDamaged` "what is it wearing now", and only the
   * second one is meaningful for a blast, which damages without touching.
   *
   * Once per crate per drain. A drain is one rendered frame however many sim
   * steps it swallowed, so two collisions close enough to collapse here were
   * never going to be two visible flinches — and collapsing them keeps a blast
   * that also damages the crate from double-triggering the knock.
   */
  private flinchBarrel(id: number, speed: number): void {
    if (this.crateFlinched.has(id)) return;
    this.crateFlinched.add(id);
    const v = this.barrelViews.get(id);
    if (v) {
      v.state.setAnimation(1, 'hit', false);
      v.state.addEmptyAnimation(1, 0.1, 0);
    }
    this.audio.play('crateHit', { gain: impactGain(speed) });
  }

  private onEvent(e: SimEvent): void {
    switch (e.type) {
      case 'duckSpawned':
        // views appear one per 55ms via the spawn queue (official enqueueSpawn);
        // until then the sim duck exists with no view — every view lookup in
        // this file already tolerates that
        this.spawnQueue.push(e.duck);
        break;
      case 'duckLaunched':
        this.audio.play('launchRelease');
        break;
      case 'duckBumped':
        this.audio.play('duckBump', { gain: impactGain(e.speed) });
        break;
      case 'duckStopped': {
        // the shot is over: give the body back to the idle loop. Held until now
        // so the duck keeps facing the way it was fired for the whole flight
        // rather than snapping front-on the instant it leaves the sling.
        const v = this.duckViews.get(e.id);
        if (v) this.setTurn(e.id, v, null);
        this.audio.play('duckSettle');
        break;
      }
      case 'duckMatched': {
        const v = this.duckViews.get(e.id);
        const d = this.director.world.ducks.find((k) => k.id === e.id);
        // The match sound is for a MATCH — "same-colour match forms (collide +
        // flag)", per the event map. `blast` also routes through flagMatched to
        // start its victims blinking, and 15% of all duckMatched are that
        // (measured); those are not matches, they are chain casualties, and the
        // explosion that doomed them has already sounded. popOnSettle is exactly
        // the flag that tells the two apart, and it is set before this drain.
        if (d && !d.popOnSettle) this.audio.play('duckMatch');
        if (v && d) {
          // official hit(): the rig's own `jump`, then back to idle
          v.state.setAnimation(T_BODY, 'jump', false);
          v.state.addAnimation(T_BODY, 'idle', true, 0);
          this.punch(v);
          this.burst(d.x, d.y, BURST_TINTS[d.colour], MATCH_BURST);
        }
        break;
      }
      case 'duckPopped': {
        const v = this.duckViews.get(e.id);
        if (v) {
          this.duckViews.delete(e.id);
          this.ringMode.delete(e.id);
          this.aimBoneRot.delete(e.id);
          // its view is about to be destroyed, so drop the mark rather than
          // leave it pointing at a dead id
          if (this.targetedDuck === e.id) this.targetedDuck = null;
          this.turning.delete(e.id);
          this.killWake(e.id);
          this.popDuck(v);
        }
        this.flashOn.delete(e.id);
        this.flashSlots.delete(e.id);
        this.splash(e.x, e.y, e.colour);
        this.hitstop = HITSTOP;
        this.shake = SHAKE_TIME;
        this.audio.play('duckExplode');
        break;
      }
      case 'blast':
        // DELIBERATELY no visual and no sound of its own: the real-game
        // footage (Explosion.mp4) shows nothing at the blast radius — the pop
        // splash is the whole read — and `blast` lands on the same tick as its
        // `duckPopped`, whose duck-explode clip covers both.
        break;
      case 'wallHit':
        if (e.source === 'bumper') this.burst(e.x, e.y, 0xffb459, 0.8);
        else this.wallFoam(e.x, e.y, e.nx, e.ny);
        // the pink wall tips fling harder than the tub wall, so they get the
        // slightly brighter read; both are the substituted bump sample
        this.audio.play('wallBump', {
          gain: impactGain(e.speed) * (e.source === 'bumper' ? 1.25 : 1),
          rate: e.source === 'bumper' ? 1 : 0.82,
        });
        break;
      case 'barrelSpawned':
        this.addBarrel(e.barrel);
        break;
      case 'barrelBumped':
        this.flinchBarrel(e.id, e.speed);
        break;
      case 'barrelDamaged': {
        const v = this.barrelViews.get(e.id);
        if (v) {
          const b = this.director.world.barrels.find((k) => k.id === e.id);
          if (b) v.state.setAnimation(0, stageFor(b), false);
        }
        // A stage lost to a BLAST has no contact behind it and so no
        // `barrelBumped` — it still deserves the flinch, at the full gain this
        // used to play at. When a duck did the damage its bump has already
        // landed (world pushes it first) and this is a no-op.
        this.flinchBarrel(e.id, SIM.LAUNCH_SPEED);
        break;
      }
      case 'barrelDestroyed': {
        const v = this.barrelViews.get(e.id);
        if (v) {
          this.barrelViews.delete(e.id);
          // Reference (wallBounce f226-f240): the crate is gone almost at once
          // under a white puff with wood chips scattering; ~0.33s total. Play the
          // rig's authored 0.1s break, yank the alpha fast, and layer the puff.
          v.state.setAnimation(0, 'hp0', false);
          let t = 0;
          const fade = (tk: { deltaMS: number }): void => {
            const step = tk.deltaMS / 1000;
            t += step;
            // it left barrelViews, so syncViews no longer ticks it and autoUpdate
            // is off — drive the hp0 break pose here or it freezes mid-fade
            v.update(step);
            v.alpha = Math.max(0, 1 - t / 0.15);
            if (t >= 0.15) {
              this.app.ticker.remove(fade);
              this.cratePool.release(v);
            }
          };
          this.app.ticker.add(fade);
        }
        this.crateBreak(e.x, e.y);
        this.audio.play('crateSmash');
        break;
      }
      case 'clamSpawned':
        this.addClam(e.clam);
        break;
      case 'clamOpened':
        // "opened" is the sim's word for "this shell reacted and paid out", and
        // it now lands on EVERY contact with an armed shell — including one
        // arriving while the last hit's animation is still running, which
        // restarts it from the top. That is the point: the routine is what the
        // player reads as the hit registering.
        this.reactClamView(e.id);
        this.audio.play('clamCrack');
        break;
      case 'pearlReleased':
        // No delay on either side. hitClam pushes this on the impact tick, in
        // the same drain as the `clamOpened` that jolts the shell and the
        // `bumperHit` that flings the duck, so the pearl leaves as the shell is
        // struck.
        this.releasePearl(e.pearl, e.x, e.y);
        break;
      case 'pearlCollected':
        // the sim says it has arrived — land it NOW, whatever the tween thinks
        this.pearlFlights.get(e.pearl)?.();
        // win-whoosh's source file is sfx_ui_pointWhoosh_01.wav — the game's
        // points-fly-to-the-counter whoosh. A pearl reaching the HUD counter is
        // exactly that, so this is the clip's own job, not a substitution.
        this.audio.play('pointWhoosh', { gain: 0.8 });
        break;
      case 'clamClosed':
        // NO VIEW WORK, and this is the fix for "the oyster reacts after the
        // duck has already gone". The sim emits this CLAM_CYCLE_TICKS (1.00s)
        // after the hit — it is a timer expiring, not an event the player can
        // see a cause for. It used to play `bump-inactive`, an impact
        // jolt, a full second after the duck had bounced off and left. The shell
        // has been sitting shut since the impact frame, so there is nothing left
        // to close.
        break;
      case 'clamsSpent':
        // Deliberately no view work. A spent clam is already sitting in the
        // rig's `inactive` (shut, dormant) pose, because that is where every
        // close leaves it — and the sim has stopped triggering it, so it simply
        // never animates again. It stays visible and still bounces ducks.
        break;
      case 'pearlCounter':
        this.pearlGroup.visible = e.total > 0;
        // the reference shows what is LEFT to do, not a done/total fraction
        this.setGoal(this.pearlText, this.pearlCheck, e.left);
        break;
      case 'bumperHit':
        // fires on every glancing contact, so it stays to one cheap star
        this.burst(e.x, e.y, CLAM_TINT, 0.5);
        // the event carries no speed (the fling is a fixed kick), so unlike the
        // other two tick voices this one cannot be scaled by impact force
        this.audio.play('clamBump');
        break;
      case 'levelStarted':
        // The campaign trace, DEV ONLY — an ad has no console worth writing to.
        // The guard has to sit at the CALL, not inside a devLog helper: Rollup
        // empties a helper whose body is `if (false)` but still emits the call
        // and builds its template literal, and all three of these strings were
        // then findable in dist/index.html. Inline, `import.meta.env.DEV` is
        // statically false and the whole statement goes. Verified by grepping
        // the built file, which is the only way to know.
        if (import.meta.env.DEV) console.log(`level ${e.index + 1}: ${e.name} — ${e.moves} moves`);
        break;
      case 'movesLeft':
        // The move budget still binds — the sim refuses a grab once it is spent
        // — but the bar's digit tiles now carry the clock, so nothing in the HUD
        // shows it. Left as a case so the event stays explicitly handled.
        break;
      case 'counter':
        // crates REMAINING, to read the same way as the pearl count beside it
        this.setGoal(this.goalText, this.goalCheck, Math.max(0, e.total - e.done));
        break;
      case 'levelCleared': {
        if (import.meta.env.DEV) console.log(`level ${e.index + 1} CLEARED with ${e.movesLeft} moves to spare`);
        this.celebrate();
        this.audio.play('pointWhoosh');
        this.applyOutcome(true, LEVEL_ADVANCE_DELAY, this.director);
        break;
      }
      case 'levelFailed': {
        if (import.meta.env.DEV) console.log(`level ${e.index + 1} FAILED — out of ${e.reason}`);
        // DELIBERATELY SILENT. The event map lists LoseTitle_Enter but at
        // priority `nice`, and no fail clip was extracted from the bank — there
        // is no studio lose sting to play. Pitching some other clip down to fake
        // one would be inventing a sound the game does not have, so the cold
        // flash carries the beat on its own.
        this.lament();
        this.applyOutcome(false, LEVEL_RETRY_DELAY, this.director);
        break;
      }
      default:
        break; // finaleArmed/won ride on levelCleared; end-card UI is a later change
    }
  }

  /**
   * Act on what the ad script decided. The scene does not know which board is
   * which beat, or whether an ending is terminal — flow.ts owns that, and this
   * only turns its answer into pixels.
   *
   * Bound to `dir`, the Director that produced the result: if the board is
   * swapped by hand (the dev level picker) before the delay elapses, a stale
   * decision must not yank the player off the level they just chose.
   *
   * THE RESULT DOES NOT INTERRUPT THE TURN (user-locked 2026-08-07). `won` is
   * latched the instant the last goal falls, which is normally mid-chain — the
   * blast that broke the crate is still throwing ducks around — so a banner on
   * a fixed delay lands on top of the shot that earned it. `afterSettled` holds
   * it until the board has stopped moving AND is whole again.
   */
  private applyOutcome(cleared: boolean, delay: number, dir: Director): void {
    const o = outcomeFor(dir.levelIndex, cleared);
    this.afterSettled(delay, () => {
      if (this.director !== dir) return;
      switch (o.kind) {
        case 'restart':
          this.loadLevel(dir.levelIndex);
          break;
        case 'advance':
          this.loadLevel(o.level);
          break;
        case 'card': {
          if (this.endCard) break; // never stack two cards
          // The clock can expire while a demo gesture is mid-drag — the board is
          // settled, which is exactly when the failure lands — so the card can
          // arrive over a hand that is still reaching. Drop it: the run is over
          // and there is nothing left to teach.
          this.idleDemo?.abort();
          const prepared = this.preparedCards?.level === dir.levelIndex
            ? this.preparedCards.byResult.get(cleared)
            : undefined;
          if (prepared) {
            // ownership moves to endCard — loadLevel destroys it from there
            this.preparedCards!.byResult.delete(cleared);
            this.endCard = prepared.root;
            prepared.show();
          } else {
            this.endCard = showEndCard(
              this.app, this.layers.overlay, this.endCardTex, this.cardOpts(o),
            );
          }
          // the card idles under a human's read-and-tap — quiet frames, so the
          // NEXT board's verdict cards rasterize here, one per beat
          if (o.buttonAction === 'advance' && o.advanceTo !== null) {
            const next = o.advanceTo;
            const still = (): boolean =>
              this.director.levelIndex === dir.levelIndex || this.director.levelIndex === next;
            this.afterSettled(0.4, () => { if (still()) this.prepareEndCard(next, false); });
            this.afterSettled(0.8, () => { if (still()) this.prepareEndCard(next, true); });
          }
          break;
        }
      }
    });
  }

  /** EndCardOpts for a card outcome — one voice for the instant and prepared paths. */
  private cardOpts(o: Outcome & { kind: 'card' }): EndCardOpts {
    // ui-click first, then open — window.open MUST run synchronously
    // inside the gesture or the popup blocker eats it
    const openStore = (): void => {
      this.audio.play('uiClick');
      window.open(STORE_URL, '_blank');
    };
    return {
      title: o.title,
      subtitle: o.subtitle,
      buttonLabel: o.buttonLabel,
      storeLink: o.storeLink,
      onButton: () => {
        if (o.buttonAction === 'store') {
          openStore();
          return;
        }
        this.audio.play('uiClick');
        if (o.advanceTo !== null) this.loadLevel(o.advanceTo);
      },
      onStore: openStore,
    };
  }

  /** Build the card `outcomeFor(level, cleared)` would raise, hidden and ready.
   *  No-op when that outcome is not a card (off-script boards) or it already
   *  exists; a level change drops the stale set first. */
  private prepareEndCard(level: number, cleared: boolean): void {
    const o = outcomeFor(level, cleared);
    if (o.kind !== 'card') return;
    if (this.preparedCards && this.preparedCards.level !== level) this.dropPreparedCards();
    this.preparedCards ??= { level, byResult: new Map() };
    if (this.preparedCards.byResult.has(cleared)) return;
    this.preparedCards.byResult.set(
      cleared,
      buildEndCard(this.app, this.layers.overlay, this.endCardTex, this.cardOpts(o)),
    );
  }

  private dropPreparedCards(): void {
    if (!this.preparedCards) return;
    for (const c of this.preparedCards.byResult.values()) c.root.destroy({ children: true });
    this.preparedCards = null;
  }

  /**
   * Swap the board for another level, keeping every loaded rig and texture.
   * Everything that keys off a duck/barrel/clam id has to go, because the next
   * Director starts its ids from 1 again — a surviving entry would be claimed by
   * an unrelated entity. In-flight fx are only unparented, not destroyed: they
   * are sub-second and their own ticker callbacks dispose of them, whereas
   * destroying them here would pull the rug out mid-tween.
   */
  loadLevel(index: number): void {
    this.viewEpoch++; // strands every lingering per-view closure — see viewEpoch
    // the card belongs to the board that raised it
    if (this.endCard) {
      this.endCard.destroy({ children: true });
      this.endCard = null;
    }
    // prepared verdicts belong to their board too — and the new board, if
    // scripted, rasterizes its own during its first settled beats (idempotent
    // against the win-card idle having already built them)
    if (this.preparedCards && this.preparedCards.level !== index) this.dropPreparedCards();
    if (AD_SCRIPT.some((b) => b.level === index)) {
      const quiet = (cleared: boolean) => (): void => {
        if (this.director.levelIndex === index && !this.endCard) {
          this.prepareEndCard(index, cleared);
        }
      };
      this.afterSettled(0.4, quiet(false));
      this.afterSettled(0.8, quiet(true));
    }
    // nothing from the old board may bleed over the new one. Safe against the
    // celebration too: pointWhoosh is 0.39s and the swap is 1.8s behind it.
    this.audio.stopAll();
    for (const v of this.duckViews.values()) this.duckPool.release(v);
    for (const v of this.barrelViews.values()) this.cratePool.release(v);
    for (const v of this.clamViews.values()) this.oysterPool.release(v);
    this.duckViews.clear();
    this.barrelViews.clear();
    this.clamViews.clear();
    this.fx.removeChildren();
    this.fxUnder.removeChildren();
    if (this.hand) {
      this.fx.addChild(this.hand);
      this.hand.visible = index === 0; // the tutorial only greets level 1
    }
    this.syncIdleDemo();
    this.spawnQueue.length = 0;
    this.spawning.clear();
    this.pearlFlights.clear();
    this.setTimer(LEVEL_SECONDS, true);
    this.ringMode.clear();
    this.aimBoneRot.clear();
    this.targetedDuck = null;
    this.turning.clear();
    this.flashOn.clear();
    this.flashSlots.clear();
    this.hitstop = 0;
    this.shake = 0;
    this.accumulator = 0;
    this.danceTimer = 0;
    this.activePointer = null;
    this.aimLine.clear();
    this.crescent.visible = false;
    this.xMark.visible = false;
    this.aimTip.visible = false; // OFFICIAL_AIM_TIP: a sprite, so clearing the line misses it
    for (const d of this.dotPool) d.visible = false;
    // wipe the motion trail: ids restart from 1 next level, and a stale anchor
    // under a reused id would paint a streak from the old duck's last position
    for (const p of this.trailPuffs) {
      this.trailLayer.removeChild(p.s);
      this.trailPool.push(p.s);
    }
    this.trailPuffs.length = 0;
    this.trailLast.clear();
    this.layers.board.position.set(0, 0); // drop any shake offset mid-flight

    // a per-level seed keeps every level's respawns deterministic on their own
    this.director = new Director(this.seed + index, index);
    // the goal row re-centres on what the level actually has — and it must read
    // the NEW director's level: laid out any earlier, a level gaining clams
    // would surface the pearl goal wherever it last sat (unplaced, on level 1)
    this.layoutGoals();
    this.director.start();
    this.drainEvents();
  }

  /**
   * Build a view for every duck queued this frame — the whole batch arrives on
   * one beat, matching the director, which now spawns the owed ducks together
   * rather than one per RESPAWN_DELAY. The 55ms-per-duck stagger this used to
   * run (the official's enqueueSpawn cadence) would have smeared that single
   * beat back out across a fifth of a second. The scale-up in tickSpawns is
   * what still makes an arrival read as an arrival.
   */
  private drainSpawnQueue(): void {
    for (const d of this.spawnQueue.splice(0, this.spawnQueue.length)) {
      // popped while still queued (a blast can doom a viewless duck), or a view
      // somehow already exists: drop it silently
      if (!this.director.world.ducks.includes(d) || this.duckViews.has(d.id)) continue;
      this.addDuck(d);
    }
  }

  private addDuck(d: Duck): void {
    const s = this.duckPool.acquire();
    s.skeleton.setSkin(this.duckSkins.get(d.colour)!);
    s.skeleton.setSlotsToSetupPose();
    s.state.setAnimation(T_BODY, 'idle', true);
    // one turn per 12s. It runs from birth and is never restarted, so the ring's
    // rotation is continuous across selections instead of snapping back to 0 —
    // and while no ring is attached it drives invisible bones for free.
    s.state.setAnimation(T_SPIN, 'spin_ring', true);
    // the water ripple loops forever under the duck; the desynced per-duck
    // timeScale (below) keeps the rings from pulsing in lockstep
    s.state.setAnimation(T_RIPPLE, 'ripple', true);
    s.state.timeScale = 0.8 + (d.id % 5) * 0.1;
    // entry: spawn_enter plays at TRUE speed (compensate the desync scale)
    // while the whole rig pops from ~zero with the official's Back overshoot.
    // The empty animation behind it releases `master`/`head*` when it ends.
    const enter = s.state.setAnimation(T_SPAWN, 'spawn_enter', false);
    enter.timeScale = 1 / s.state.timeScale;
    s.state.addEmptyAnimation(T_SPAWN, 0.1, 0);
    this.burst(d.x, d.y, 0xffffff, 0.7); // the official's white spawn splash
    s.scale.set(DUCK_SCALE * 0.001);
    this.spawning.add(d.id);
    let t = 0;
    const epoch = this.viewEpoch;
    const grow = (tk: { deltaMS: number }): void => {
      t += tk.deltaMS / 1000;
      // a level swap pools the rig, and the next board may reuse both the rig
      // and the duck id — hands off, without touching the new board's state
      if (epoch !== this.viewEpoch) {
        this.app.ticker.remove(grow);
        return;
      }
      // bail the moment the view stops being this duck's live view — popDuck
      // hands it to the explode animation, which owns the scale from then on
      if (s.destroyed || this.duckViews.get(d.id) !== s) {
        this.app.ticker.remove(grow);
        this.spawning.delete(d.id);
        return;
      }
      const k = Math.min(1, t / SPAWN_SCALE_TIME);
      s.scale.set(DUCK_SCALE * (0.001 + (1 - 0.001) * backOut(k)));
      if (k >= 1) {
        this.app.ticker.remove(grow);
        this.spawning.delete(d.id);
        s.scale.set(DUCK_SCALE);
      }
    };
    this.app.ticker.add(grow);
    s.position.set(d.x, d.y);
    // steer the aim teardrop after the animation is applied, before the world
    // transforms bake — the supported spine hook for per-frame bone overrides
    const bone = s.skeleton.findBone(AIM_BONE);
    const turntables = TURNTABLE_BONES.map((n) => s.skeleton.findBone(n)).filter((b) => b !== null);
    if (bone || turntables.length) {
      const id = d.id;
      s.beforeUpdateWorldTransforms = () => {
        // `turn` is the only animation in the rig that rotates these, and their
        // setup value is 0, so putting it back costs nothing anywhere else.
        for (const t of turntables) t.rotation = 0;
        const rot = this.aimBoneRot.get(id);
        if (rot !== undefined && bone) bone.rotation = rot;
      };
    }
    this.layer.addChild(s);
    this.duckViews.set(d.id, s);
  }

  private addBarrel(b: Barrel): void {
    const s = this.cratePool.acquire();
    // every crate is the plain wooden one except the finale's prize, which wears
    // the rig's gold-toned skin so the last goal is the one you can see coming
    s.skeleton.setSkinByName(b.golden ? 'yellow' : b.skin);
    s.skeleton.setSlotsToSetupPose();
    s.state.setAnimation(0, stageFor(b), false);
    s.scale.set(BARREL_SCALE);
    s.position.set(b.x, b.y);
    this.layer.addChild(s);
    this.barrelViews.set(b.id, s);
  }

  /**
   * An awake clam, sitting open-eyed in the water.
   *
   * It rests on `idle`, the awake breathing loop, and it never leaves it except
   * for the 0.30s of `bump` a hit costs. The rig's two SHUT poses (`inactive`,
   * `bump-inactive`) are deliberately unused: they swap in the closed eye3/eye4
   * set and, more to the point, an `inactive_overlay` plate that visibly darkens
   * the shell. Starting here rather than on `inactive` is why the oyster is the
   * colour of its own artwork.
   *
   * The water ring rides its own looping track exactly like the ducks'.
   */
  private addClam(c: Clam): void {
    const s = this.oysterPool.acquire();
    s.skeleton.setSkinByName(c.skin);
    // The setup pose IS the awake face: `face-up` (the lid) and `mouth-bottom`
    // detached, eye/eye2 attached, no darkening overlay. `idle` keys no
    // attachments at all, so it breathes over exactly this set and the oyster
    // sits there bright and open-eyed until something hits it.
    s.skeleton.setSlotsToSetupPose();
    // Offset rather than slowed: neighbouring clams must not breathe in
    // lockstep, but this loop is on the same track the hit one-shot lands on and
    // a track timeScale would outlive it. A phase offset costs the one-shot
    // nothing, since setAnimation gives it its own entry starting at 0.
    s.state.setAnimation(CT_SHELL, 'idle', true).trackTime = (c.id % 5) * 0.77;
    // desync the ring the way the ducks do so neighbouring clams don't pulse in
    // lockstep — but on the TRACK, not the whole state: the shell's one-shots
    // must keep true speed, since the pearl is timed against their real length
    s.state.setAnimation(CT_RIPPLE, 'ripple', true).timeScale = 0.85 + (c.id % 5) * 0.08;
    s.scale.set(CLAM_SCALE);
    s.position.set(c.x, c.y);
    this.layer.addChild(s);
    this.clamViews.set(c.id, s);
  }

  /**
   * THE WHOLE REACTION, ON THE IMPACT FRAME. One animation, then straight back
   * to the awake idle — no sequel, nothing scheduled.
   *
   * `bump` (0.30s) is the rig's own hit, played EXACTLY AS AUTHORED. Rendered
   * frame by frame (shots/probe-bump-strip.mjs, stills in shots/clam-bump-raw/)
   * it is the whole beat, all of it keyed from t=0:
   *   - `face-up` — the upper shell — attaches and rides the `mouth` bone UP,
   *     lifting like a lid. It carries the oyster's shut-eye art, so the eyes
   *     read as squeezed shut while it is up: that is the blink.
   *   - `mouth-bottom` attaches underneath, and the lid lifting is what reveals
   *     it. That is the mouth the pearl comes out of.
   *   - the `oyster` bone jolts; both come off again at t=0.300, so the mouth
   *     shuts and the open eyes return with the same key.
   * then `idle` (loop) takes over and the oyster is sitting there open-eyed
   * again, which is also where addClam leaves every clam. Struck and at-rest end
   * in the same pose, so nothing can drift between them.
   *
   * DO NOT strip `face-up` to "open the shell sooner". I did, on the reasoning
   * that a plate attached at t=0 and detached at t=0.300 must be holding the
   * shell shut for 300ms — reading the attachment flag instead of the pixels.
   * It is not a plate over the face, it is the face: remove it and the lid never
   * lifts, the mouth is a raw hole with no top shell, and the eyes vanish
   * outright because their art went with it. The bone motion opens the shell on
   * the first frame regardless of what is attached.
   *
   * What WAS firing late is gone, and it was never in this animation: the
   * shutting used to be driven off `clamClosed`, which the sim emits
   * CLAM_CYCLE_TICKS — a full second — after the hit. It played `bump-inactive`,
   * an IMPACT jolt, long after the duck had bounced away and left the area. That
   * is the "reacts after the duck has moved away" case, and it was a scheduled
   * animation rather than a physics glitch. `bump` shuts the shell itself, so
   * there is nothing left to schedule.
   *
   * `wake` on `start` hands the shut set over from wherever the shell was:
   * AnimationState drains its event queue inside update() and only poses the
   * skeleton afterwards in apply(), so the setup pose is laid down first and
   * `bump` plays over it. The same call on `complete` guarantees the open-eyed
   * set is back even if a final key never lands.
   *
   * The sim is unchanged and was never the problem: hitClam pushes `clamOpened`
   * and `pearlReleased` on the same tick as the `bumperHit` that flings the
   * duck. The view spends all three on that tick too.
   */
  private reactClamView(id: number): void {
    const v = this.clamViews.get(id);
    if (!v) return;
    const wake = (): void => v.skeleton.setSlotsToSetupPose();
    v.state.setAnimation(CT_SHELL, 'bump', false).listener = { start: wake, complete: wake };
    v.state.addAnimation(CT_SHELL, 'idle', true, 0);
  }

  /**
   * The pearl the shell spills: the pack's 52x52 glossy bead, popped in with the
   * official's Back overshoot, lifted clear of the shell, then flown up to the
   * HUD's pearl counter — where its arrival is what the player reads as the
   * count dropping.
   *
   * `id` is the PEARL's id, not the shell's: a shell pays out on every contact,
   * so a second pearl can leave while the first is still climbing, and keying
   * the flight table by shell would drop the first one's landing on the floor —
   * its tween would coast to the hold point and stall there for ever.
   *
   * The tween runs for SIM.PEARL_FLIGHT_TICKS worth of WALL time, but it is not
   * allowed to finish on its own: it stalls just short of the counter until the
   * sim emits `pearlCollected`, which calls the registered `land`. Wall time and
   * sim time genuinely do drift — `accumulator += Math.min(dt, 0.1)` drops sim
   * time after a long frame, and `hitstop` freezes the sim outright while the
   * view keeps animating, which happens on every pop. Timing the landing off the
   * clock alone would let the pearl touch the counter a beat before the number
   * moved. The sim decides when it has arrived; this only draws the trip.
   */
  private releasePearl(id: number, x: number, y: number): void {
    this.burst(x, y, CLAM_TINT, 0.8);
    this.foamFlash(x, y, CLAM_TINT);
    const p = new Sprite(this.pearlTex);
    p.anchor.set(0.5);
    p.position.set(x, y);
    p.scale.set(0);
    p.alpha = 0;
    this.fx.addChild(p);
    const flight = SIM.PEARL_FLIGHT_TICKS * SIM.DT;
    const target = this.pearlTarget;
    // lift clear of the shell first, then set off — so it reads as coming OUT of
    // the clam rather than being yanked at the HUD from the first frame
    const liftY = y - PEARL_RISE;
    let t = 0;
    // the tween coasts to here and waits; only the sim closes the last stretch
    const HOLD = 0.97;
    const land = (): void => {
      this.pearlFlights.delete(id);
      this.app.ticker.remove(anim);
      if (p.destroyed) return;
      // it lands ON its own icon in the counter
      this.burst(target.x, target.y, CLAM_TINT, 0.55);
      p.destroy();
    };
    const anim = (tk: { deltaMS: number }): void => {
      t += tk.deltaMS / 1000;
      // loadLevel unparents everything in `fx`; without this the tween would
      // outlive its own sprite and tick on for ever
      if (p.destroyed || p.parent === null) {
        this.pearlFlights.delete(id);
        this.app.ticker.remove(anim);
        if (!p.destroyed) p.destroy();
        return;
      }
      const g = quadOut(Math.min(HOLD, t / flight));
      p.scale.set(backOut(Math.min(1, t / PEARL_POP_TIME)) * (1 - 0.45 * g));
      p.alpha = Math.min(1, t / PEARL_POP_TIME);
      const rise = quadOut(Math.min(1, t / PEARL_RISE_TIME)) * PEARL_RISE;
      // travel from the lifted position to the counter; the horizontal lead runs
      // ahead of the vertical so the path bows outward instead of cutting a
      // straight diagonal across the tub
      p.x = x + (target.x - x) * quadOut(g);
      p.y = (y - rise) + (target.y - liftY) * (g * g);
    };
    this.pearlFlights.set(id, land);
    this.app.ticker.add(anim);
  }

  /**
   * The duck's own death animation: `explode` is a 0-length pose that blows the
   * head up, `explode_vfx` then scales the whole rig out over 0.17s. The view has
   * already left duckViews (its sim duck is gone, so syncViews can't position or
   * tick it) — drive it here, exactly like the barrel's hp0 fade.
   */
  private popDuck(v: Spine): void {
    v.state.clearTracks(); // drop idle + ring + spin so nothing fights the pose
    v.skeleton.setToSetupPose();
    v.state.setAnimation(0, 'explode', false);
    v.state.setAnimation(1, 'explode_vfx', false);
    v.state.timeScale = 1;
    let t = 0;
    const run = (tk: { deltaMS: number }): void => {
      const step = tk.deltaMS / 1000;
      t += step;
      v.update(step);
      if (t >= POP_TIME) {
        this.app.ticker.remove(run);
        this.duckPool.release(v);
      }
    };
    this.app.ticker.add(run);
  }

  /**
   * Official onWallHit: a soft foam smear at the contact point, widening as it
   * fades (their `foam` at alpha .5, 45×27 px growing to 81 wide, 240ms
   * QuadOut). Laid along the wall so it reads as displaced water.
   */
  private wallFoam(x: number, y: number, nx: number, ny: number): void {
    const s = new Sprite(this.blobTex);
    s.anchor.set(0.5);
    s.position.set(x, y);
    s.rotation = Math.atan2(ny, nx) + Math.PI / 2; // long axis along the wall
    s.alpha = 0.5;
    s.width = 45;
    s.height = 27;
    this.fx.addChild(s);
    let t = 0;
    const anim = (tk: { deltaMS: number }): void => {
      t += tk.deltaMS / 1000;
      const p = Math.min(1, t / 0.24);
      s.width = 45 + 36 * quadOut(p);
      s.alpha = 0.5 * (1 - p);
      if (p >= 1) {
        this.app.ticker.remove(anim);
        s.destroy();
      }
    };
    this.app.ticker.add(anim);
  }

  /** Star splash — the shipped impact-star. `k` scales it (matches use 0.7). */
  private burst(x: number, y: number, tint: number, k = 1): void {
    const s = new Sprite(this.starTex);
    s.anchor.set(0.5);
    s.position.set(x, y);
    s.tint = tint;
    s.rotation = (x + y) % Math.PI; // vary the spike angles pop to pop
    this.fx.addChild(s);
    let t = 0;
    const anim = (tk: { deltaMS: number }): void => {
      t += tk.deltaMS / 1000;
      const p = Math.min(1, t / 0.26);
      // fast out, slow settle. The 289px star ends ~115px across — a shade wider
      // than the 92px duck, like the reference splash; bigger just smears.
      s.scale.set((0.16 + 0.24 * quadOut(p)) * k);
      // hold full while the duck is still blowing up, then fade
      s.alpha = p < 0.35 ? 1 : 1 - (p - 0.35) / 0.65;
      if (p >= 1) {
        this.app.ticker.remove(anim);
        s.destroy();
      }
    };
    this.app.ticker.add(anim);
  }

  /**
   * The real game's pop splash, phase for phase off Explosion.mp4:
   *   A f118-119  an opaque white pancake snaps up under the duck while the
   *               rig's own explode bursts the body on top of it
   *   B f120-122  a star-shaped hole (water showing through) opens mid-disc;
   *               duck-coloured chips scatter across the pancake
   *   C f123-127  the pancake dissolves into white lace — thin ring, X-cross
   *               spokes, droplets — swelling slightly as everything fades
   */
  private splash(x: number, y: number, colour: Colour): void {
    const disc = new Graphics().circle(0, 0, SPLASH_R).fill(0xffffff);
    disc.position.set(x, y);
    disc.scale.set(0.25);
    const star = drawSplashStar(new Graphics());
    star.position.set(x, y);
    star.scale.set(0);
    // The lace, pre-drawn at full size and kept hidden until phase C.
    //
    // OFFICIAL_SPLASH_RING: the RING comes from `vfx/dome` instead of a 7px
    // stroke — the spokes, droplets and speckles below are drawn either way, so
    // `lace` stays a Graphics and the dome rides beside it on the same timings.
    const lace = new Graphics();
    if (!OFFICIAL_SPLASH_RING) lace.circle(0, 0, SPLASH_R).stroke({ width: 7, color: 0xffffff });
    const dome = OFFICIAL_SPLASH_RING ? new Sprite(this.domeTex) : null;
    // The scale that `width`/`height` worked out, kept so the swell below can
    // multiply it. Writing `scale.set(1.12)` directly would throw the sizing
    // away and snap the dome back to its native 403x325 — `width` IS scale.
    let domeBase = { x: 1, y: 1 };
    if (dome) {
      dome.anchor.set(0.5);
      // square on purpose — see DOME_R. The art is 403x325 and this is a
      // top-down ring, so the vertical stretch is the point, not an oversight.
      dome.width = dome.height = DOME_R * 2;
      domeBase = { x: dome.scale.x, y: dome.scale.y };
      dome.position.set(x, y);
      dome.visible = false;
    }
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      lace.moveTo(0, 0).lineTo(Math.cos(a) * SPLASH_R, Math.sin(a) * SPLASH_R)
        .stroke({ width: 5, color: 0xffffff });
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.35;
      lace.circle(Math.cos(a) * SPLASH_R * 1.1, Math.sin(a) * SPLASH_R * 1.1, 4).fill(0xffffff);
    }
    // speckles inside the ring — the video's lace keeps white flecks where the
    // pancake was, which stops the ring+cross reading as bare geometry
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 1.1;
      const rr = SPLASH_R * (0.45 + (i % 3) * 0.14);
      lace.circle(Math.cos(a) * rr, Math.sin(a) * rr, 3 + (i % 2)).fill(0xffffff);
    }
    lace.position.set(x, y);
    lace.visible = false;
    this.fxUnder.addChild(disc, star, lace);
    if (dome) this.fxUnder.addChild(dome);

    // duck-coloured chips riding the pancake outward (video: clear duck hue)
    const chips: Array<{ s: Sprite; vx: number; vy: number }> = [];
    for (let i = 0; i < SPLASH_CHIPS; i++) {
      // OFFICIAL_DEBRIS: the two `ptx-stars` sparkles, alternating, instead of
      // six copies of the single impact-star flash
      const s = new Sprite(
        OFFICIAL_DEBRIS ? this.ptxTex[i % PTX_FRAMES]! : this.starTex,
      );
      s.anchor.set(0.5);
      s.tint = TINTS[colour];
      s.rotation = i * 1.7;
      s.width = s.height = 14 + (i % 3) * 5;
      s.visible = false;
      const a = (i / SPLASH_CHIPS) * Math.PI * 2 + 0.9;
      // video f120: the chips are already spread when the star opens — they
      // ride the pancake's rim outward, they don't crawl from the centre
      s.position.set(x + Math.cos(a) * 38, y + Math.sin(a) * 38);
      const sp = 380 + (i % 2) * 140;
      chips.push({ s, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp });
      this.fxUnder.addChild(s);
    }

    let t = 0;
    const anim = (tk: { deltaMS: number }): void => {
      const dt = tk.deltaMS / 1000;
      t += dt;
      // A: the pancake snap
      const grow = Math.min(1, t / SPLASH_GROW);
      disc.scale.set(0.25 + 0.75 * quadOut(grow));
      // B: the star hole + chips
      if (t >= SPLASH_STAR_AT) {
        const q = Math.min(1, (t - SPLASH_STAR_AT) / SPLASH_STAR_TIME);
        star.scale.set(quadOut(q));
        for (const c of chips) {
          c.s.visible = true;
          c.s.x += c.vx * dt;
          c.s.y += c.vy * dt;
          c.vx *= 1 - 4 * dt; // chips settle onto the water, they don't fly off
          c.vy *= 1 - 4 * dt;
        }
      }
      // C: pancake -> lace
      if (t >= SPLASH_LACE_AT) {
        const r = Math.min(1, (t - SPLASH_LACE_AT) / (SPLASH_TIME - SPLASH_LACE_AT));
        disc.alpha = Math.max(0, 1 - r * 2.5); // the solid disc dies fast…
        star.alpha = disc.alpha;
        lace.visible = true; // …and its rim survives as the lace
        lace.scale.set(1 + 0.12 * r);
        lace.alpha = r < 0.35 ? 1 : 1 - (r - 0.35) / 0.65;
        // OFFICIAL_SPLASH_RING: the dome IS the rim, so it rides the lace's own
        // swell and fade rather than keeping a second set of numbers in step
        if (dome) {
          dome.visible = true;
          const swell = 1 + 0.12 * r;
          dome.scale.set(domeBase.x * swell, domeBase.y * swell);
          dome.alpha = lace.alpha;
        }
        for (const c of chips) c.s.alpha = lace.alpha;
      }
      if (t >= SPLASH_TIME) {
        this.app.ticker.remove(anim);
        disc.destroy();
        star.destroy();
        lace.destroy();
        dome?.destroy();
        for (const c of chips) c.s.destroy();
      }
    };
    this.app.ticker.add(anim);
  }

  /** The bloom, at any tint — the clam's pearl uses the bumper pink. */
  private foamFlash(x: number, y: number, tint: number): void {
    const s = new Sprite(this.blobTex);
    s.anchor.set(0.5);
    s.blendMode = 'add';
    s.tint = tint;
    s.position.set(x, y);
    this.fx.addChild(s);
    let t = 0;
    const anim = (tk: { deltaMS: number }): void => {
      t += tk.deltaMS / 1000;
      const p = Math.min(1, t / FLASH_TIME);
      const e = quadOut(p);
      s.width = s.height = (FLASH_R0 + (FLASH_R1 - FLASH_R0) * e) * 2;
      s.alpha = FLASH_ALPHA * (1 - e);
      if (p >= 1) {
        this.app.ticker.remove(anim);
        s.destroy();
      }
    };
    this.app.ticker.add(anim);
  }

  /**
   * Crate destruction, matched to the reference footage (wallBounce f226-f240):
   * a soft white puff swallows the crate while wooden chips scatter, all
   * resolved in about a third of a second, with a small sparkle outliving it.
   */
  private crateBreak(x: number, y: number): void {
    // the puff: opaque white cloud, quick swell then dissolve
    const puff = new Sprite(this.blobTex);
    puff.anchor.set(0.5);
    puff.position.set(x, y);
    this.fx.addChild(puff);
    let pt = 0;
    const puffAnim = (tk: { deltaMS: number }): void => {
      pt += tk.deltaMS / 1000;
      const p = Math.min(1, pt / 0.3);
      puff.width = puff.height = (60 + 55 * quadOut(p)) * 2;
      puff.alpha = p < 0.4 ? 1 : 1 - (p - 0.4) / 0.6;
      if (p >= 1) {
        this.app.ticker.remove(puffAnim);
        puff.destroy();
      }
    };
    this.app.ticker.add(puffAnim);

    // wooden chips thrown outward, sinking slightly as they fade — the star
    // sprite tints clean (the blob's dark rim turns muddy at chip size)
    for (let i = 0; i < 6; i++) {
      const chip = new Sprite(this.starTex);
      chip.anchor.set(0.5);
      chip.rotation = i * 1.1;
      chip.tint = i % 2 === 0 ? 0xE08A3C : 0xB5722F;
      chip.width = chip.height = 18 + (i % 3) * 6;
      const ang = (i / 6) * Math.PI * 2 + 0.5;
      const speed = 320 + (i % 3) * 70;
      const vx = Math.cos(ang) * speed;
      let vy = Math.sin(ang) * speed - 60;
      chip.position.set(x + Math.cos(ang) * 30, y + Math.sin(ang) * 30);
      this.fx.addChild(chip);
      let ct = 0;
      const chipAnim = (tk: { deltaMS: number }): void => {
        const dt = tk.deltaMS / 1000;
        ct += dt;
        vy += 900 * dt; // chips arc down like the reference debris
        chip.x += vx * dt;
        chip.y += vy * dt;
        chip.alpha = Math.max(0, 1 - ct / 0.35);
        if (ct >= 0.35) {
          this.app.ticker.remove(chipAnim);
          chip.destroy();
        }
      };
      this.app.ticker.add(chipAnim);
    }

    // the little sparkle that hangs around after the puff clears
    this.burst(x - 15, y - 40, 0xffffff, 0.45);
  }

  /** Squash-free scale punch on a matched duck — the official's `hit()` tween. */
  private punch(v: Spine): void {
    // a duck still inside its spawn scale-up owns its own scale — punching it
    // would snap it to full size mid-entry
    for (const [id, dv] of this.duckViews) {
      if (dv === v && this.spawning.has(id)) return;
    }
    let t = 0;
    const epoch = this.viewEpoch;
    const anim = (tk: { deltaMS: number }): void => {
      t += tk.deltaMS / 1000;
      // epoch: the rig may already be pooled (or on a new board) after a swap
      if (v.destroyed || epoch !== this.viewEpoch) {
        this.app.ticker.remove(anim);
        return;
      }
      // out then back, Quad.easeOut each leg (Phaser yoyo re-runs the ease)
      const leg = t < PUNCH_TIME ? t / PUNCH_TIME : 1 - (t - PUNCH_TIME) / PUNCH_TIME;
      const k = 1 + (PUNCH_SCALE - 1) * quadOut(Math.max(0, leg));
      v.scale.set(DUCK_SCALE * k);
      if (t >= PUNCH_TIME * 2) {
        this.app.ticker.remove(anim);
        v.scale.set(DUCK_SCALE);
      }
    };
    this.app.ticker.add(anim);
  }

  /**
   * Match blink. The official whites the duck out by copying every attachment
   * and forcing its colour to opaque white (decomp isolateAttachmentsForFlash +
   * syncMatchFlash) — this rig is built the same way, with the duck's hue living
   * in the attachment colours over neutral art. Here the hue is pulled only
   * MATCH_FLASH_MIX of the way to white: same blink, same cadence, but the duck
   * keeps reading in its own colour instead of flat white. Attachments are
   * shared across every duck of a colour, hence the per-instance copy.
   * Re-isolated at each band so an animation that swapped an attachment
   * mid-fuse can't strand a slot.
   */
  private syncMatchFlash(d: Duck, v: Spine): void {
    const on = d.matched && Math.floor(d.matchFuse / SIM.MATCH_BLINK_TICKS) % 2 === 0;
    if (on === this.flashOn.has(d.id)) return;
    if (on) {
      const slots: Array<{ color: Color; orig: [number, number, number, number] }> = [];
      for (const slot of v.skeleton.slots) {
        const att = slot.getAttachment() as (Attachment & { color?: Color; copy?: () => Attachment }) | null;
        if (!att?.color || typeof att.copy !== 'function') continue;
        const copy = att.copy() as Attachment & { color: Color };
        slot.setAttachment(copy);
        slots.push({ color: copy.color, orig: [copy.color.r, copy.color.g, copy.color.b, copy.color.a] });
      }
      for (const s of slots) {
        // part-way toward white, not onto it — a gentle brighten, same cadence
        s.color.set(
          s.orig[0] + (1 - s.orig[0]) * MATCH_FLASH_MIX,
          s.orig[1] + (1 - s.orig[1]) * MATCH_FLASH_MIX,
          s.orig[2] + (1 - s.orig[2]) * MATCH_FLASH_MIX,
          s.orig[3],
        );
      }
      this.flashSlots.set(d.id, slots);
      this.flashOn.add(d.id);
    } else {
      for (const s of this.flashSlots.get(d.id) ?? []) {
        s.color.set(s.orig[0], s.orig[1], s.orig[2], s.orig[3]);
      }
      this.flashSlots.delete(d.id);
      this.flashOn.delete(d.id);
    }
  }

  /**
   * The board reassembly's GAME HUD BAR, rebuilt to its own measurements.
   *
   * Geometry is measured, not eyeballed — see the HUD constants for where each
   * number comes from and where the real game overrides the reassembly.
   *
   * The avatar is the reassembly's own character art, staged as hud-avatar.webp
   * and drawn at its authored 84% of the frame width, bottom-aligned so it
   * breaks out of the frame's top the way it does in the game. Its frame is a
   * panel in the goals-inset style; the pack's avatar-frame.png is a blue ring
   * for a round portrait and does not match this HUD, so it is not used.
   *
   * GOALS holds one icon per goal type with its REMAINING count at the icon's
   * lower right, which is the reference's own reading — not the done/total the
   * old chips showed. Clams and crates are the two types, and the reassembly
   * assigns goal-Bumper and goal-Barrel to exactly them.
   *
   * The whole bar is pinned to the strip above the tub rim (y=200 in main.ts),
   * so it can never sit over live water.
   */
  private async buildHud(): Promise<void> {
    // Pixi rasterises text through the DOM's font set, so the face has to be
    // registered AND fully loaded before the first Text exists — a Text built
    // a frame early bakes a fallback-font texture and never re-renders itself.
    document.fonts.add(await new FontFace(HUD_NUM_FONT, `url("${asapBlackUrl}")`).load());

    const left = BAR_X - BAR_W / 2;
    const bar = new Sprite(panelTexture({
      w: BAR_W, h: BAR_H, r: BAR_RADIUS,
      fill: [[0, BAR_TOP_COL], [1, BAR_BOT_COL]],
      edge: { colour: BAR_EDGE, width: 3 },
      insets: [
        { y: 3, colour: 'rgba(255,255,255,.14)' },
        { y: -4, colour: 'rgba(0,0,0,.18)' },
      ],
      drop: { y: 4, colour: 'rgba(40,35,70,.35)' },
    }));
    bar.width = BAR_W;
    bar.height = BAR_H + 4;
    bar.position.set(left, BAR_TOP);
    // the backing goes down FIRST: everything below draws on top of it
    this.hud.addChild(bar);

    // ── the shooting instruction, across the top of the water ────────────────
    // Same face as the bar's labels so it reads as part of the furniture rather
    // than an overlay, but unboxed and slightly held back (alpha) — it is a
    // caption, not a banner. The dark stroke is what keeps it legible against
    // both the tub's pale rim and the water underneath.
    const hint = new Text({
      text: HINT_LINE,
      style: {
        fontFamily: HUD_NUM_FONT, fontSize: HINT_SIZE, fill: 0xffffff, align: 'center',
        letterSpacing: 0.5,
        stroke: { color: 0x2a3a63, width: 6, join: 'round' },
        dropShadow: { color: 0x000000, alpha: 0.3, blur: 0, angle: Math.PI / 2, distance: 2 },
      },
    });
    hint.anchor.set(0.5);
    hint.position.set(BAR_X, HINT_Y);
    hint.alpha = 0.92;
    // shrink rather than spill if the copy is ever made longer
    if (hint.width > BAR_W) hint.scale.set(BAR_W / hint.width);
    this.hud.addChild(hint);
    this.hintText = hint;
    this.syncHint();

    // content box, per the reference's 3px border + 20px side padding
    const inRight = left + BAR_W - 23 * REF_K;

    const label = (text: string, cx: number): Text => {
      const t = new Text({
        text,
        style: {
          fontFamily: HUD_NUM_FONT, fontSize: HUD_LABEL_SIZE, fill: 0xffffff, align: 'center',
          letterSpacing: 1.5,
          stroke: { color: 0x000000, width: HUD_LABEL_STROKE, join: 'round' },
          dropShadow: { color: 0x000000, alpha: 0.25, blur: 0, angle: Math.PI / 2, distance: 2 },
        },
      });
      t.anchor.set(0.5);
      // Both labels sit ON the bar's top edge, half above it and half below.
      // The offset is the gap between a Text's BOX centre (which includes the
      // descender space these all-caps labels never use) and the visual centre
      // of the caps — measured off the render, see HUD_LABEL_BASE.
      t.position.set(cx, BAR_TOP + HUD_LABEL_BASE);
      return t;
    };

    // ── TIMER: two digit tiles, zero-padded, exactly as the reference pads ──
    const tileTex = panelTexture({
      w: TILE_W, h: TILE_H, r: TILE_RADIUS,
      fill: [[0, '#ffffff'], [0.52, '#ffffff'], [0.72, '#f2effc'], [1, '#d8d2ec']],
      edge: { colour: TILE_EDGE, width: 2 },
      insets: [{ y: -5, colour: 'rgba(120,108,160,.22)' }],
      drop: { y: 2, colour: 'rgba(47,41,72,.4)' },
    });
    const tilesW = TILE_W * 2 + TILE_GAP;
    const tilesX = left + MOVES_DX;
    const tileY = BAR_TOP + MOVES_DY;
    // Each tile is a little window: the digits scroll THROUGH it, so both the
    // one leaving and the one arriving have to be clipped to the tile's own
    // rounded box or they paint over its corners and out onto the bar. One
    // Graphics carries both windows and masks both boxes.
    const clockMask = new Graphics();
    this.clockTiles = [];
    for (let i = 0; i < 2; i++) {
      const x = tilesX + i * (TILE_W + TILE_GAP);
      const tile = new Sprite(tileTex);
      tile.width = TILE_W;
      tile.height = TILE_H + 2;
      tile.position.set(x, tileY);
      clockMask.roundRect(x, tileY, TILE_W, TILE_H, TILE_RADIUS).fill(0xffffff);

      const digit = (): Text => {
        const d = new Text({
          text: '0',
          style: { fontFamily: HUD_NUM_FONT, fontSize: 52 * REF_K, fill: TILE_INK, align: 'center' },
        });
        d.anchor.set(0.5);
        d.position.set(TILE_W / 2, TILE_H / 2);
        return d;
      };
      const box = new Container();
      box.position.set(x, tileY);
      box.mask = clockMask;
      const cur = digit(), out = digit();
      out.visible = false;
      box.addChild(cur, out);

      this.clockTiles.push({ box, cur, out, ink: TILE_INK, anim: null });
      this.hud.addChild(tile, box);
    }
    this.hud.addChild(clockMask);

    // ── GOALS: the inset panel, filling the rest of the bar (CSS `flex:1`) ──
    const insetX = left + INSET_DX;
    const insetW = inRight - insetX;
    const insetY = BAR_TOP + INSET_DY;
    const inset = new Sprite(panelTexture({
      w: insetW, h: INSET_H, r: 14 * REF_K,
      fill: [[0, INSET_TOP_COL], [1, INSET_BOT_COL]],
      edge: { colour: BAR_EDGE, width: 3 },
    }));
    inset.width = insetW;
    inset.height = INSET_H;
    inset.position.set(insetX, insetY);
    this.goalsCentre = insetX + insetW / 2;
    this.goalsIconY = insetY + (INSET_H - GOAL_ICON) / 2;

    const count = (): Text => {
      const t = new Text({
        text: '',
        style: {
          // reference: 20px against its 52 icon, and a 2px outline built from
          // an 8-way text-shadow — both kept in step with the bigger icon
          fontFamily: HUD_NUM_FONT, fontSize: GOAL_ICON * (20 / 52), fill: 0xffffff, align: 'left',
          stroke: { color: 0x35304a, width: GOAL_ICON * (4 / 52), join: 'round' },
        },
      });
      t.anchor.set(0, 1); // the reference pins the count by its bottom-left
      return t;
    };

    // Both icons are staged TRIMMED, so their textures are pure art with no
    // transparent margin. Sizing by height and taking width from the texture's
    // own aspect therefore makes the two read at the same visual size while
    // each keeps its proportions — the barrel is taller than it is wide, the
    // shell nearly square, and neither is stretched to a square box.
    const goalIcon = async (url: string): Promise<Sprite> => {
      const tex = await loadTexture(url);
      const s = new Sprite(tex);
      s.height = GOAL_ICON;
      s.width = GOAL_ICON * (tex.width / tex.height);
      return s;
    };

    // The tick that replaces a count at zero: drawn (no check asset ships in
    // the pack), in the count's own visual language — the same dark outline
    // the numbers wear, filled with the game's ring green. Centred on its own
    // origin so the punch scales it in place, like the numbers do.
    const goalCheck = (): Graphics => {
      const s = GOAL_ICON * (26 / 52); // a touch bigger than the count it replaces
      const path = (g: Graphics): Graphics => g
        .moveTo(-0.42 * s, 0.04 * s)
        .lineTo(-0.1 * s, 0.34 * s)
        .lineTo(0.44 * s, -0.3 * s);
      const g = new Graphics();
      path(g).stroke({ width: 0.52 * s, color: 0x35304a, cap: 'round', join: 'round' });
      path(g).stroke({ width: 0.28 * s, color: TINTS.green, cap: 'round', join: 'round' });
      g.visible = false;
      return g;
    };

    const clamIcon = await goalIcon(clamIconUrl);
    this.pearlText = count();
    this.pearlCheck = goalCheck();
    this.pearlGroup.addChild(clamIcon, this.pearlText, this.pearlCheck);
    this.clamIcon = clamIcon;

    const crateIcon = await goalIcon(goalIconUrl);
    this.crateIcon = crateIcon;
    this.goalText = count();
    this.goalCheck = goalCheck();

    // ── the avatar, breaking out of the bar's top-left ──
    const frameX = left + AVATAR_DX, frameY = BAR_TOP + AVATAR_DY;
    const frame = new Sprite(panelTexture({
      w: AVATAR_W, h: AVATAR_H, r: 14 * REF_K,
      fill: [[0, INSET_TOP_COL], [1, INSET_BOT_COL]],
      edge: { colour: BAR_EDGE, width: 3 },
    }));
    frame.width = AVATAR_W;
    frame.height = AVATAR_H;
    frame.position.set(frameX, frameY);

    const avatarTex = await loadTexture(avatarUrl);
    const avatar = new Sprite(avatarTex);
    avatar.width = AVATAR_ART_W;
    // its own aspect, so the character is never squashed
    avatar.height = AVATAR_ART_W * (avatarTex.height / avatarTex.width);
    // bottom-centred on the frame: the overflow all goes upward, out of the bar
    avatar.position.set(
      frameX + (AVATAR_W - avatar.width) / 2,
      frameY + AVATAR_H - avatar.height,
    );
    // The frame's bottom edge, redrawn OVER the character so it reads as
    // standing IN the frame rather than in front of it. Only the bottom edge
    // and its two corners — stroking a whole rect here would draw a bar across
    // the character's chest.
    const r = 14 * REF_K;
    const bx = frameX + 1.5, by = frameY + AVATAR_H - 1.5, bw = AVATAR_W - 3;
    const lip = new Graphics()
      .moveTo(bx, by - r)
      .arcTo(bx, by, bx + r, by, r)
      .lineTo(bx + bw - r, by)
      .arcTo(bx + bw, by, bx + bw, by - r, r)
      .stroke({ color: BAR_EDGE, width: 3, alignment: 0.5 });

    // z-order: the bar is already down; the inset sits on it, the icons and
    // counts on the inset, and the labels last so they read over the top edge
    this.hud.addChild(
      inset,
      crateIcon, this.goalText, this.goalCheck,
      this.pearlGroup,
      frame, avatar, lip,
      label('TIMER', tilesX + tilesW / 2),
      label('GOALS', insetX + insetW / 2),
    );
    this.setTimer(LEVEL_SECONDS, true);
    this.layoutGoals();
  }

  /**
   * Point the countdown at a whole number of seconds, a digit per tile. Also the
   * reset path — `snap` skips the roll, for building the HUD and for a level
   * load, where the clock jumping straight to a full 30 is what you want.
   *
   * `seconds` is already the number to show: the rounding lives in
   * Director.secondsLeft, so the sim's clock and the HUD's cannot disagree. The
   * displayed value is re-derived on every call and never stepped by the
   * animation, so a roll can be late, cut short, or dropped entirely and the
   * number on screen is still right — the animation cannot skip or duplicate a
   * second because it does not own one.
   */
  private setTimer(seconds: number, snap = false): void {
    const n = Math.max(0, Math.round(seconds));
    const s = String(n).padStart(2, '0').slice(-2);
    const ink = n <= TIMER_URGENT ? TIMER_URGENT_INK : TILE_INK;
    for (const [i, t] of this.clockTiles.entries()) this.rollDigit(t, s[i]!, ink, snap);
  }

  /**
   * Scroll one tile from its current digit to a new one: the arriving digit
   * drops in from above and the leaving one drops out below, the whole column
   * moving one tile-height. Only a tile whose digit actually CHANGED rolls —
   * at 29 -> 28 the tens tile holds still, the way a real flip clock does.
   */
  private rollDigit(t: DigitRoller, value: string, ink: number, snap: boolean): void {
    // Urgency is applied to BOTH texts up front, so it lands whether or not
    // this tile is the one that changes. Without that, 11 -> 10 would turn the
    // units digit red and leave the tens dark, since only the units rolled.
    if (t.ink !== ink) {
      t.ink = ink;
      t.cur.style.fill = ink;
      t.out.style.fill = ink;
    }
    // `cur` is the digit this tile is showing OR already rolling towards, so
    // this is also what leaves a roll in flight alone. tickTimer calls in here
    // every frame; without this the roll would be torn down one frame after it
    // started and the digits would appear to snap.
    if (t.cur.text === value) return;
    // The target really did change, so any roll still in flight is landed
    // rather than blended — two overlapping scrolls on one tile read as a
    // stutter. At 0.16s against a 1s tick this only fires if the frame rate has
    // collapsed far enough to swallow a whole second.
    if (t.anim) {
      this.app.ticker.remove(t.anim);
      t.anim = null;
      this.landRoll(t);
    }
    if (snap) {
      t.cur.text = value;
      return;
    }

    const arriving = t.out;
    arriving.text = value;
    arriving.visible = true;
    arriving.position.set(TILE_W / 2, TILE_H / 2 - TILE_H);
    const leaving = t.cur;
    // roles swap now, so `cur` is the digit that will be on screen when this ends
    t.cur = arriving;
    t.out = leaving;

    let e = 0;
    const anim = (tk: { deltaMS: number }): void => {
      e += tk.deltaMS / 1000;
      const k = quadOut(Math.min(1, e / FLIP_TIME));
      arriving.y = TILE_H / 2 - TILE_H * (1 - k);
      leaving.y = TILE_H / 2 + TILE_H * k;
      if (e >= FLIP_TIME) {
        this.app.ticker.remove(anim);
        t.anim = null;
        this.landRoll(t);
      }
    };
    t.anim = anim;
    this.app.ticker.add(anim);
  }

  /** Park a roller at rest: current digit centred, spare parked and hidden. */
  private landRoll(t: DigitRoller): void {
    t.cur.position.set(TILE_W / 2, TILE_H / 2);
    t.out.visible = false;
  }

  /**
   * Place the goal icons inside the inset. The reference centres a fixed pair
   * with a 44px gap; a level with no clams shows the crate alone, so the row
   * re-centres on whatever it actually has rather than leaving a hole where the
   * clam would be.
   */
  private layoutGoals(): void {
    const showClam = this.director.level.pearls > 0;
    this.pearlGroup.visible = showClam;
    // widths differ per icon now that each keeps its own aspect, so the row is
    // measured rather than assumed
    const cw = this.clamIcon.width, bw = this.crateIcon.width;
    const span = showClam ? cw + GOAL_GAP + bw : bw;
    let x = this.goalsCentre - span / 2;
    const y = this.goalsIconY;
    // the tick sits centred over the digits' spot: the count anchors its
    // bottom-left at the icon's lower right, so the middle of a one-or-two
    // digit number is up and right of that anchor by about half a cap
    const checkAt = (g: Graphics, ax: number, ay: number): void => {
      g.position.set(ax + GOAL_ICON * (12 / 52), ay - GOAL_ICON * (10 / 52));
    };
    if (showClam) {
      this.clamIcon.position.set(x, y);
      this.pearlText.position.set(x + cw * (32 / 52), y + GOAL_ICON + GOAL_COUNT_DY);
      checkAt(this.pearlCheck, this.pearlText.x, this.pearlText.y);
      // where a spilled pearl flies to — its own icon, so it lands on the count
      this.pearlTarget = { x: x + cw / 2, y: y + GOAL_ICON / 2 };
      x += cw + GOAL_GAP;
    }
    this.crateIcon.position.set(x, y);
    this.goalText.position.set(x + bw * (32 / 52), y + GOAL_ICON + GOAL_COUNT_DY);
    checkAt(this.goalCheck, this.goalText.x, this.goalText.y);
  }

  /** Set a counter and punch it, so a cleared goal is felt. */
  private setCounter(t: Text, value: string): void {
    if (t.text === value) return;
    t.text = value;
    this.punchNode(t);
  }

  /**
   * A goal's remaining count — and, at zero, the number gives way to the green
   * tick (punched in the same way, so "done" lands with the same beat every
   * other count change has). A level load runs the same path backwards: the
   * fresh counter event brings the number back and hides the tick.
   */
  private setGoal(t: Text, check: Graphics, left: number): void {
    if (left > 0) {
      check.visible = false;
      t.visible = true;
      this.setCounter(t, String(left));
      return;
    }
    t.visible = false;
    if (!check.visible) {
      check.visible = true;
      this.punchNode(check);
    }
  }

  /** The counters' scale punch — out then back, Quad.easeOut each leg. */
  private punchNode(n: { scale: { set(v: number): unknown } }): void {
    let e = 0;
    const anim = (tk: { deltaMS: number }): void => {
      e += tk.deltaMS / 1000;
      const leg = e < HUD_PUNCH_TIME ? e / HUD_PUNCH_TIME : 1 - (e - HUD_PUNCH_TIME) / HUD_PUNCH_TIME;
      n.scale.set(1 + (HUD_PUNCH - 1) * quadOut(Math.max(0, leg)));
      if (e >= HUD_PUNCH_TIME * 2) {
        this.app.ticker.remove(anim);
        n.scale.set(1);
      }
    };
    this.app.ticker.add(anim);
  }

  /**
   * Level cleared: a longer version of the pop's own camera shake, and nothing
   * else. This used to also bloom a ring of eight big stars over the tub, fired
   * 70 ms apart around a 210x250 ellipse at k 1.3 — but a burst is an IMPACT
   * mark, and these had no impact under them: they landed on open water, at
   * ~150px each (bigger than a duck), in the pop's warm white and the clam's
   * pink, and lingered as a scatter of spiky blobs with nothing to explain
   * them. Removed 2026-08-07 at the user's request. The win card carries the
   * beat now, which is what it is for.
   */
  private celebrate(): void {
    this.shake = SHAKE_TIME * 4;
  }

  /**
   * Level failed: deliberately the opposite shape to the win — no stars, no
   * shake, one cold blue flash over the board.
   *
   * This used to sink a big stroked ring over the tub as well, expanding to 2.6x
   * over 0.6s. Removed 2026-08-07 at the user's request: arriving as the clock
   * hit zero it read as a bare circle drawn ON the screen rather than as
   * anything happening in the water, and it told the player nothing the spent
   * timer had not already said. The flash under it stays — same cold blue, but
   * it reads as part of the board.
   */
  private lament(): void {
    this.foamFlash(DESIGN_W / 2, 740, 0x3d6f8f);
  }

  /**
   * Run `fn` once the level's result is allowed to show: `delay` seconds have
   * passed AND the board has been finished for RESULT_SETTLE_HOLD. Runs on the
   * app ticker — this file's only scheduler — so a queued result pauses with the
   * tab like the rest of the fx.
   *
   * The two conditions run CONCURRENTLY, not back to back. `delay` is the beat
   * the celebration gets; the hold is the board's own resolution. On a win they
   * overlap almost entirely — the chain is unwinding through the beat — so a
   * clear that settles quickly still ends on the timing it always had, and only
   * a chain that outlives the beat pushes the card back.
   */
  private afterSettled(delay: number, fn: () => void): void {
    let t = 0; // since the result condition
    let still = 0; // consecutive seconds the board has been complete
    const wait = (tk: { deltaMS: number }): void => {
      const dt = tk.deltaMS / 1000;
      t += dt;
      still = this.boardComplete() ? still + dt : 0;
      if (t < RESULT_SETTLE_CAP && !(t >= delay && still >= RESULT_SETTLE_HOLD)) return;
      this.app.ticker.remove(wait);
      fn();
    };
    this.app.ticker.add(wait);
  }

  private syncViews(dt: number): void {
    for (const d of this.director.world.ducks) {
      const v = this.duckViews.get(d.id);
      if (v) {
        v.position.set(d.x, d.y);
        if (d.matched) this.syncMatchFlash(d, v);
        v.update(dt);
        this.syncTrail(d);
      }
    }
    this.advanceTrail(dt);
    // A crate's animations are all finite one-shots — stage poses and flinches
    // — so once the current entry has completed the rig is a held pose, and
    // updating it would re-walk every bone and re-pack every vertex each frame
    // for identical pixels (with up to 6 crates, that was a third of the
    // board's whole Spine bill). One update AFTER completion still runs so a
    // zero-length stage pose gets applied at all; then the rig sleeps until
    // the next setAnimation swaps in a fresh entry.
    for (const [, v] of this.barrelViews) {
      const e = v.state.getCurrent(0);
      if (!e) continue;
      if (e.loop || !e.isComplete()) {
        v.update(dt);
      } else if (!this.appliedBarrelPoses.has(e)) {
        v.update(dt);
        this.appliedBarrelPoses.add(e);
      }
    }
    // clams never move, but the shut pose, the open beats and the water ring
    // all need ticking (autoUpdate is off on every rig in this scene)
    for (const [, v] of this.clamViews) v.update(dt);
    if (this.hand?.visible) this.hand.update(dt);
  }

  /**
   * The official In.syncWake, line for line: speed² gate at 3 u/s, distance
   * gate at 0.4·radius since the last drop, then ONE puff 0.2u behind the duck
   * along its velocity. No per-cause wiring needed — anything that moves the
   * body (launch, bounce, blast shove, collision knock) feeds the wake, and a
   * still duck (or the hitstop freeze) emits nothing, so the wake dies with
   * the motion.
   */
  private syncTrail(d: Duck): void {
    const speed2 = d.vx * d.vx + d.vy * d.vy;
    if (speed2 < WAKE_MIN_SPEED * WAKE_MIN_SPEED) return;
    const last = this.trailLast.get(d.id);
    if (last) {
      const ddx = d.x - last.x;
      const ddy = d.y - last.y;
      if (ddx * ddx + ddy * ddy < WAKE_SPACING * WAKE_SPACING) return;
      last.x = d.x;
      last.y = d.y;
    } else {
      // official lastWakeX starts NaN: the first moving frame always emits
      this.trailLast.set(d.id, { x: d.x, y: d.y });
    }
    const inv = 1 / Math.sqrt(speed2);
    this.emitWakePuff(
      d.id, d.x - d.vx * inv * WAKE_BACK, d.y - d.vy * inv * WAKE_BACK,
      Math.atan2(d.vy, d.vx),
    );
  }

  private emitWakePuff(id: number, x: number, y: number, heading: number): void {
    if (this.trailPuffs.length >= WAKE_MAX_PUFFS) return;
    let s = this.trailPool.pop();
    if (!s) {
      s = new Sprite(this.trailTex);
      s.anchor.set(0.5);
      // the streak is authored dark-on-transparent; only additively does its
      // bright noise register and its dark half stay out of the water
      s.blendMode = 'add';
    }
    s.position.set(x, y);
    // laid along the direction of travel, keeping the texture's own aspect
    s.rotation = heading;
    s.width = WAKE_D0;
    s.height = WAKE_D0 * WAKE_ASPECT;
    s.alpha = WAKE_ALPHA;
    // Phaser's speed {min:0, max:10}: a random heading at a random dawdle
    const ang = Math.random() * Math.PI * 2;
    const drift = Math.random() * WAKE_DRIFT;
    this.trailLayer.addChild(s);
    this.trailPuffs.push({ s, t: 0, id, dx: Math.cos(ang) * drift, dy: Math.sin(ang) * drift });
  }

  /** Age every live puff — the official particle curve: linear shrink to half,
   *  linear fade to nothing, drifting all the while — then recycle. */
  private advanceTrail(dt: number): void {
    for (let i = this.trailPuffs.length - 1; i >= 0; i--) {
      const p = this.trailPuffs[i]!;
      p.t += dt;
      const q = Math.min(1, p.t / WAKE_LIFE);
      p.s.x += p.dx * dt;
      p.s.y += p.dy * dt;
      const len = WAKE_D0 * (1 - (1 - WAKE_SHRINK) * q);
      p.s.width = len;
      p.s.height = len * WAKE_ASPECT;
      p.s.alpha = WAKE_ALPHA * (1 - q);
      if (q >= 1) {
        this.trailLayer.removeChild(p.s);
        this.trailPool.push(p.s);
        this.trailPuffs.splice(i, 1);
      }
    }
  }

  /** The official killWake: a popped duck's emitter dies with it, taking its
   *  still-fading puffs along — the wake must never outlive the duck. */
  private killWake(id: number): void {
    this.trailLast.delete(id);
    for (let i = this.trailPuffs.length - 1; i >= 0; i--) {
      const p = this.trailPuffs[i]!;
      if (p.id !== id) continue;
      this.trailLayer.removeChild(p.s);
      this.trailPool.push(p.s);
      this.trailPuffs.splice(i, 1);
    }
  }

  /**
   * Reference-video aim visuals: crawling aim-dot sprites along the projected
   * path (one wall bounce), a red X wherever the path fails to reach a duck
   * (empty space, wall, or a barrel blocking the lane), the red contact
   * crescent hugging the aimed-at duck's rim, and a white billiards deflection
   * streak off a struck duck. The X is BINDING — releasing on it refuses the
   * shot (Slingshot.end() re-checks the same trajectory).
   */
  private drawAim(pv: AimPreview | null, dt: number): void {
    this.aimLine.clear();
    if (!pv) {
      this.clearAimGuides();
      return;
    }

    // --- dots along the polyline, morphing across a branch flip ---
    const path = this.buildAimPath(pv);
    // The branch identity, not the length: a hit/miss flip, a different duck or a
    // gained/lost bounce leg is a new shape, while the drag simply sweeping the
    // aim is the same shape with different numbers. Comparing lengths instead
    // would fire on a fast flick and miss a flip that happened to keep the
    // length.
    const shape = `${pv.hitKind}:${pv.hitId}:${pv.points.length}:${pv.caromEnd ? 1 : 0}`;
    if (this.aimPath && shape !== this.aimShape) {
      this.aimGhost = { segs: this.aimPath.segs, total: this.aimPath.total, t: 0 };
    }
    this.aimShape = shape;
    this.aimPath = path;

    let k = 1;
    if (this.aimGhost) {
      this.aimGhost.t += dt / AIM_MORPH_TIME;
      k = Math.min(1, this.aimGhost.t);
      if (k >= 1) this.aimGhost = null;
    }
    const ghost = this.aimGhost;
    // Both paths leave the shooter along (near enough) the same ray, so they only
    // disagree past the shorter one's end. That stretch is drawn ONCE at full
    // alpha — cross-fading it against itself would dip its brightness — and only
    // the tails beyond it trade places.
    const common = ghost ? Math.min(path.total, ghost.total) : path.total;
    let used = 0;
    used = this.emitAimDots(path, 0, common, 1, used);
    used = this.emitAimDots(path, common, path.total, k, used);
    if (ghost) used = this.emitAimDots(ghost, common, ghost.total, 1 - k, used);
    for (let n = used; n < DOT_MAX; n++) this.dotPool[n]!.visible = false;

    // --- the struck-duck guides and the red X cross-fade against each other ---
    // Each keeps its last pose while it fades, so leaving a duck lets the wedge
    // and crescent sink away where they were instead of blinking out.
    const endPt = pv.points[pv.points.length - 1]!;
    const struck = pv.hitKind === 'duck' && pv.deflect
      ? this.director.world.ducks.find((d) => d.id === pv.hitId)
      : undefined;
    if (struck && pv.deflect) {
      // Spring the ARROW'S ANGLE, exactly as the sling's facing is sprung. The
      // deflect it chases is untouched — this only decides how fast the drawn
      // arrow is allowed to catch up to it.
      const want = (Math.atan2(pv.deflect.y, pv.deflect.x) * 180) / Math.PI;
      if (this.aimArrow === null || this.aimArrowId !== struck.id) {
        // a different duck is a different arrow, not this one moved: point it
        // where it belongs rather than sweeping it across the gap
        this.aimArrow = want;
        this.aimArrowVel = 0;
      } else {
        const sp = springAngle(this.aimArrow, this.aimArrowVel, want, AIM_ARROW_W, dt);
        this.aimArrow = sp.angle;
        this.aimArrowVel = sp.vel;
      }
      this.aimArrowId = struck.id;
      const rad = (this.aimArrow * Math.PI) / 180;
      this.aimWedge = { sx: struck.x, sy: struck.y, dx: Math.cos(rad), dy: Math.sin(rad) };
    } else {
      this.aimX = { x: endPt.x, y: endPt.y };
    }
    const step = dt / AIM_MORPH_TIME;
    const want = struck ? 1 : 0;
    this.aimHit += Math.max(-step, Math.min(step, want - this.aimHit));

    // --- the pack's X wherever the shot fails to reach a duck ---
    // A sprite rather than two strokes into `aimLine`, so it carries the pack's
    // dark rim and rounded arms instead of a bare cross. It keeps the crossfade
    // it always had — the same `1 - aimHit` the strokes faded on — so sliding
    // the aim on and off a duck still dissolves between the X and the wedge
    // rather than swapping them.
    if (this.aimX && this.aimHit < 0.998) {
      this.xMark.visible = true;
      this.xMark.position.set(this.aimX.x, this.aimX.y);
      this.xMark.alpha = 0.95 * (1 - this.aimHit);
    } else {
      this.xMark.visible = false;
    }

    // --- red contact crescent on the aimed-at duck's rim ---
    if (this.aimWedge && this.aimHit > 0.002) {
      // the contact sits exactly 2R out along the deflect, so the rim direction
      // is simply the deflect reversed — no need to re-measure it
      const { sx, sy, dx, dy } = this.aimWedge;
      this.crescent.visible = true;
      this.crescent.alpha = this.aimHit;
      // past the physics radius so it clears the duck ART (~57px at this scale)
      // and sits on the ripple, like the reference frames
      this.crescent.position.set(sx - dx * (SIM.DUCK_R + 22), sy - dy * (SIM.DUCK_R + 22));
      // pill art is vertical, convex side +x: point the bulge away from the duck
      this.crescent.rotation = Math.atan2(-dy, -dx);
    } else {
      this.crescent.visible = false;
    }

    // --- white deflection wedge on a struck duck (equal-mass billiards) ---
    // The real game's arrow (wallBounce-HowToAim.mp4 ~4.7-5.1s): a solid-white
    // speech-bubble-tail — wide rounded base tucked UNDER the duck art (this
    // layer sits below the ducks, so the base fuses with the duck's white base
    // ring), both edges gently concave, sharp tip ~2.3 duck-radii from the
    // centre. Static: no pulse, it only rotates with the predicted direction.
    // OFFICIAL_AIM_TIP: the pack chevron, parked on the tip the wedge reached.
    // Same trigger, same fade, same direction — only the mark itself changes.
    if (OFFICIAL_AIM_TIP) {
      if (this.aimWedge && this.aimHit > 0.002) {
        const { sx, sy, dx, dy } = this.aimWedge;
        this.aimTip.visible = true;
        this.aimTip.alpha = 0.95 * this.aimHit;
        this.aimTip.position.set(
          sx + dx * SIM.DUCK_R * DEFLECT_TIP,
          sy + dy * SIM.DUCK_R * DEFLECT_TIP,
        );
        // dx/dy ARE the sprung direction (see where aimWedge is built), so this
        // inherits the arrow spring instead of snapping
        this.aimTip.rotation = Math.atan2(dy, dx);
      } else {
        this.aimTip.visible = false;
      }
      return;
    }
    if (this.aimWedge && this.aimHit > 0.002) {
      const { sx, sy, dx, dy } = this.aimWedge;
      const px = -dy, py = dx; // unit perpendicular
      const R = SIM.DUCK_R;
      const w = R * DEFLECT_BASE_W;
      const at = (along: number, side: number): { x: number; y: number } => ({
        x: sx + dx * R * along + px * w * side,
        y: sy + dy * R * along + py * w * side,
      });
      const b1 = at(DEFLECT_BASE, 1);
      const b2 = at(DEFLECT_BASE, -1);
      const c1 = at(DEFLECT_WAIST, DEFLECT_PINCH);
      const c2 = at(DEFLECT_WAIST, -DEFLECT_PINCH);
      const tip = at(DEFLECT_TIP, 0);
      this.aimLine
        .moveTo(b1.x, b1.y)
        .quadraticCurveTo(c1.x, c1.y, tip.x, tip.y)
        .quadraticCurveTo(c2.x, c2.y, b2.x, b2.y)
        .closePath()
        .fill({ color: 0xffffff, alpha: 0.95 * this.aimHit });
    }
  }

  /** Flatten a preview into arc-length segments — the path plus its carom leg. */
  private buildAimPath(pv: AimPreview): AimPath {
    const segs: AimPath['segs'] = [];
    let total = 0;
    const add = (a: { x: number; y: number }, b: { x: number; y: number }): void => {
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len <= 0) return;
      segs.push({ x0: a.x, y0: a.y, ux: (b.x - a.x) / len, uy: (b.y - a.y) / len, len });
      total += len;
    };
    for (let i = 0; i + 1 < pv.points.length; i++) add(pv.points[i]!, pv.points[i + 1]!);
    // The shooter's own post-collision run is MORE OF THE SAME LINE: one extra
    // segment on the same polyline, so it inherits the dot sprite, spacing,
    // size, crawl and fade instead of reproducing them. The dots simply carry on
    // round the corner at the contact point along the launched duck's new path.
    if (pv.caromEnd) add(pv.points[pv.points.length - 1]!, pv.caromEnd);
    return { segs, total };
  }

  /**
   * Lay crawling dots along one path for the arc range (fromArc, toArc], scaling
   * their alpha by `fade`. Returns the new end of the pool in use.
   *
   * The crawl offset comes from the shared aimClock, so dots emitted for the
   * ghost path land in the same phase as the live one and the two tails read as
   * one line handing over rather than two lines overlapping.
   */
  private emitAimDots(
    path: AimPath, fromArc: number, toArc: number, fade: number, used: number,
  ): number {
    if (fade <= 0.002 || toArc <= fromArc) return used;
    const offset = (this.aimClock * DOT_CRAWL) % DOT_SPACING;
    for (let n = 0; n < DOT_MAX; n++) {
      const arc = DOT_START + offset + n * DOT_SPACING;
      if (arc > toArc) break;
      if (arc <= fromArc) continue;
      if (used >= DOT_MAX) break;
      // locate arc along the polyline
      let rem = arc;
      let s = 0;
      while (s < path.segs.length - 1 && rem > path.segs[s]!.len) {
        rem -= path.segs[s]!.len;
        s++;
      }
      const seg = path.segs[s];
      if (!seg) break;
      const g = path.total > 0 ? arc / path.total : 0;
      const dot = this.dotPool[used++]!;
      dot.visible = true;
      dot.position.set(seg.x0 + seg.ux * rem, seg.y0 + seg.uy * rem);
      dot.alpha = (1 - 0.3 * g) * fade;
    }
    return used;
  }

  /** Drop every aim guide and the morph state behind it — nothing is being aimed. */
  private clearAimGuides(): void {
    for (const d of this.dotPool) d.visible = false;
    this.crescent.visible = false;
    this.xMark.visible = false;
    this.aimPath = null;
    this.aimGhost = null;
    this.aimShape = '';
    this.aimHit = 0;
    this.aimWedge = null;
    this.aimX = null;
    this.aimArrow = null;
    this.aimArrowVel = 0;
    this.aimArrowId = null;
  }
}
