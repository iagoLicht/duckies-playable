import {
  Application, Container, Graphics, NineSliceSprite, Sprite, Text, Texture,
  type TextStyleOptions,
} from 'pixi.js';

import panelUrl from '../assets/ui/popup-body-tall.webp';
import ribbonUrl from '../assets/icons/ribbon-pink.webp';
import buttonUrl from '../assets/ui/btn-green-large.webp';

const DESIGN_W = 720;
const DESIGN_H = 1280;
/** the pack's display face, already registered by the scene's font loader */
const HUD_FONT = 'CherryBomb';

/** pack source dimensions — the staging step never resizes, so these are exact */
const PANEL_SRC_W = 928;
const PANEL_SRC_H = 496;
const RIBBON_SRC_W = 1004;
const BUTTON_SRC_W = 578;

/**
 * MEASURED, not read off the manifest.
 *
 * ui-manifest.json calls popup-body-tall a 9-slice at L471/R457/T283/B209,
 * which sums to the entire 928x496 texture — a stretch band 0px wide and 4px
 * tall. Pixi cannot take a NineSliceSprite below its source width, and this
 * card needs a ~620px panel inside a 720px space, so those numbers are
 * unusable here.
 *
 * Instead: 3-slice VERTICALLY (side insets 0), cutting a band out of the
 * panel's straight-sided middle. A probe over the source found the silhouette
 * uniform across rows 62..400, so a band at 240..256 sits deep inside that
 * plateau with ~180px of margin either way. Replicating those rows grows the
 * well with straight sides, which is how a stadium shape should stretch.
 *
 * Width never comes from the slice: the sprite is built at full source width
 * and the whole thing is scaled uniformly, so nothing is ever squashed on one
 * axis only.
 */
const PANEL_SLICE_TOP = 240;
const PANEL_SLICE_BOTTOM = 240;

/**
 * Panel geometry in design space. Sized to its CONTENTS, not to the screen:
 * a first pass at 760 tall left the well mostly empty, the ribbon stranded at
 * the top and the button marooned at the bottom, and it buried the whole board.
 * The board is the trophy — the card sits over the middle of it and lets the
 * tub read above and below.
 */
const PANEL_W = 620;
const PANEL_H = 470;
const PANEL_CX = DESIGN_W / 2;
const PANEL_TOP = 400;

/** wider than the panel on purpose — the banner is meant to overhang it */
const RIBBON_W = 640;
const RIBBON_CY = PANEL_TOP + 24;
/** the ribbon's banner band sits a touch above the art's centre */
const TITLE_DY = -16;

/**
 * How far the title's outer letters drop below its middle, in design px.
 *
 * The arc is specified by RISE, not by the banner's radius, and that is a
 * deliberate correction. A probe measured the banner's own curve — 41.5px of
 * sagitta over an 824px span on the 1004px source, i.e. a circular arc of
 * radius 2066px — and matching that radius exactly was the first attempt. It
 * was geometrically faithful and looked FLAT, because a circle's rise grows
 * with the SQUARE of the span: the title is barely half the banner's width, so
 * it inherited under a third of the banner's visible curve (~11px, which reads
 * as a straight line with slightly tilted end letters).
 *
 * Setting the rise directly makes the title curve the way the banner LOOKS
 * rather than the way it measures, and it holds that look at any title length,
 * since the radius is re-solved per string from its own measured width.
 */
const TITLE_ARC_RISE = 44;
/** extra tracking between letters — arc text loses the font's own kerning */
const TITLE_TRACKING = 2;
/**
 * The banner's flat band, inside the curled end tails. A title wider than this
 * runs out over the curls and reads as overflowing the ribbon, so it is scaled
 * down to fit rather than clipped — which also means a longer word later
 * ("LEVEL COMPLETE!") degrades gracefully instead of breaking the card.
 */
const TITLE_MAX_W = 468;

const BUTTON_W = 430;
const BUTTON_CY = PANEL_TOP + 275;
/** the button art carries a bottom bevel, so the label rides above centre */
const LABEL_DY = -12;
/** clear of the button's own drop shadow above, and of the panel rim below —
 *  the button spans PANEL_TOP+191..+359 at this width */
const STORE_CY = PANEL_TOP + 392;

const SCRIM_FADE = 0.25;
const PANEL_RISE = 0.45;
const BUTTON_FADE = 0.3;

export interface EndCardTextures {
  panel: Texture;
  ribbon: Texture;
  button: Texture;
}

export interface EndCardOpts {
  title: string;
  buttonLabel: string;
  /** a separate store link under the button — the win card only. On the lose
   *  card the button already IS the store, and a second path is noise. */
  storeLink: boolean;
  onButton: () => void;
  onStore: () => void;
}

