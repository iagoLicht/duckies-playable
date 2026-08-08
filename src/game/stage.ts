import { Application, Container, Graphics } from 'pixi.js';
import { onLayout, type Layout } from './layout';

/**
 * THE THREE LAYERS EVERYTHING HANGS OFF, and why there are exactly three.
 *
 * The renderer's canvas is the viewport now, not the board, so "add it to the
 * stage" is no longer a complete instruction — the stage is in screen pixels
 * and every coordinate in this project is in design pixels. `root` is the
 * bridge: one scale and one offset, set by layout.ts, and everything inside it
 * goes on using the numbers it always used.
 *
 *   root        design space (720x1280 sits at 0,0)
 *    +- backdrop  the wall, stretched over the whole glass. Does NOT shake.
 *    +- board     tub, ducks, fx, HUD. The camera shake moves this.
 *    +- overlay   end cards and full-screen tints. Above the shake, never in it.
 *
 * The split between backdrop and board is what the shake made necessary: the
 * old build shook the entire stage, which was safe only because the canvas
 * ended exactly where the board did and the page behind it was the same shade
 * of pink. Shake the wall now and a 3px band of nothing appears along the edge
 * of the phone. So the wall holds still, the board shakes inside it, and the
 * effect looks the same for the first time on a screen that is not 9:16.
 *
 * The overlay sits outside the shake for the opposite reason: a card that
 * shivers when a crate explodes underneath it reads as a rendering fault.
 */
export interface StageLayers {
  root: Container;
  backdrop: Container;
  board: Container;
  overlay: Container;
}

export function buildStage(app: Application): StageLayers {
  const root = new Container();
  const backdrop = new Container();
  const board = new Container();
  const overlay = new Container();
  root.addChild(backdrop, board, overlay);
  app.stage.addChild(root);

  onLayout((l) => applyLayout(app, root, l));
  return { root, backdrop, board, overlay };
}

/**
 * Canvas to the viewport, board into the safe area.
 *
 * Resolution is re-applied on every pass rather than once at boot because it
 * genuinely changes mid-session: dragging a window between a retina and a
 * non-retina monitor, or a browser zoom, moves devicePixelRatio, and a renderer
 * left at the old one draws a soft or a needlessly expensive frame. Capped at 2
 * — a 3x phone renders 9x the pixels for a difference nobody has ever seen in a
 * playable, and the frame budget is 60fps on a mid-range Android.
 */
export function applyLayout(app: Application, root: Container, l: Layout): void {
  const dpr = Math.min(typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1, 2);
  app.renderer.resize(l.width, l.height, dpr);
  // THE CSS SIZE IS SET BY HAND, over the one `autoDensity` just wrote.
  //
  // Pixi rounds the backing buffer to whole device pixels and then derives the
  // element's CSS size back from it, so at a fractional devicePixelRatio the
  // canvas ends up a fraction of a pixel off the size we asked for — at 1.25 it
  // rounds DOWN, and the element is smaller than its container, which shows a
  // sliver of page background down an edge. Stating the size we actually want
  // costs the browser a sub-0.1% scale of the buffer and makes the element
  // exactly its box. (The other direction, where the RENDER falls short of the
  // element, is what BLEED_PAD covers.)
  const canvas = app.renderer.canvas as HTMLCanvasElement;
  if (canvas.style) {
    canvas.style.width = `${l.width}px`;
    canvas.style.height = `${l.height}px`;
  }
  root.scale.set(l.scale);
  root.position.set(l.x, l.y);
}

/**
 * Paint `g` as a flat fill over the ENTIRE canvas — the one correct way to draw
 * a tint in this codebase.
 *
 * A tint drawn to 0,0,720,1280 covers the board and stops, which on any screen
 * that is not exactly 9:16 leaves the wall around it at full brightness: the
 * board dims, the margins do not, and the card appears to be sitting in a lit
 * frame. Drawing to `layout.bleed` instead covers the glass on every aspect
 * ratio, and re-covers it when the phone is rotated under a card that is
 * already up.
 *
 * Returns the unsubscribe. Callers with a life shorter than the page's MUST
 * call it, or the closure keeps a destroyed Graphics alive forever.
 */
export function coverScreen(g: Graphics, colour: number, alpha: number): () => void {
  return onLayout((l) => {
    g.clear()
      .rect(l.bleed.x, l.bleed.y, l.bleed.width, l.bleed.height)
      .fill({ color: colour, alpha });
  });
}
