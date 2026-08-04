import { Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import {
  Skin, type Attachment, type Color, type SkeletonData, type Spine,
} from '@esotericsoftware/spine-pixi-v8';
import { Director } from '../sim/director';
import { LEVELS } from '../sim/levels';
import { SIM } from '../sim/config';
import type { AimPreview } from '../sim/trajectory';
import type { Barrel, Clam, Colour, Duck, SimEvent } from '../sim/types';
import { loadSkeleton, makeSpine } from '../engine/spineLoader';

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
import aimDotUrl from '../assets/vfx/aim/aim-dot.webp';
import touchBgUrl from '../assets/vfx/aim/aim-touch-bg.webp';
import touchFrontUrl from '../assets/vfx/aim/aim-touch-front.webp';
import goalIconUrl from '../assets/icons/goal-Barrel.webp';
import clamIconUrl from '../assets/icons/goal-Bumper.webp';
import avatarUrl from '../assets/ui/hud-avatar.webp';
import cherryBombUrl from '../assets/fonts/cherry-bomb.woff2';

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
// official spawn stagger: one duck view per 55ms, each entering with a
// 300ms Back.easeOut scale-up from ~zero plus a small white star splash
const SPAWN_STAGGER = 0.055;
const SPAWN_SCALE_TIME = 0.3;
/** a random settled duck dances every 2.8s (official idle-flavor timer) */
const DANCE_PERIOD = 2.8;
// how long the cleared/failed beat is allowed to play before the board swaps
const LEVEL_ADVANCE_DELAY = 1.8;
const LEVEL_RETRY_DELAY = 1.4;

// Clam spine tracks. The shell's state machine owns track 0 (inactive ->
// bump-inactive -> bump -> idle); the water ring loops forever beside it, the
// same split the ducks use.
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
// When the shell is ACTUALLY open: `bump` re-attaches the lid and the mouth for
// most of its run and only strips them at the very end, so the clam reads shut
// until `bump-inactive` (0.267s) + `bump` (0.30s) have both played. That total
// is what SIM.CLAM_SPILL_TICKS (34 ticks = 0.567s) encodes — the sim owns the
// timeline now, and the pearl emerges on the tick the lid is genuinely off.
// Asserted in tests/sim/clam.test.ts so the two cannot drift apart.

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
/** explode_vfx runs 0.17s — a hair more so its last frame lands before destroy */
const POP_TIME = 0.2;

// ── pop feel, lifted from the official example (decomp GameScene.onPop) ──────
/** star tint on a pop: their warm-white `Yn(..., 16773304)` burst */
const POP_STAR_TINT = 0xffe9b8;
/** additive flash: their duck-tinted `foam` image, 30 -> 70 px over 220ms QuadOut */
const FLASH_R0 = 15, FLASH_R1 = 35, FLASH_TIME = 0.22, FLASH_ALPHA = 0.75;
/** their `time2.freeze(scene, 40)` — 40ms of dead sim while the vfx play on */
const HITSTOP = 0.04;
/** their `cameras.main.shake(70, 0.003)`; Phaser scales intensity by camera size */
const SHAKE_TIME = 0.07, SHAKE_INTENSITY = 0.003;
const DESIGN_W = 720, DESIGN_H = 1280;
/** their `hit()`: 1.22x scale punch over 100ms, yoyo, Quad.easeOut */
const PUNCH_SCALE = 1.22, PUNCH_TIME = 0.1;
/** their match burst is the pop burst at 0.7 */
const MATCH_BURST = 0.7;

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
const DOT_MAX = 32;
const DOT_CRAWL = 100; // px/s
const DOT_SIZE = 11;
// deflection wedge geometry in duck-radii, traced from the reference video
// (wallBounce-HowToAim.mp4): base centre / control waist / tip along the
// deflect axis, base half-width, and how far in the concave edges pinch
const DEFLECT_BASE = 0.85;
const DEFLECT_WAIST = 1.5;
const DEFLECT_TIP = 2.3;
const DEFLECT_BASE_W = 0.6;
const DEFLECT_PINCH = 0.35;
// the red contact crescent on the aimed-at duck (reference video): the rig-pack
// aim-touch pills, white bg + red-tinted front, ~33px along the duck's rim
const CRESCENT_COLOR = 0xE8354A; // same red as the whiff X
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
/** the family name we register the woff2 under — the file's own is irrelevant */
const HUD_FONT = 'CherryBomb';
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
/** the counter number punches this big for a beat whenever it changes */
const HUD_PUNCH = 1.3, HUD_PUNCH_TIME = 0.12;

/** Decode an image URL (path or data URI) into a Pixi texture — same one code
 *  path for dev URLs and the build's inlined data URIs. */
async function loadTexture(url: string): Promise<Texture> {
  const img = new Image();
  img.src = url;
  await img.decode();
  return Texture.from(img);
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
function stageFor(b: { hp: number }): string {
  return b.hp >= 3 ? 'hp3' : b.hp === 2 ? 'hp2' : 'hp1';
}

export class GameScene {
  /** rebuilt by loadLevel() as the campaign advances */
  director: Director;
  private duckViews = new Map<number, Spine>();
  private barrelViews = new Map<number, Spine>();
  private clamViews = new Map<number, Spine>();
  private layer = new Container();
  private fx = new Container();
  /** counters, always on top and always above the tub rim */
  private hud = new Container();
  private aimLine = new Graphics();
  private hand: Spine | null = null;
  private duckyData!: SkeletonData;
  private crateData!: SkeletonData;
  private oysterData!: SkeletonData;
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
  private starTex!: Texture;
  /** soft white disc standing in for the official's blurred `foam` sprite */
  private blobTex!: Texture;
  /** motion-trail puffs live here — under the ducks, so the wake reads behind */
  private trailLayer = new Container();
  /** where each duck last dropped a trail puff */
  private trailLast = new Map<number, { x: number; y: number }>();
  /** live puffs, advanced every frame in syncViews; sprites recycle via the pool */
  private trailPuffs: Array<{ s: Sprite; t: number; id: number; dx: number; dy: number }> = [];
  private trailPool: Sprite[] = [];
  /** the pack's noisy motion-trail streak (see WAKE_ASPECT) */
  private trailTex!: Texture;
  /** sim ducks awaiting their staggered spawn view (official drainSpawnQueue) */
  private spawnQueue: Duck[] = [];
  /** seconds until the next queued spawn view may appear */
  private spawnTimer = 0;
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
  /** pointerId that owns the current grab — other pointers are ignored */
  private activePointer: number | null = null;
  /** HUD readouts, built in init and driven purely by sim events */
  private movesDigits: Text[] = [];
  private goalText!: Text;
  private pearlText!: Text;
  private clamIcon!: Sprite;
  private crateIcon!: Sprite;
  /** centre of the GOALS inset and the icon row's top, resolved in buildHud */
  private goalsCentre = BAR_X;
  private goalsIconY = BAR_TOP + 10;
  /** clam icon + count; hidden wholesale on a level with no clams */
  private pearlGroup = new Container();
  /** where a spilled pearl flies to — set once the HUD is laid out */
  private pearlTarget = { x: BAR_X, y: BAR_TOP + 60 };
  /** in-flight pearls by clam id; `pearlCollected` lands the matching one */
  private pearlFlights = new Map<number, () => void>();

  constructor(private app: Application, private seed: number, startLevel = 0) {
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
    this.starTex = await loadTexture(starUrl);
    this.blobTex = await loadTexture(blobUrl);
    this.pearlTex = await loadTexture(pearlUrl);

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
    this.aimUnder.addChild(this.aimLine, this.crescent);
    this.trailTex = await loadTexture(trailUrl);
    this.app.stage.addChild(this.aimUnder, this.trailLayer, this.layer, this.fx, this.hud);
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

    this.app.ticker.add((t) => this.tick(t.deltaMS / 1000));
  }

  private wireInput(): void {
    const stage = this.app.stage;
    stage.eventMode = 'static';
    stage.hitArea = { contains: () => true };
    stage.on('pointerdown', (e) => {
      if (this.activePointer !== null) return; // a grab is in flight — ignore extra fingers
      // the move budget is binding: with the last shot spent (or the level
      // already decided) the board is read-only — refuse before the sim ever
      // sees a grab, so no launch can slip past and drive movesLeft negative
      const d = this.director;
      if (d.movesLeft === 0 || d.won || d.failed) return;
      const p = e.getLocalPosition(stage);
      if (!d.slingshot.begin(p.x, p.y)) return;
      // a duck waiting in the spawn queue has no view yet: refuse the grab
      // rather than let the player sling an invisible duck
      const grabbed = this.director.slingshot.pull?.duck.id;
      if (grabbed === undefined || !this.duckViews.has(grabbed)) {
        this.director.slingshot.cancel();
        return;
      }
      this.activePointer = e.pointerId;
      if (this.hand) this.hand.visible = false; // tutorial done
    });
    stage.on('pointermove', (e) => {
      if (e.pointerId !== this.activePointer) return;
      const p = e.getLocalPosition(stage);
      this.director.slingshot.move(p.x, p.y);
    });
    const up = (e: { pointerId: number }): void => {
      if (e.pointerId !== this.activePointer) return;
      this.activePointer = null;
      const held = this.director.slingshot.pull?.duck.id ?? null;
      const fired = this.director.slingshot.end();
      if (fired && held !== null) {
        // the rig's own release snap-back on the launched duck
        const v = this.duckViews.get(held);
        if (v) {
          v.state.setAnimation(T_RING, 'aim_release', false);
          v.state.addEmptyAnimation(T_RING, 0.1, 0);
          this.ringMode.delete(held);
          this.aimBoneRot.delete(held);
        }
      }
      this.aimLine.clear();
    };
    stage.on('pointerup', up);
    stage.on('pointerupoutside', up);
    stage.on('pointercancel', (e) => {
      if (e.pointerId !== this.activePointer) return;
      this.activePointer = null;
      this.director.slingshot.cancel(); // cancelled: drop the grab without firing
      this.aimLine.clear();
    });
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
    this.drainSpawnQueue(dt);
    this.tickDance(dt);
    // one trajectory probe per frame — the rings and the aim UI both read it
    const pv = this.director.slingshot.preview();
    this.syncViews(dt);
    this.syncRings(pv);
    this.drawAim(pv);
    this.syncShake(dt);
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
   * end. The stage is otherwise always at the origin.
   */
  private syncShake(dt: number): void {
    if (this.shake <= 0) return;
    this.shake -= dt;
    if (this.shake <= 0) {
      this.shake = 0;
      this.app.stage.position.set(0, 0);
      return;
    }
    this.app.stage.position.set(
      (Math.random() * 2 - 1) * SHAKE_INTENSITY * DESIGN_W,
      (Math.random() * 2 - 1) * SHAKE_INTENSITY * DESIGN_H,
    );
  }

  /**
   * Reference-video ring rules. Board settled + nobody aiming: every grabbable
   * duck wears the circular green ring. While aiming: everything goes quiet
   * except the HELD duck, which swaps to the rig's `aim` teardrop, its tip
   * rotated live toward the launch direction. While anything is still sliding:
   * no rings at all (they return when the board comes to rest).
   */
  private syncRings(pv: AimPreview | null): void {
    const aiming = this.director.slingshot.aiming;
    const held = aiming ? this.director.slingshot.pull?.duck.id ?? null : null;
    const anyLive = this.director.world.ducks.some((k) => k.live);
    for (const d of this.director.world.ducks) {
      const v = this.duckViews.get(d.id);
      if (!v) continue;
      if (d.id === held) {
        this.setRingMode(d.id, v, 'aim');
      } else if (!aiming && !anyLive && !d.live && !d.popping && !d.matched) {
        // a matched duck is spoken for: no ring, it can't be grabbed any more
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
    if (held !== null) {
      const hv = this.duckViews.get(held);
      const pull = this.director.slingshot.pull;
      if (hv && pull) {
        if (pv && pv.points.length >= 2) {
          const a = pv.points[0]!, b = pv.points[1]!;
          const dx = b.x - a.x, dy = b.y - a.y;
          if (dx !== 0 || dy !== 0) {
            // rig space is y-up, stage y-down: negate the screen angle
            const rigDeg = (-Math.atan2(dy, dx) * 180) / Math.PI;
            this.aimBoneRot.set(held, rigDeg);
            // …and turn the duck itself to face the same way, so pulling back
            // toward yourself shows you its back rather than its eyes
            if (hv) this.setTurn(held, hv, rigDeg);
          }
        }
        const entry = hv.state.getCurrent(T_RING);
        if (entry && entry.animation?.name === 'aim') {
          const t = Math.min(1, pull.len / AIM_PULL_FULL);
          const stretch = pull.len < SIM.MIN_PULL
            ? t * AIM_PULL_MIN_T // under the whiff threshold the sling barely wakes
            : AIM_PULL_MIN_T + t * (AIM_PULL_MAX_T - AIM_PULL_MIN_T);
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

  private setRingMode(id: number, v: Spine, mode: 'ring' | 'aim' | null): void {
    const cur = this.ringMode.get(id) ?? null;
    if (cur === mode) return;
    if (mode === 'ring') {
      // `active` attaches the ring to its slots and scales it in; it doesn't loop,
      // so the entry holds the last frame and the ring simply stays up
      v.state.setAnimation(T_RING, 'active', false);
      this.ringMode.set(id, 'ring');
    } else if (mode === 'aim') {
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
    for (const e of this.director.drained.splice(0, this.director.drained.length)) {
      this.onEvent(e);
    }
  }

  private onEvent(e: SimEvent): void {
    switch (e.type) {
      case 'duckSpawned':
        // views appear one per 55ms via the spawn queue (official enqueueSpawn);
        // until then the sim duck exists with no view — every view lookup in
        // this file already tolerates that
        this.spawnQueue.push(e.duck);
        break;
      case 'duckStopped': {
        // the shot is over: give the body back to the idle loop. Held until now
        // so the duck keeps facing the way it was fired for the whole flight
        // rather than snapping front-on the instant it leaves the sling.
        const v = this.duckViews.get(e.id);
        if (v) this.setTurn(e.id, v, null);
        break;
      }
      case 'duckMatched': {
        const v = this.duckViews.get(e.id);
        const d = this.director.world.ducks.find((k) => k.id === e.id);
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
        this.burst(e.x, e.y, POP_STAR_TINT, 1);
        this.popFlash(e.x, e.y, e.colour);
        this.hitstop = HITSTOP;
        this.shake = SHAKE_TIME;
        break;
      }
      case 'blast':
        this.flashBlast(e.x, e.y, e.r, e.colour);
        break;
      case 'wallHit':
        if (e.source === 'bumper') this.burst(e.x, e.y, 0xffb459, 0.8);
        else this.wallFoam(e.x, e.y, e.nx, e.ny);
        break;
      case 'barrelSpawned':
        this.addBarrel(e.barrel);
        break;
      case 'barrelDamaged': {
        const v = this.barrelViews.get(e.id);
        if (v) {
          const b = this.director.world.barrels.find((k) => k.id === e.id);
          if (b) v.state.setAnimation(0, stageFor(b), false);
          v.state.setAnimation(1, 'hit', false);
          v.state.addEmptyAnimation(1, 0.1, 0);
        }
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
              v.destroy();
            }
          };
          this.app.ticker.add(fade);
        }
        this.crateBreak(e.x, e.y);
        break;
      }
      case 'clamSpawned':
        this.addClam(e.clam);
        break;
      case 'clamOpened':
        this.openClamView(e.id);
        break;
      case 'pearlReleased':
        // no view-side delay any more: the sim spills at CLAM_SPILL_TICKS, which
        // IS the rig's react + bump length, so the pearl already emerges from a
        // genuinely open shell. One timeline, owned by the sim.
        this.releasePearl(e.id, e.x, e.y);
        break;
      case 'pearlCollected':
        // the sim says it has arrived — land it NOW, whatever the tween thinks
        this.pearlFlights.get(e.id)?.();
        break;
      case 'clamClosed':
        this.closeClamView(e.id);
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
        this.setCounter(this.pearlText, String(e.left));
        break;
      case 'bumperHit':
        // fires on every glancing contact, so it stays to one cheap star
        this.burst(e.x, e.y, CLAM_TINT, 0.5);
        break;
      case 'levelStarted':
        console.log(`level ${e.index + 1}: ${e.name} — ${e.moves} moves`);
        break;
      case 'movesLeft':
        this.setMoves(e.left);
        break;
      case 'counter':
        // crates REMAINING, to read the same way as the pearl count beside it
        this.setCounter(this.goalText, String(Math.max(0, e.total - e.done)));
        break;
      case 'levelCleared': {
        console.log(`level ${e.index + 1} CLEARED with ${e.movesLeft} moves to spare`);
        this.celebrate();
        const next = e.index + 1;
        // the campaign rolls straight on; the last level just stays cleared,
        // holding the celebration until an end card exists to take over
        if (next < LEVELS.length) this.after(LEVEL_ADVANCE_DELAY, () => this.loadLevel(next));
        break;
      }
      case 'levelFailed':
        console.log(`level ${e.index + 1} FAILED — out of moves`);
        this.lament();
        // a miss costs nothing but the retry — same board, fresh budget
        this.after(LEVEL_RETRY_DELAY, () => this.loadLevel(e.index));
        break;
      default:
        break; // finaleArmed/won ride on levelCleared; end-card UI is a later change
    }
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
    for (const v of this.duckViews.values()) v.destroy();
    for (const v of this.barrelViews.values()) v.destroy();
    for (const v of this.clamViews.values()) v.destroy();
    this.duckViews.clear();
    this.barrelViews.clear();
    this.clamViews.clear();
    this.fx.removeChildren();
    if (this.hand) {
      this.fx.addChild(this.hand);
      this.hand.visible = index === 0; // the tutorial only greets level 1
    }
    this.spawnQueue.length = 0;
    this.spawnTimer = 0;
    this.spawning.clear();
    this.pearlFlights.clear();
    // the new level may not have clams, so the goal row re-centres on what it has
    this.layoutGoals();
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
    for (const d of this.dotPool) d.visible = false;
    // wipe the motion trail: ids restart from 1 next level, and a stale anchor
    // under a reused id would paint a streak from the old duck's last position
    for (const p of this.trailPuffs) {
      this.trailLayer.removeChild(p.s);
      this.trailPool.push(p.s);
    }
    this.trailPuffs.length = 0;
    this.trailLast.clear();
    this.app.stage.position.set(0, 0); // drop any shake offset mid-flight

    // a per-level seed keeps every level's respawns deterministic on their own
    this.director = new Director(this.seed + index, index);
    this.director.start();
    this.drainEvents();
  }

  /** Take one duck off the spawn queue per stagger period and build its view. */
  private drainSpawnQueue(dt: number): void {
    this.spawnTimer -= dt;
    while (this.spawnTimer <= 0 && this.spawnQueue.length > 0) {
      const d = this.spawnQueue.shift()!;
      // every dequeue costs a slot, live or not, exactly like the official's
      // unconditional 55ms delayedCall — so the cadence never bunches up
      this.spawnTimer = SPAWN_STAGGER;
      // popped while still queued (a blast can doom a viewless duck), or a view
      // somehow already exists: drop it silently
      if (!this.director.world.ducks.includes(d) || this.duckViews.has(d.id)) continue;
      this.addDuck(d);
    }
    if (this.spawnQueue.length === 0 && this.spawnTimer < 0) this.spawnTimer = 0;
  }

  private addDuck(d: Duck): void {
    const s = makeSpine(this.duckyData);
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
    const grow = (tk: { deltaMS: number }): void => {
      t += tk.deltaMS / 1000;
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
    const s = makeSpine(this.crateData);
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
   * A shut, dormant clam. `inactive` is a ZERO-length pose animation: it swaps
   * the shell to its shut attachment set (eye/eye2 off, the dormant eye3/eye4
   * on, plus the `inactive-overlay2` closed-shell plate) and, being a completed
   * non-looping entry, simply holds that set until something opens it. The
   * water ring rides its own looping track exactly like the ducks'.
   */
  private addClam(c: Clam): void {
    const s = makeSpine(this.oysterData);
    s.skeleton.setSkinByName(c.skin);
    s.skeleton.setSlotsToSetupPose();
    s.state.setAnimation(CT_SHELL, 'inactive', false);
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
   * The crack-open beat, starting on the IMPACT FRAME — the same tick the duck
   * is flung away and the pearl is released. All the rig's own animation:
   *   `bump` (0.30s) — the opening, and its own squash on the oyster/mouth/eye
   *      bones. It re-attaches the `face-up` lid at t=0, fades it to 0.34 alpha
   *      and REMOVES it (and `mouth-bottom`) at 0.30, bringing eye/eye2 back at
   *      0.27. Net: the shell jolts, the lid comes off, the eyes pop.
   *   `idle` (loop) — the awake shell breathing.
   *
   * `bump-inactive` (0.27s) used to run FIRST as a react beat — the shut
   * attachment set with the `oyster` bone squashed, authored as "it jolts but
   * stays closed". It is by definition a stall before the opening, and with the
   * pearl waiting on it too the hit read as four staggered beats rather than one
   * impact. Dropped from this path (it still serves as the closing beat, where a
   * shut-pose squash is exactly right). The movement itself is not lost: `bump`
   * carries its own squash.
   *
   * `bump` only touches those four slots, so coming straight out of the shut set
   * it would leave the closed-shell overlay and the dormant eyes stranded on top
   * of the opening. The setup pose IS the awake set (face-up and mouth-bottom
   * detached, eye/eye2 attached, no overlay), so the one-shot hands over through
   * a setSlotsToSetupPose() on its `start` — before the animation is applied,
   * since AnimationState drains its event queue inside update() and the skeleton
   * is only posed afterwards, in apply(). The same call on `complete` is the
   * belt-and-braces guarantee that the lid is gone even if the final attachment
   * frame never lands.
   */
  private openClamView(id: number): void {
    const v = this.clamViews.get(id);
    if (!v) return;
    const wake = (): void => v.skeleton.setSlotsToSetupPose();
    v.state.setAnimation(CT_SHELL, 'bump', false).listener = { start: wake, complete: wake };
    v.state.addAnimation(CT_SHELL, 'idle', true, 0);
  }

  /**
   * The shell shutting again, so the clam can be triggered a second time.
   *
   * The rig has no authored "close" — the pack ships only the opening. But
   * `bump-inactive` (0.27s) is the shut attachment set plus an `oyster` bone
   * squash, authored as "it was hit but stayed closed", and played out of the
   * awake `idle` it re-attaches the lid and the dormant eyes with a jolt: the
   * opening in reverse, using the rig's own animation rather than a hand-rolled
   * tween. It then rests on `inactive`, the 0-length dormant pose, which is
   * exactly where addClam starts every clam — so an armed clam and a re-armed
   * clam are in provably the same state.
   */
  private closeClamView(id: number): void {
    const v = this.clamViews.get(id);
    if (!v) return;
    v.state.setAnimation(CT_SHELL, 'bump-inactive', false);
    v.state.addAnimation(CT_SHELL, 'inactive', false, 0);
  }

  /**
   * The pearl the shell spills: the pack's 52x52 glossy bead, popped in with the
   * official's Back overshoot, lifted clear of the shell, then flown up to the
   * HUD's pearl counter — where its arrival is what the player reads as the
   * count dropping.
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
        v.destroy();
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

  /** Additive duck-tinted bloom at the pop — the official's `foam` flash. */
  private popFlash(x: number, y: number, colour: Colour): void {
    this.foamFlash(x, y, TINTS[colour]);
  }

  /** The bloom itself, at any tint — the clam's pearl uses the bumper pink. */
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
    const anim = (tk: { deltaMS: number }): void => {
      t += tk.deltaMS / 1000;
      if (v.destroyed) {
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
   * in the attachment colours over neutral art, so the same trick lands the same
   * flat-white silhouette. Attachments are shared across every duck of a colour,
   * hence the per-instance copy. Re-isolated at each white band so an animation
   * that swapped an attachment mid-fuse can't strand a slot.
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
      for (const s of slots) s.color.set(1, 1, 1, 1);
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

  private flashBlast(x: number, y: number, r: number, colour: Colour): void {
    // secondary now: barrel-damage feedback behind the rig's explode vfx
    const g = new Graphics().circle(x, y, r).stroke({ width: 10, color: TINTS[colour], alpha: 0.5 });
    this.fx.addChild(g);
    let t = 0;
    const anim = (tk: { deltaMS: number }): void => {
      t += tk.deltaMS / 1000;
      g.alpha = Math.max(0, 1 - t / 0.25);
      g.scale.set(1 + t * 1.2);
      g.pivot.set(x * (g.scale.x - 1) / g.scale.x, y * (g.scale.y - 1) / g.scale.y);
      if (t >= 0.25) {
        this.app.ticker.remove(anim);
        g.destroy();
      }
    };
    this.app.ticker.add(anim);
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
    document.fonts.add(await new FontFace(HUD_FONT, `url("${cherryBombUrl}")`).load());

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

    // content box, per the reference's 3px border + 20px side padding
    const inRight = left + BAR_W - 23 * REF_K;

    const label = (text: string, cx: number): Text => {
      const t = new Text({
        text,
        style: {
          fontFamily: HUD_FONT, fontSize: HUD_LABEL_SIZE, fill: 0xffffff, align: 'center',
          letterSpacing: 1.5,
          dropShadow: { color: 0x000000, alpha: 0.25, blur: 0, angle: Math.PI / 2, distance: 2 },
        },
      });
      t.anchor.set(0.5);
      // Both labels straddle the bar's top edge, sitting mostly above it. The
      // reference puts their centre 2px above; Cherry Bomb carries more space
      // under its baseline than the reference's face, so this leans a little
      // further up to land the same way against the edge.
      t.position.set(cx, BAR_TOP - 7);
      return t;
    };

    // ── MOVES: two digit tiles, zero-padded, exactly as the reference pads ──
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
    this.movesDigits = [];
    for (let i = 0; i < 2; i++) {
      const x = tilesX + i * (TILE_W + TILE_GAP);
      const tile = new Sprite(tileTex);
      tile.width = TILE_W;
      tile.height = TILE_H + 2;
      tile.position.set(x, tileY);
      const d = new Text({
        text: '0',
        style: { fontFamily: HUD_FONT, fontSize: 52 * REF_K, fill: TILE_INK, align: 'center' },
      });
      d.anchor.set(0.5);
      d.position.set(x + TILE_W / 2, tileY + TILE_H / 2);
      this.movesDigits.push(d);
      this.hud.addChild(tile, d);
    }

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
          fontFamily: HUD_FONT, fontSize: GOAL_ICON * (20 / 52), fill: 0xffffff, align: 'left',
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

    const clamIcon = await goalIcon(clamIconUrl);
    this.pearlText = count();
    this.pearlGroup.addChild(clamIcon, this.pearlText);
    this.clamIcon = clamIcon;

    const crateIcon = await goalIcon(goalIconUrl);
    this.crateIcon = crateIcon;
    this.goalText = count();

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
      crateIcon, this.goalText,
      this.pearlGroup,
      frame, avatar, lip,
      label('MOVES', tilesX + tilesW / 2),
      label('GOALS', insetX + insetW / 2),
    );
    this.layoutGoals();
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
    if (showClam) {
      this.clamIcon.position.set(x, y);
      this.pearlText.position.set(x + cw * (32 / 52), y + GOAL_ICON + GOAL_COUNT_DY);
      // where a spilled pearl flies to — its own icon, so it lands on the count
      this.pearlTarget = { x: x + cw / 2, y: y + GOAL_ICON / 2 };
      x += cw + GOAL_GAP;
    }
    this.crateIcon.position.set(x, y);
    this.goalText.position.set(x + bw * (32 / 52), y + GOAL_ICON + GOAL_COUNT_DY);
  }

  /** MOVES is two tiles, so the number is set a digit at a time. */
  private setMoves(left: number): void {
    const s = String(Math.max(0, left)).padStart(2, '0').slice(-2);
    for (const [i, d] of this.movesDigits.entries()) this.setCounter(d, s[i]!);
  }

  /** Set a counter and punch it, so a spent move or a cleared goal is felt. */
  private setCounter(t: Text, value: string): void {
    if (t.text === value) return;
    t.text = value;
    let e = 0;
    const anim = (tk: { deltaMS: number }): void => {
      e += tk.deltaMS / 1000;
      // out then back, Quad.easeOut each leg — the duck punch's shape
      const leg = e < HUD_PUNCH_TIME ? e / HUD_PUNCH_TIME : 1 - (e - HUD_PUNCH_TIME) / HUD_PUNCH_TIME;
      t.scale.set(1 + (HUD_PUNCH - 1) * quadOut(Math.max(0, leg)));
      if (e >= HUD_PUNCH_TIME * 2) {
        this.app.ticker.remove(anim);
        t.scale.set(1);
      }
    };
    this.app.ticker.add(anim);
  }

  /**
   * Level cleared. No end-card and no transition — a later change owns those;
   * this only has to make the state unmistakable: a staggered wash of stars
   * over the tub and a longer version of the pop's own camera shake.
   */
  private celebrate(): void {
    this.shake = SHAKE_TIME * 4;
    // a ring of stars blooming outward from the middle of the tub, alternating
    // the pop's warm white with the clam's pink
    for (let i = 0; i < 8; i++) {
      this.after(i * 0.07, () => {
        const a = (i / 8) * Math.PI * 2 + 0.4;
        this.burst(
          DESIGN_W / 2 + Math.cos(a) * 210, 740 + Math.sin(a) * 250,
          i % 2 === 0 ? POP_STAR_TINT : CLAM_TINT, 1.3,
        );
      });
    }
  }

  /**
   * Level failed: deliberately the opposite shape — no stars, no shake, one
   * slow cold ring sinking over the board that nobody could mistake for a win.
   */
  private lament(): void {
    const x = DESIGN_W / 2, y = 740;
    const g = new Graphics().circle(x, y, 90).stroke({ width: 14, color: 0x2f5f80, alpha: 0.55 });
    this.fx.addChild(g);
    let t = 0;
    const anim = (tk: { deltaMS: number }): void => {
      t += tk.deltaMS / 1000;
      const p = Math.min(1, t / 0.6);
      g.alpha = 1 - p;
      g.scale.set(1 + quadOut(p) * 1.6);
      g.pivot.set((x * (g.scale.x - 1)) / g.scale.x, (y * (g.scale.y - 1)) / g.scale.y);
      if (p >= 1) {
        this.app.ticker.remove(anim);
        g.destroy();
      }
    };
    this.app.ticker.add(anim);
    this.foamFlash(x, y, 0x3d6f8f);
  }

  /** Run `fn` once, `delay` seconds out, on the app ticker — the file's only
   *  scheduler, so anything queued pauses with the tab like the rest of the fx. */
  private after(delay: number, fn: () => void): void {
    let t = 0;
    const wait = (tk: { deltaMS: number }): void => {
      t += tk.deltaMS / 1000;
      if (t < delay) return;
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
    for (const [, v] of this.barrelViews) v.update(dt);
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
  private drawAim(pv: AimPreview | null): void {
    this.aimLine.clear();
    let dotsUsed = 0;
    if (!pv) {
      for (const d of this.dotPool) d.visible = false;
      this.crescent.visible = false;
      return;
    }

    // --- dots along the polyline ---
    const segs: Array<{ x0: number; y0: number; ux: number; uy: number; len: number }> = [];
    let total = 0;
    for (let i = 0; i + 1 < pv.points.length; i++) {
      const a = pv.points[i]!, b = pv.points[i + 1]!;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len <= 0) continue;
      segs.push({ x0: a.x, y0: a.y, ux: (b.x - a.x) / len, uy: (b.y - a.y) / len, len });
      total += len;
    }
    const offset = (this.aimClock * DOT_CRAWL) % DOT_SPACING;
    for (let n = 0; n < DOT_MAX; n++) {
      const arc = DOT_START + offset + n * DOT_SPACING;
      if (arc > total) break;
      // locate arc along the polyline
      let rem = arc;
      let s = 0;
      while (s < segs.length - 1 && rem > segs[s]!.len) {
        rem -= segs[s]!.len;
        s++;
      }
      const seg = segs[s]!;
      const g = total > 0 ? arc / total : 0;
      const dot = this.dotPool[dotsUsed++]!;
      dot.visible = true;
      dot.position.set(seg.x0 + seg.ux * rem, seg.y0 + seg.uy * rem);
      dot.alpha = 1 - 0.3 * g;
    }
    for (let n = dotsUsed; n < DOT_MAX; n++) this.dotPool[n]!.visible = false;

    const endPt = pv.points[pv.points.length - 1]!;

    // --- red contact crescent on the aimed-at duck's rim ---
    if (pv.hitKind === 'duck') {
      const struck = this.director.world.ducks.find((d) => d.id === pv.hitId);
      if (struck) {
        const vx = endPt.x - struck.x, vy = endPt.y - struck.y;
        const len = Math.hypot(vx, vy) || 1;
        const ux = vx / len, uy = vy / len;
        this.crescent.visible = true;
        // past the physics radius so it clears the duck ART (~57px at this scale)
        // and sits on the ripple, like the reference frames
        this.crescent.position.set(
          struck.x + ux * (SIM.DUCK_R + 22), struck.y + uy * (SIM.DUCK_R + 22),
        );
        // pill art is vertical, convex side +x: point the bulge away from the duck
        this.crescent.rotation = Math.atan2(uy, ux);
      } else {
        this.crescent.visible = false;
      }
    } else {
      this.crescent.visible = false;
    }

    // --- red X wherever the shot fails to reach a duck ---
    if (pv.hitKind !== 'duck') {
      const a = 20 / Math.SQRT2; // arm extent 20 along each diagonal
      const stroke = { width: 12, color: 0xE8354A, alpha: 0.95, cap: 'round' as const };
      this.aimLine
        .moveTo(endPt.x - a, endPt.y - a).lineTo(endPt.x + a, endPt.y + a).stroke(stroke)
        .moveTo(endPt.x + a, endPt.y - a).lineTo(endPt.x - a, endPt.y + a).stroke(stroke);
    }

    // --- white deflection wedge on a struck duck (equal-mass billiards) ---
    // The real game's arrow (wallBounce-HowToAim.mp4 ~4.7-5.1s): a solid-white
    // speech-bubble-tail — wide rounded base tucked UNDER the duck art (this
    // layer sits below the ducks, so the base fuses with the duck's white base
    // ring), both edges gently concave, sharp tip ~2.3 duck-radii from the
    // centre. Static: no pulse, it only rotates with the predicted direction.
    if (pv.hitKind === 'duck' && pv.deflect) {
      const struck = this.director.world.ducks.find((d) => d.id === pv.hitId);
      if (struck) {
        const dx = pv.deflect.x, dy = pv.deflect.y;
        const px = -dy, py = dx; // unit perpendicular
        const R = SIM.DUCK_R;
        const w = R * DEFLECT_BASE_W;
        const at = (along: number, side: number): { x: number; y: number } => ({
          x: struck.x + dx * R * along + px * w * side,
          y: struck.y + dy * R * along + py * w * side,
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
          .fill({ color: 0xffffff, alpha: 0.95 });
      }
    }
  }
}