const loadTexture = async (url: string): Promise<Texture> => {
  const img = new Image();
  img.src = url;
  await img.decode();
  return Texture.from(img);
};

export async function loadEndCardTextures(): Promise<EndCardTextures> {
  const [panel, ribbon, button] = await Promise.all([
    loadTexture(panelUrl), loadTexture(ribbonUrl), loadTexture(buttonUrl),
  ]);
  return { panel, ribbon, button };
}

/** the view's own ease, matching scene.ts */
const quadOut = (t: number): number => 1 - (1 - t) * (1 - t);
/** Back.easeOut — the overshoot settle the duck spawn already uses */
const backOut = (t: number): number => {
  const s = 1.70158;
  const u = t - 1;
  return u * u * ((s + 1) * u + s) + 1;
};
const clamp01 = (t: number): number => Math.max(0, Math.min(1, t));

/**
 * Lay a string along a circular arc, apex-up, so the middle letters ride
 * highest and the outer ones drop away and tilt.
 *
 * The arc is defined by `riseTarget` — how far the ends fall below the middle,
 * in final rendered px — and the radius is solved from the string's own
 * measured width. Specifying the rise rather than the radius is what keeps the
 * curve looking the same whether the word is "YOU WIN!" or something longer;
 * a fixed radius flattens out as the text gets shorter.
 *
 * One `Text` per glyph, each rotated to the arc's tangent. Pixi has no
 * text-on-a-path, and warping a bitmap would soften the face's outline, which
 * is the one thing a title at this size cannot afford.
 *
 * The apex is raised by half the rise so the block's visual centre lands on
 * `cy`; without it, curving a previously flat title visibly drops it down the
 * banner.
 */
function arcText(
  text: string, style: TextStyleOptions,
  cx: number, cy: number, riseTarget: number, tracking: number, maxWidth: number,
): Container {
  const glyphs = [...text].map((ch) => new Text({ text: ch, style }));
  for (const g of glyphs) g.anchor.set(0.5);

  const advances = glyphs.map((g) => g.width + tracking);
  const total = advances.reduce((a, b) => a + b, 0) - tracking;
  // shrink-to-fit rather than clip. Applied to the finished container, so the
  // arc is computed once at full size and simply scaled — the letters stay on
  // the same curve instead of re-solving to a flatter one.
  const fit = Math.min(1, maxWidth / total);

  // solve the radius from the geometry we actually want. `rise` is pre-divided
  // by `fit` so that after the shrink-to-fit scale the RENDERED rise is
  // riseTarget, not something smaller.
  const half = total / 2;
  const rise = Math.max(1, riseTarget / fit);
  const radius = (half * half + rise * rise) / (2 * rise);

  const box = new Container();
  // arc centre sits directly below the apex
  const acx = cx;
  const acy = cy + rise / 2 + radius;

  let d = -total / 2;
  for (const [i, g] of glyphs.entries()) {
    const mid = d + (advances[i]! - tracking) / 2;
    const a = mid / radius; // arc length over radius — the tangent angle too
    g.position.set(acx + radius * Math.sin(a), acy - radius * Math.cos(a));
    g.rotation = a;
    box.addChild(g);
    d += advances[i]!;
  }
  // scale about the apex, so shrinking does not slide the title off the band
  box.pivot.set(acx, cy);
  box.position.set(acx, cy);
  box.scale.set(fit);
  return box;
}

/**
 * The end card. Whether it is terminal is the caller's business (see flow.ts):
 * this only knows what to say and what to call when tapped.
 *
 * The board stays visible through the scrim on purpose — the state you won or
 * lost IS the backdrop, and covering it would throw away the only thing on
 * screen that proves what just happened.
 */
