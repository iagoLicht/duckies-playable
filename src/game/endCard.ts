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
const RIBBON_SCALE = RIBBON_W / RIBBON_SRC_W;
/**
 * The pink band is NOT centred in its own texture — the curled tails hang
 * below it and drag the image's centre down with them. A probe at the middle
 * column found pink spanning y 4..211 of the 338-tall source, putting the
 * band's centre 61.5px ABOVE the texture's.
 *
 * So a title centred on the sprite sits visibly low on the ribbon. This lifts
 * it onto the band's real centre line, and it is expressed in source px times
 * the scale so it tracks any change to RIBBON_W.
 */
const TITLE_BAND_DY = -61.5 * RIBBON_SCALE;
/**
 * ...and then back down a little, because Pixi centres a Text on its LAYOUT
 * box, which reserves descender and line-height room that an all-caps title
 * never uses. The visible letters therefore ride above the box's centre.
 *
 * Measured off the render, not reasoned about: at this size and face the flat
 * title lands 6.5px (win) / 6.3px (lose) low with this set to 11, so 5 is the
 * value that centres it. The number is specific to a single-line Text — an
 * earlier arced version, which anchored every glyph separately, needed 11.
 */
const TITLE_INK_DY = 5;
const TITLE_DY = TITLE_BAND_DY + TITLE_INK_DY;

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
 * The banner title: one flat line, centred on (cx, cy), shrunk if it would run
 * out over the ribbon's curled tails.
 *
 * Straight on purpose. An earlier pass laid the letters along the banner's own
 * arc; it was rejected. Keeping it flat means the block's vertical placement is
 * decided entirely by `cy`, which is what makes the two offsets that put it on
 * the band's centre line (TITLE_BAND_DY, TITLE_INK_DY) predictable.
 */
function bannerTitle(
  text: string, style: TextStyleOptions, cx: number, cy: number, maxWidth: number,
): Text {
  const t = new Text({ text, style });
  t.anchor.set(0.5);
  t.position.set(cx, cy);
  // shrink to fit rather than clip, so a longer title later degrades instead of
  // spilling over the tails
  if (t.width > maxWidth) t.scale.set(maxWidth / t.width);
  return t;
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
  ribbon.scale.set(RIBBON_SCALE);
  ribbon.position.set(PANEL_CX, RIBBON_CY);

  const title = bannerTitle(
    o.title,
    {
      fontFamily: HUD_FONT, fontSize: 82, fill: 0xffffff, align: 'center',
      stroke: { color: 0x9c3a5e, width: 12, join: 'round' },
    },
    PANEL_CX, RIBBON_CY + TITLE_DY, TITLE_MAX_W,
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
