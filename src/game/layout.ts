/**
 * WHERE THE BOARD GOES ON A SCREEN THAT IS NOT 720x1280.
 *
 * Everything else in this project is authored in one fixed design space: the
 * tub is traced at literal coordinates in main.ts, the HUD bar sits at y 45,
 * the levels place ducks at authored points. That is worth keeping — it is why
 * a measurement in a comment still means something a year later — so nothing
 * here reflows content. This module answers one question instead: given a
 * screen, where does the 720x1280 box land on it, and what is left over.
 *
 * THE FIT IS AGAINST THE SAFE AREA, NOT THE SCREEN. That single choice is what
 * makes the HUD's clearance of a Dynamic Island arithmetic rather than a margin
 * somebody guessed: the box is centred in what the OS has left us, so no part
 * of it — and the bar is the topmost part — can be under the island, the notch,
 * the home indicator or a rounded corner. See tests/sim/layout.test.ts, which
 * asserts exactly that over the real device matrix.
 *
 * WHAT FILLS THE LEFTOVER: the canvas covers the whole viewport, always, and
 * the leftover is painted with the same tiled bathroom wall the board sits on
 * (main.ts). The old build sized the canvas to the board and let the page's
 * background colour show around it, which on a 19.5:9 phone was two flat pink
 * bands of nothing. `bleed` is that leftover expressed in design coordinates,
 * and it is what any full-screen overlay must be drawn to — a scrim drawn to
 * 0,0,720,1280 dims the board and leaves the margins bright, which reads as a
 * bug on every phone that is not exactly 9:16.
 *
 * Pure, and deliberately: the arithmetic is testable in node, and only the
 * bottom third of the file touches the DOM.
 */
export const DESIGN_W = 720;
export const DESIGN_H = 1280;

/** CSS px the OS has reserved on each edge — `env(safe-area-inset-*)`. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Viewport {
  /** CSS px */
  width: number;
  height: number;
  insets: Insets;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Layout {
  /** canvas size in CSS px — the whole viewport, never less */
  width: number;
  height: number;
  /** the insets actually used: the caller's, clamped to something usable */
  insets: Insets;
  /** design px -> CSS px. One number: the board is never squashed on one axis */
  scale: number;
  /** where design (0,0) lands, in CSS px from the canvas corner */
  x: number;
  y: number;
  /**
   * The whole canvas in DESIGN coordinates, origin included — negative x/y on
   * any screen that is not exactly 9:16. Draw full-screen overlays to this.
   *
   * It OVERHANGS the canvas by BLEED_PAD on every side, and that is the whole
   * reason it is a rect rather than a couple of divisions at the call site.
   * Pixi rounds its backing buffer to whole device pixels and, with
   * autoDensity, derives the renderer's CSS size back from it
   * (TextureSource.resize: `width = round(width * resolution) / resolution`).
   * At a fractional devicePixelRatio — 1.5 is Windows at 150% scaling, Chrome
   * at 150% zoom, and a large slice of budget Android — that lands up to half a
   * device pixel AWAY from the size we asked for, in either direction. An
   * overlay drawn to the exact requested size then stops a fraction of a pixel
   * short of the glass, and what shows through the gap is the renderer's clear
   * colour: a flat hairline down one edge of the screen. Under the plain board
   * it is a ~3-unit colour difference nobody sees. Under the end card's scrim
   * it is a 155-unit bright pink line down the full edge of a dark modal.
   */
  bleed: Rect;
  /**
   * The safe area in DESIGN coordinates. Always contains 0,0,720,1280 (that is
   * the fit's whole point), so it is not needed to place the HUD — it is here
   * for anything that wants to reach TOWARD an edge without crossing an inset.
   */
  safe: Rect;
}

export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * How far `bleed` overhangs the canvas, in CSS px. One is provably enough: the
 * worst case is half a device pixel of rounding (see `Layout.bleed`), and no
 * resolution this renderer accepts makes half a device pixel as much as one CSS
 * px. It costs a one-pixel border of overdraw on a fill that was already
 * covering the screen.
 */
export const BLEED_PAD = 1;

/** A browser can report anything: NaN mid-orientation-change, insets wider than
 *  the screen in a hidden iframe. Nothing downstream may see a NaN. */
const finite = (n: number, fallback = 0): number => (Number.isFinite(n) ? n : fallback);

/** -0 is a real result of negating an origin at zero, and it compares equal to
 *  0 everywhere except in a test's deep-equal. Fold it away at the source. */
const nz = (n: number): number => (n === 0 ? 0 : n);

