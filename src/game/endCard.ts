import {
  Application, Container, Graphics, NineSliceSprite, RenderTexture, Sprite, Text, Texture,
  type TextStyleOptions,
} from 'pixi.js';

import { DESIGN_W } from './layout';
import { coverScreen } from './stage';

import panelUrl from '../assets/ui/popup-body-tall.webp';
import ribbonUrl from '../assets/icons/ribbon-pink.webp';
import buttonUrl from '../assets/ui/btn-green-large.webp';

/**
 * The pack's heavy condensed face (asap-semicondensed-black), registered by the
 * scene's font loader. The card uses it throughout so the two screens read as
 * the same UI as the HUD bar above them.
 *
 * Note this is NOT the role the pack's manifest assigns it — it calls this the
 * "number/counter font" and gives "Headers/CTA/score" to CherryBombOne.
 * Overridden deliberately, and that choice is now the whole story: this being
 * the only face the ad renders is why CherryBombOne was dropped rather than
 * shipped unused. Same constant, one place: HUD_NUM_FONT in scene.ts.
 */
const CARD_FONT = 'AsapBlack';

/** pack source WIDTHS — the staging step never resizes, so these are exact.
 *  Heights are not here: every sprite is scaled uniformly off its width, so a
 *  height constant would only ever be read by a comment. popup-body-tall's 496
 *  is quoted where it matters, in the slice note below. */
const PANEL_SRC_W = 928;
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
const RIBBON_SCALE = RIBBON_W / RIBBON_SRC_W;
/**
 * Low enough to bury the panel's own top border, and that depth is a property
 * of the texture rather than a taste call.
 *
 * A probe down popup-body-tall's centre column: rows 0..3 are the outer stroke,
 * 4..113 the orange rim, 114..117 the inner stroke, and the wood fill starts at
 * 118. Times panelScale (620/928) that is 78.8px of border below PANEL_TOP.
 *
 * The band's underside sits (211-169) * RIBBON_SCALE = 26.8px below RIBBON_CY
 * (same source probe as TITLE_BAND_DY), so PANEL_TOP + 55 lands it at +81.8 —
 * a few px into the wood, which leaves no hairline of rim to read as a second
 * band under the pink. It used to be PANEL_TOP + 24, which left 28px showing.
 */
const RIBBON_CY = PANEL_TOP + 55;
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

/**
 * The line under the banner, centred in the empty band between the two things
 * that were already there.
 *
 * Both edges are derived, not eyeballed. The ribbon's pink band ends at source
 * row 211 of 338 (the probe behind TITLE_BAND_DY), i.e. (211-169) * RIBBON_SCALE
 * = 27px below RIBBON_CY, so its underside sits at PANEL_TOP + 82. The button
 * art spans PANEL_TOP+191..+359. Halfway between 82 and 191 is 136, which is
 * where this sits — the curled tails hang lower than the band but only at the
 * far ends, so the centre column is clear the whole way down.
 *
 * This tracks RIBBON_CY: when the banner dropped to bury the panel's rim it ate
 * 31px of the gap above, and leaving the line at its old 121 would have parked
 * it hard against the ribbon with all the slack below.
 */
const SUBTITLE_CY = PANEL_TOP + 136;
/**
 * Secondary to the banner by every lever at once — half its size, a thinner
 * outline, and sentence case — so it reads as the voice under the verdict
 * rather than a second headline competing with it.
 */
const SUBTITLE_SIZE = 42;
/** inside the panel's straight-sided well, with room to spare at 620 wide */
const SUBTITLE_MAX_W = 520;

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
  /** the quieter line between the banner and the button */
  subtitle: string;
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

/** A card built ahead of time: attached (hidden) and fully rasterized, so
 *  show() costs nothing on the frame the verdict lands. */
export interface PreparedEndCard {
  root: Container;
  show: () => void;
}

/**
 * The end card. Whether it is terminal is the caller's business (see flow.ts):
 * this only knows what to say and what to call when tapped.
 *
 * The board stays visible through the scrim on purpose — the state you won or
 * lost IS the backdrop, and covering it would throw away the only thing on
 * screen that proves what just happened.
 *
 * Built HIDDEN and armed by show(). Rasterizing the card's Text objects was a
 * measured one-frame spike (~370ms on a weak phone, on the exact frame the
 * player's win or loss lands), so the scene prepares its cards during quiet
 * moments and show() only flips visibility and starts the entrance.
 */
