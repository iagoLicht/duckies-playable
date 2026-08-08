import { describe, expect, it } from 'vitest';
import {
  BLEED_PAD, computeLayout, DESIGN_H, DESIGN_W, type Insets, type Viewport,
} from '../../src/game/layout';

/**
 * THE BOARD IS 720x1280 AND NO PHONE IS.
 *
 * Every number in scene.ts, main.ts and endCard.ts is a design-space number —
 * the tub is traced at fixed coordinates, the HUD bar sits at y 45, the ducks
 * are authored at level coordinates. Nothing about that changes per device.
 * What changes is where that box lands on the glass, and this file is the whole
 * of that decision, kept pure so it can be checked here rather than by eye on
 * nine phones.
 *
 * The load-bearing property is the LAST one: the design box always lands inside
 * the safe area. Not "usually", not "on the phones we tried" — for every
 * viewport and every inset, by construction, because the fit is computed
 * against the safe rect rather than against the screen. That is what makes the
 * HUD's clearance of a Dynamic Island a fact about the arithmetic instead of a
 * margin somebody guessed.
 */
const NONE: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
const vp = (width: number, height: number, insets: Insets = NONE): Viewport =>
  ({ width, height, insets });

/**
 * Real reported viewports and their real insets (Safari/Chrome CSS px with
 * `viewport-fit=cover`). The island phones are the point of the exercise: 59px
 * of inset at the top, 34 at the bottom for the home indicator.
 */
const DEVICES: Array<{ name: string; v: Viewport }> = [
  { name: 'iPhone SE (no insets)', v: vp(375, 667) },
  { name: 'iPhone 13 mini (notch)', v: vp(375, 812, { top: 50, right: 0, bottom: 34, left: 0 }) },
  { name: 'iPhone 14 (notch)', v: vp(390, 844, { top: 47, right: 0, bottom: 34, left: 0 }) },
  { name: 'iPhone 15 Pro (island)', v: vp(393, 852, { top: 59, right: 0, bottom: 34, left: 0 }) },
  { name: 'iPhone 15 Pro Max (island)', v: vp(430, 932, { top: 59, right: 0, bottom: 34, left: 0 }) },
  { name: 'iPhone 15 landscape (island)', v: vp(852, 393, { top: 0, right: 59, bottom: 21, left: 59 }) },
  { name: 'Pixel 7 (cutout)', v: vp(412, 915, { top: 24, right: 0, bottom: 24, left: 0 }) },
  { name: 'Galaxy S8 (tall 18.5:9)', v: vp(360, 740) },
  { name: 'small legacy Android', v: vp(320, 480) },
  { name: 'iPad portrait 4:3', v: vp(820, 1180, { top: 24, right: 0, bottom: 20, left: 0 }) },
  { name: 'iPad landscape', v: vp(1180, 820, { top: 24, right: 0, bottom: 20, left: 0 }) },
  { name: 'desktop window', v: vp(1440, 900) },
  { name: 'ad slot, near-square', v: vp(600, 620) },
  { name: 'ad slot, very wide', v: vp(1920, 480) },
  { name: 'ad slot, very tall', v: vp(320, 1600) },
];