/**
 * Keep the usable box at least 1px on each axis, shrinking a pair of insets
 * proportionally if they would swallow the screen. A layout that returns 0 or a
 * negative scale paints nothing, and an ad that paints nothing is indisting-
 * uishable from an ad that crashed.
 */
const fitInsets = (a: number, b: number, extent: number): [number, number] => {
  const lo = Math.max(0, finite(a));
  const hi = Math.max(0, finite(b));
  const room = extent - 1;
  if (lo + hi <= room) return [lo, hi];
  if (lo + hi === 0) return [0, 0];
  const k = Math.max(0, room) / (lo + hi);
  return [lo * k, hi * k];
};

export function computeLayout(v: Viewport): Layout {
  const width = Math.max(1, finite(v.width, 1));
  const height = Math.max(1, finite(v.height, 1));
  const [left, right] = fitInsets(v.insets.left, v.insets.right, width);
  const [top, bottom] = fitInsets(v.insets.top, v.insets.bottom, height);

  const availW = width - left - right;
  const availH = height - top - bottom;
  // contain, not cover: the board is a fixed composition and cropping it would
  // cut the tub, the bumpers or the bar off the side of a phone
  const scale = Math.min(availW / DESIGN_W, availH / DESIGN_H);
  const x = left + (availW - DESIGN_W * scale) / 2;
  const y = top + (availH - DESIGN_H * scale) / 2;

  const pad = BLEED_PAD / scale;
  return {
    width,
    height,
    insets: { top, right, bottom, left },
    scale,
    x,
    y,
    bleed: {
      x: -x / scale - pad,
      y: -y / scale - pad,
      width: width / scale + pad * 2,
      height: height / scale + pad * 2,
    },
    safe: {
      x: nz((left - x) / scale),
      y: nz((top - y) / scale),
      width: availW / scale,
      height: availH / scale,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// the DOM half: reading the real viewport, and telling everyone when it moves
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The live layout. A SINGLE MUTABLE OBJECT, updated in place, because there is
 * exactly one screen and because a card built three seconds ago must see the
 * rotation that happened since without having been handed a new object.
 */
export const layout: Layout = computeLayout({
  width: DESIGN_W, height: DESIGN_H, insets: NO_INSETS,
});

type Listener = (l: Layout) => void;
const listeners = new Set<Listener>();

/**
 * Run `fn` on every layout change, and once immediately — a caller that has to
 * remember to paint itself the first time will eventually forget. Returns the
 * unsubscribe, which anything with a shorter life than the page (the end card)
 * must call when it is destroyed.
 */
export function onLayout(fn: Listener): () => void {
  listeners.add(fn);
  fn(layout);
  return () => listeners.delete(fn);
}

/**
 * The safe-area probe.
 *
 * `env(safe-area-inset-*)` cannot be read from JS — it only resolves inside a
 * CSS declaration — so the standard trick is to spend it on a hidden element's
 * padding and read that back. Needs `viewport-fit=cover` in the viewport meta
 * (index.html has it) or the insets are all zero even on an island phone.
 *
 * The `var(--dp-safe-*)` in front of each `env()` is an override, and it is not
 * dev-only scaffolding: it is how the insets get tested at all. No desktop
 * browser and no Playwright device emulation reports a real inset, so without
 * it the island path could only ever be checked by holding a phone. A harness
 * sets `--dp-safe-top: 59px` on <html> and the whole pipeline downstream of
 * here is the same code the phone runs. Shipping it costs four `var()` lookups
 * once per resize.
 */
let probe: HTMLElement | null = null;

const safeProbe = (): HTMLElement => {
  if (probe?.isConnected) return probe;
  const el = document.createElement('div');
  el.id = 'dp-safe-probe';
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText = [
    'position:fixed',
    'top:0',
    'left:0',
    'width:0',
    'height:0',
    // visibility, NOT display:none — a display:none element still computes its
    // padding, but keeping it in the layout tree is the documented-safe read
    'visibility:hidden',
    'pointer-events:none',
    'padding-top:var(--dp-safe-top, env(safe-area-inset-top, 0px))',
    'padding-right:var(--dp-safe-right, env(safe-area-inset-right, 0px))',
    'padding-bottom:var(--dp-safe-bottom, env(safe-area-inset-bottom, 0px))',
    'padding-left:var(--dp-safe-left, env(safe-area-inset-left, 0px))',
  ].join(';');
  document.body.appendChild(el);
  probe = el;
  return el;
};

export function readInsets(): Insets {
  if (typeof document === 'undefined') return NO_INSETS;
  const cs = getComputedStyle(safeProbe());
  return {
    top: finite(parseFloat(cs.paddingTop)),
    right: finite(parseFloat(cs.paddingRight)),
    bottom: finite(parseFloat(cs.paddingBottom)),
    left: finite(parseFloat(cs.paddingLeft)),
  };
}

/**
 * The element the canvas lives in. MEASURING THE CONTAINER, NOT THE WINDOW, is
 * deliberate: the canvas's job is to fill its box exactly, and the box is the
 * only thing that knows how big it is.
 *
 * An earlier pass sized from `window.visualViewport`, which is a different
 * rectangle from the one a `position: fixed; inset: 0` container occupies, and
 * the two come apart the moment anyone pinch-zooms — visualViewport reports the
 * zoomed sub-rect, the container stays full size, and the canvas collapses to
 * the middle of it with the page background showing around it. (The viewport
 * meta says `user-scalable=no`; iOS Safari has ignored that since iOS 10 and
 * Android has an accessibility override, so it is not a defence.) The same
 * mismatch is the classic iOS URL-bar failure. Measure the box, fill the box.
 */
let host: HTMLElement | null = null;

export function setLayoutHost(el: HTMLElement): void {
  host = el;
}

export function readViewport(): Viewport {
  const insets = readInsets();
  // Ceil, not round: a canvas half a pixel short of its container shows a
  // hairline of page background down one edge.
  if (host) {
    const r = host.getBoundingClientRect();
    if (r.width >= 1 && r.height >= 1) {
      return { width: Math.ceil(r.width), height: Math.ceil(r.height), insets };
    }
  }
  if (typeof window === 'undefined') return { width: DESIGN_W, height: DESIGN_H, insets };
  return { width: Math.ceil(window.innerWidth), height: Math.ceil(window.innerHeight), insets };
}

/**
 * Recompute from the live DOM and tell every listener — unless nothing moved.
 *
 * The guard is not a micro-optimisation. iOS fires visualViewport `scroll`
 * continuously while the URL bar slides, and a listener chain that ends in
 * `renderer.resize()` re-allocates the render target every one of those events.
 * Five numbers decide the whole layout, so comparing them is the entire test.
 */
export function refreshLayout(force = false): Layout {
  const next = computeLayout(readViewport());
  // The insets are in the comparison and not just the five geometry numbers,
  // because they can change WITHOUT changing them: 800x1200 with no insets and
  // 800x1200 with 50px down each side both fit the board at scale 0.9375,
  // origin 62.5,0. Compare geometry alone and `safe` silently keeps the old
  // rect for the rest of the session.
  const same = next.width === layout.width && next.height === layout.height
    && next.scale === layout.scale && next.x === layout.x && next.y === layout.y
    && next.insets.top === layout.insets.top && next.insets.right === layout.insets.right
    && next.insets.bottom === layout.insets.bottom && next.insets.left === layout.insets.left;
  if (same && !force) return layout;
  Object.assign(layout, next);
  for (const fn of [...listeners]) fn(layout);
  return layout;
}

/**
 * Start tracking the viewport. Coalesced onto one animation frame because a
 * single rotation fires resize + visualViewport resize + orientationchange, and
 * because iOS updates `env(safe-area-inset-*)` a beat AFTER the resize — the
 * deferred read is the one that sees the new insets. Then a second pass on the
 * next frame catches the stragglers, which costs one relayout per rotation and
 * removes a whole class of "the island is right only after you rotate twice".
 */
export function watchViewport(el?: HTMLElement): void {
  if (typeof window === 'undefined') return;
  if (el) setLayoutHost(el);
  let queued = 0;
  const kick = (): void => {
    if (queued) cancelAnimationFrame(queued);
    queued = requestAnimationFrame(() => {
      queued = 0;
      refreshLayout();
      requestAnimationFrame(() => refreshLayout());
    });
  };
  window.addEventListener('resize', kick);
  window.addEventListener('orientationchange', kick);
  // still worth listening to even though nothing is measured from them: they
  // are what fires when iOS's URL bar slides, and the container's box moves
  // with it
  window.visualViewport?.addEventListener('resize', kick);
  window.visualViewport?.addEventListener('scroll', kick);
  // …and this is the only signal that catches an ad slot resized by its host
  // page without the window ever changing size
  if (host && typeof ResizeObserver !== 'undefined') new ResizeObserver(kick).observe(host);
  // forced: the first pass must reach every listener even on the one screen
  // whose measurements happen to equal the module's starting values
  refreshLayout(true);
}