export function buildEndCard(
  app: Application, parent: Container, tex: EndCardTextures, o: EndCardOpts,
): PreparedEndCard {
  const root = new Container();
  root.visible = false; // armed by show(); invisible also disables the scrim's tap-eating
  parent.addChild(root);

  // ── scrim ────────────────────────────────────────────────────────────────
  // Drawn to the whole CANVAS, not to the 720x1280 board (coverScreen, and it
  // redraws itself if the phone is rotated while the card is up). A scrim the
  // size of the board dims the board and leaves the wall around it bright,
  // which on any screen that is not 9:16 reads as a lit frame round a dark
  // picture — and it is the letterbox margins, so it grows with the aspect.
  const scrim = new Graphics();
  const unbindScrim = coverScreen(scrim, 0x0a1b28, 0.66);
  scrim.alpha = 0;
  // swallows taps meant for the board underneath: the card is modal — and
  // because the fill now reaches the corners of the glass, so does that
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
      fontFamily: CARD_FONT, fontSize: 82, fill: 0xffffff, align: 'center',
      stroke: { color: 0x9c3a5e, width: 12, join: 'round' },
    },
    PANEL_CX, RIBBON_CY + TITLE_DY, TITLE_MAX_W,
  );

  const ribbonBox = new Container();
  ribbonBox.addChild(ribbon, title);
  ribbonBox.alpha = 0;
  root.addChild(ribbonBox);

  // ── subtitle ─────────────────────────────────────────────────────────────
  // Reuses bannerTitle only for its shrink-to-fit; the ribbon offsets are not
  // involved, since this is centred on flat panel rather than on a curved band.
  const subtitle = bannerTitle(
    o.subtitle,
    {
      fontFamily: CARD_FONT, fontSize: SUBTITLE_SIZE, fill: 0xffffff, align: 'center',
      stroke: { color: 0x9c3a5e, width: 6, join: 'round' },
    },
    PANEL_CX, SUBTITLE_CY, SUBTITLE_MAX_W,
  );
  const subtitleBox = new Container();
  subtitleBox.addChild(subtitle);
  subtitleBox.alpha = 0;
  root.addChild(subtitleBox);

  // ── button ───────────────────────────────────────────────────────────────
  const button = new Sprite(tex.button);
  button.anchor.set(0.5);
  button.scale.set(BUTTON_W / BUTTON_SRC_W);
  button.position.set(PANEL_CX, BUTTON_CY);

  const label = new Text({
    text: o.buttonLabel,
    style: {
      fontFamily: CARD_FONT, fontSize: 54, fill: 0xffffff, align: 'center',
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
      text: 'Get Duckies Pop free',
      style: { fontFamily: CARD_FONT, fontSize: 32, fill: 0xffffff, align: 'center' },
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
    // on the button's curve, not the ribbon's: the ribbon fades in while the
    // panel is still scaling up, and a line that belongs ON the panel must not
    // appear over a panel that has not finished arriving
    subtitleBox.alpha = b;
    buttonBox.alpha = b;
    if (storeBox) storeBox.alpha = b;

    if (t >= DONE_AT) {
      app.ticker.remove(anim);
      panelBox.scale.set(1);
      buttonBox.eventMode = 'static';
      if (storeBox) storeBox.eventMode = 'static';
    }
  };

  // Rasterize NOW, not on the show frame. Pixi paints a Text's canvas on its
  // first RENDER, so a hidden card carries the whole spike to the verdict frame
  // regardless of when it was built — one throwaway render forces every canvas
  // paint and GPU upload here instead (measured: the card's Texts were a ~300ms
  // frame on a weak phone; textures persist, so show() re-uses them all).
  const prime = RenderTexture.create({ width: 8, height: 8 });
  root.visible = true;
  app.renderer.render({ container: root, target: prime });
  root.visible = false;
  prime.destroy(true);

  let shown = false;
  const show = (): void => {
    if (shown || root.destroyed) return;
    shown = true;
    root.visible = true;
    app.ticker.add(anim);
  };

  // A card can be pulled down before it has finished arriving — the dev level
  // picker swaps the board out from under it — and both of the things it left
  // running would outlive it: `anim` writing alpha into a destroyed container
  // every frame, and the scrim's layout subscription holding that container
  // alive for the rest of the session. (Removing a never-added anim is a no-op,
  // so this is safe for a card destroyed while still prepared.)
  root.once('destroyed', () => {
    app.ticker.remove(anim);
    unbindScrim();
  });

  buttonBox.on('pointertap', o.onButton);
  storeBox?.on('pointertap', o.onStore);

  return { root, show };
}

/** Build and raise a card in one go — the path for callers with no quiet
 *  moment to prepare in (the dev `?card=` hook). */
export function showEndCard(
  app: Application, parent: Container, tex: EndCardTextures, o: EndCardOpts,
): Container {
  const card = buildEndCard(app, parent, tex, o);
  card.show();
  return card.root;
}