describe('the responsive layout', () => {
  it('fills the viewport exactly, whatever its shape', () => {
    for (const { name, v } of DEVICES) {
      const l = computeLayout(v);
      expect(`${name}: ${l.width}x${l.height}`).toBe(`${name}: ${v.width}x${v.height}`);
    }
  });

  it('scales the board uniformly — never a squashed duck', () => {
    for (const { name, v } of DEVICES) {
      const l = computeLayout(v);
      // one number for both axes is the guarantee; the check is that it is a
      // usable one, since a zero or negative scale renders nothing at all
      expect(Number.isFinite(l.scale), name).toBe(true);
      expect(l.scale, name).toBeGreaterThan(0);
    }
  });

  it('centres the board in the space it is allowed to use', () => {
    for (const { name, v } of DEVICES) {
      const l = computeLayout(v);
      const { top, right, bottom, left } = v.insets;
      const gapL = l.x - left;
      const gapR = (v.width - right) - (l.x + DESIGN_W * l.scale);
      const gapT = l.y - top;
      const gapB = (v.height - bottom) - (l.y + DESIGN_H * l.scale);
      expect(Math.abs(gapL - gapR), `${name} horizontal`).toBeLessThan(1e-9);
      expect(Math.abs(gapT - gapB), `${name} vertical`).toBeLessThan(1e-9);
    }
  });

  it('THE BOARD NEVER CROSSES INTO THE SAFE-AREA INSETS', () => {
    // the island, the notch, the home indicator, the rounded corners: whatever
    // the OS has reserved, no part of the 720x1280 box — and so no part of the
    // HUD bar, which lives at design y 45..175 — is ever drawn under it
    const eps = 1e-9;
    for (const { name, v } of DEVICES) {
      const l = computeLayout(v);
      expect(l.x, `${name} left`).toBeGreaterThanOrEqual(v.insets.left - eps);
      expect(l.y, `${name} top`).toBeGreaterThanOrEqual(v.insets.top - eps);
      expect(l.x + DESIGN_W * l.scale, `${name} right`)
        .toBeLessThanOrEqual(v.width - v.insets.right + eps);
      expect(l.y + DESIGN_H * l.scale, `${name} bottom`)
        .toBeLessThanOrEqual(v.height - v.insets.bottom + eps);
    }
  });

  it('an inset that grows pushes the board off it, it does not just shrink it', () => {
    // the island case in miniature: same screen, insets added, and the board
    // moves down clear of them rather than staying put and being covered
    const bare = computeLayout(vp(393, 852));
    const island = computeLayout(vp(393, 852, { top: 59, right: 0, bottom: 34, left: 0 }));
    expect(island.y).toBeGreaterThanOrEqual(59);
    expect(island.y).toBeGreaterThan(bare.y);
  });

  it('the bleed rect covers the whole canvas, in design coordinates', () => {
    // what every full-screen overlay is drawn to: the tint has to reach the
    // corners of the GLASS, not the corners of the board, or a letterboxed
    // phone shows an untinted margin around a dimmed board
    for (const { name, v } of DEVICES) {
      const l = computeLayout(v);
      // Mapped back through the fit it OVERHANGS the canvas by exactly
      // BLEED_PAD on each side. The overhang is the point: Pixi's buffer
      // rounding can leave the rendered area a fraction of a CSS pixel bigger
      // than the size we asked for, and a fill that stops at the requested size
      // shows a hairline of the clear colour down one edge — a bright pink line
      // beside a dark scrim. See Layout.bleed.
      expect(l.bleed.x * l.scale + l.x, `${name} left`).toBeCloseTo(-BLEED_PAD, 9);
      expect(l.bleed.y * l.scale + l.y, `${name} top`).toBeCloseTo(-BLEED_PAD, 9);
      expect((l.bleed.x + l.bleed.width) * l.scale + l.x, `${name} right`)
        .toBeCloseTo(v.width + BLEED_PAD, 9);
      expect((l.bleed.y + l.bleed.height) * l.scale + l.y, `${name} bottom`)
        .toBeCloseTo(v.height + BLEED_PAD, 9);
      // and it always contains the board, so an overlay can never fall short
      expect(l.bleed.x, name).toBeLessThanOrEqual(0);
      expect(l.bleed.y, name).toBeLessThanOrEqual(0);
      expect(l.bleed.x + l.bleed.width, name).toBeGreaterThanOrEqual(DESIGN_W);
      expect(l.bleed.y + l.bleed.height, name).toBeGreaterThanOrEqual(DESIGN_H);
    }
  });

  it('reports the insets it actually used, clamped', () => {
    // they are on the Layout because two different inset sets can produce
    // identical geometry (see the pair below), so geometry alone cannot tell a
    // layout-change watcher that anything happened
    const l = computeLayout(vp(393, 852, { top: 59, right: 0, bottom: 34, left: 0 }));
    expect(l.insets).toEqual({ top: 59, right: 0, bottom: 34, left: 0 });
    // negatives and NaN are clamped away rather than propagated
    expect(computeLayout(vp(393, 852, { top: -5, right: Number.NaN, bottom: 0, left: 0 })).insets)
      .toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it('two inset sets can fit the board identically — the insets tell them apart', () => {
    // 50px down each side of an 800x1200 screen is entirely absorbed by the
    // letterbox this board already had there: same scale, same origin. A change
    // watcher comparing only the geometry would call this "nothing happened".
    const bare = computeLayout(vp(800, 1200));
    const sides = computeLayout(vp(800, 1200, { top: 0, right: 50, bottom: 0, left: 50 }));
    expect(sides.scale).toBe(bare.scale);
    expect(sides.x).toBe(bare.x);
    expect(sides.y).toBe(bare.y);
    expect(sides.insets).not.toEqual(bare.insets);
    expect(sides.safe.width).toBeLessThan(bare.safe.width);
  });

  it('reports the safe area in design coordinates, and the board sits inside it', () => {
    for (const { name, v } of DEVICES) {
      const l = computeLayout(v);
      expect(l.safe.x, name).toBeLessThanOrEqual(1e-9);
      expect(l.safe.y, name).toBeLessThanOrEqual(1e-9);
      expect(l.safe.x + l.safe.width, name).toBeGreaterThanOrEqual(DESIGN_W - 1e-9);
      expect(l.safe.y + l.safe.height, name).toBeGreaterThanOrEqual(DESIGN_H - 1e-9);
    }
  });

  it('an exactly 9:16 screen with no insets is the old fixed layout, untouched', () => {
    // the shape everything was authored against: no letterbox, scale is the
    // plain ratio, origin at the corner. A regression here would mean the
    // responsive pass moved the board on the device it was designed for.
    const l = computeLayout(vp(720, 1280));
    expect(l.scale).toBe(1);
    expect(l.x).toBe(0);
    expect(l.y).toBe(0);
    expect(l.bleed).toEqual({
      x: -BLEED_PAD, y: -BLEED_PAD,
      width: DESIGN_W + BLEED_PAD * 2, height: DESIGN_H + BLEED_PAD * 2,
    });
  });

  it('a taller-than-9:16 phone is width-bound; a wider one is height-bound', () => {
    const tall = computeLayout(vp(393, 852)); // 0.46 — narrower than 0.5625
    expect(tall.scale).toBeCloseTo(393 / DESIGN_W, 12);
    expect(tall.x).toBeCloseTo(0, 12);
    expect(tall.y).toBeGreaterThan(0);

    const wide = computeLayout(vp(820, 1180)); // 0.69 — wider than 0.5625
    expect(wide.scale).toBeCloseTo(1180 / DESIGN_H, 12);
    expect(wide.y).toBeCloseTo(0, 12);
    expect(wide.x).toBeGreaterThan(0);
  });

  it('survives the nonsense a real browser can hand it', () => {
    // a hidden iframe reports 0x0; an early orientation change can report insets
    // bigger than the screen. Neither may produce NaN, a negative scale, or a
    // divide-by-zero — a layout that returns NaN paints nothing and the ad is
    // simply a blank rectangle to whoever paid for it.
    for (const v of [
      vp(0, 0),
      vp(1, 1),
      vp(-100, -100),
      vp(200, 200, { top: 400, right: 400, bottom: 400, left: 400 }),
      vp(300, 600, { top: Number.NaN, right: 0, bottom: 0, left: 0 }),
      vp(300, 600, { top: Number.POSITIVE_INFINITY, right: 0, bottom: 0, left: 0 }),
      vp(300, 600, { top: -50, right: 0, bottom: 0, left: 0 }),
    ]) {
      const l = computeLayout(v);
      for (const n of [l.width, l.height, l.scale, l.x, l.y,
        l.bleed.x, l.bleed.y, l.bleed.width, l.bleed.height]) {
        expect(Number.isFinite(n)).toBe(true);
      }
      expect(l.scale).toBeGreaterThan(0);
      expect(l.width).toBeGreaterThan(0);
      expect(l.height).toBeGreaterThan(0);
    }
  });
});