export function showEndCard(app: Application, tex: EndCardTextures, o: EndCardOpts): Container {
  const root = new Container();
  app.stage.addChild(root);

  // ── scrim ────────────────────────────────────────────────────────────────
  const scrim = new Graphics().rect(0, 0, DESIGN_W, DESIGN_H).fill({ color: 0x0a1b28, alpha: 0.66 });
  scrim.alpha = 0;
  // swallows taps meant for the board underneath: the card is modal
  scrim.eventMode = 'static';
  root.addChild(scrim);

  // ── panel ────────────────────────────────────────────────────────────────
  // built at SOURCE width and scaled uniformly, so only the middle band
  // stretches and the rim keeps its aspect on both axes
  const panelScale = PANEL_W / PANEL_SRC_W;
  const panel = new NineSliceSprite({
    texture: tex.panel,
    leftWidth: 0,
    rightWidth: 0,
    topHeight: PANEL_SLICE_TOP,
    bottomHeight: PANEL_SLICE_BOTTOM,
  });
  panel.width = PANEL_SRC_W;
  panel.height = PANEL_H / panelScale;
  panel.scale.set(panelScale);
  panel.position.set(-PANEL_W / 2, -PANEL_H / 2);

  const panelBox = new Container();
  panelBox.addChild(panel);
  panelBox.position.set(PANEL_CX, PANEL_TOP + PANEL_H / 2);
  panelBox.scale.set(0);
  root.addChild(panelBox);

  // ── ribbon + title ───────────────────────────────────────────────────────
  const ribbon = new Sprite(tex.ribbon);
  ribbon.anchor.set(0.5);
  ribbon.scale.set(RIBBON_W / RIBBON_SRC_W);
  ribbon.position.set(PANEL_CX, RIBBON_CY);

  const title = arcText(
    o.title,
    {
      fontFamily: HUD_FONT, fontSize: 82, fill: 0xffffff, align: 'center',
      stroke: { color: 0x9c3a5e, width: 12, join: 'round' },
    },
    PANEL_CX, RIBBON_CY + TITLE_DY, TITLE_ARC_RISE, TITLE_TRACKING, TITLE_MAX_W,
  );

  const ribbonBox = new Container();
  ribbonBox.addChild(ribbon, title);
  ribbonBox.alpha = 0;
  root.addChild(ribbonBox);

  // ── button ───────────────────────────────────────────────────────────────
  const button = new Sprite(tex.button);
  button.anchor.set(0.5);
  button.scale.set(BUTTON_W / BUTTON_SRC_W);
  button.position.set(PANEL_CX, BUTTON_CY);

  const label = new Text({
    text: o.buttonLabel,
    style: {
      fontFamily: HUD_FONT, fontSize: 54, fill: 0xffffff, align: 'center',
      stroke: { color: 0x14532b, width: 8, join: 'round' },
    },
  });
  label.anchor.set(0.5);
  label.position.set(PANEL_CX, BUTTON_CY + LABEL_DY);

  const buttonBox = new Container();
  buttonBox.addChild(button, label);
  buttonBox.alpha = 0;
  buttonBox.cursor = 'pointer';
  root.addChild(buttonBox);

  // ── store link (win card only) ───────────────────────────────────────────
  let storeBox: Container | null = null;
  if (o.storeLink) {
    const link = new Text({
      text: 'Get Duckies Pop — free',
      style: { fontFamily: HUD_FONT, fontSize: 32, fill: 0xffffff, align: 'center' },
    });
    link.anchor.set(0.5);
    link.position.set(PANEL_CX, STORE_CY);
    const underline = new Graphics()
      .rect(PANEL_CX - link.width / 2, STORE_CY + link.height / 2 - 2, link.width, 3)
      .fill({ color: 0xffffff, alpha: 0.8 });
    storeBox = new Container();
    storeBox.addChild(link, underline);
    storeBox.alpha = 0;
    storeBox.cursor = 'pointer';
    root.addChild(storeBox);
  }

  // ── entrance ─────────────────────────────────────────────────────────────
  // Nothing is tappable until it lands: a card tapped through mid-flight eats
  // the viewer's first and most deliberate tap.
  buttonBox.eventMode = 'none';
  if (storeBox) storeBox.eventMode = 'none';

  const DONE_AT = SCRIM_FADE + PANEL_RISE + BUTTON_FADE;
  let t = 0;
  const anim = (tk: { deltaMS: number }): void => {
    t += tk.deltaMS / 1000;
    scrim.alpha = 0.66 * clamp01(t / SCRIM_FADE);

    const p = clamp01((t - SCRIM_FADE) / PANEL_RISE);
    panelBox.scale.set(p <= 0 ? 0 : backOut(p));
    ribbonBox.alpha = quadOut(clamp01((t - SCRIM_FADE - 0.1) / 0.3));

    const b = clamp01((t - SCRIM_FADE - PANEL_RISE) / BUTTON_FADE);
    buttonBox.alpha = b;
    if (storeBox) storeBox.alpha = b;

    if (t >= DONE_AT) {
      app.ticker.remove(anim);
      panelBox.scale.set(1);
      buttonBox.eventMode = 'static';
      if (storeBox) storeBox.eventMode = 'static';
    }
  };
  app.ticker.add(anim);

  buttonBox.on('pointertap', o.onButton);
  storeBox?.on('pointertap', o.onStore);

  return root;
}
