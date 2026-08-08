/**
 * Collision geometry. The tub boundary duplicates the visual `traceTub` shape in
 * src/main.ts (tub rect l26 t200 r694 b1254, shoulders s52 d60, rc18, rb46) —
 * sampled as a dense polygon at the INNER FACE (offset 20 from centerline: the
 * navy edge is at 15, ducks visually overlap the white ring a touch, matching
 * the reference playable). If main.ts geometry changes, change this too.
 */
export interface Hit {
  x: number;
  y: number;
  nx: number;
  ny: number;
  source: 'wall' | 'bumper';
}

const TUB = { l: 26, t: 200, r: 694, b: 1254, s: 52, d: 60 };
const INSET = 20;

function sampleTub(o: number): Array<{ x: number; y: number }> {
  const l = TUB.l + o, t = TUB.t + o, r = TUB.r - o, b = TUB.b - o;
  const { s, d } = TUB;
  const rc = 18;
  const rb = 46 - o;
  const pts: Array<{ x: number; y: number }> = [];
  const line = (x1: number, y1: number, x2: number, y2: number): void => {
    const n = Math.max(2, Math.round(Math.hypot(x2 - x1, y2 - y1) / 14));
    for (let i = 0; i < n; i++) pts.push({ x: x1 + ((x2 - x1) * i) / n, y: y1 + ((y2 - y1) * i) / n });
  };
  const arc = (cx: number, cy: number, rad: number, a1: number, a2: number): void => {
    for (let i = 0; i < 10; i++) {
      const a = a1 + ((a2 - a1) * i) / 10;
      pts.push({ x: cx + rad * Math.cos(a), y: cy + rad * Math.sin(a) });
    }
  };
  const bez = (
    p0: [number, number], c1: [number, number], c2: [number, number], p1: [number, number],
  ): void => {
    for (let i = 0; i < 12; i++) {
      const u = i / 12, v = 1 - u;
      pts.push({
        x: v * v * v * p0[0] + 3 * v * v * u * c1[0] + 3 * v * u * u * c2[0] + u * u * u * p1[0],
        y: v * v * v * p0[1] + 3 * v * v * u * c1[1] + 3 * v * u * u * c2[1] + u * u * u * p1[1],
      });
    }
  };
  const H = Math.PI / 2;
  line(l + s + rc, t, r - s - rc, t);
  arc(r - s - rc, t + rc, rc, -H, 0);
  line(r - s, t + rc, r - s, t + d - rc);
  bez([r - s, t + d - rc], [r - s, t + d + 18], [r, t + d], [r, t + d + 26]);
  line(r, t + d + 26, r, b - rb);
  arc(r - rb, b - rb, rb, 0, H);
  line(r - rb, b, l + rb, b);
  arc(l + rb, b - rb, rb, H, 2 * H);
  line(l, b - rb, l, t + d + 26);
  bez([l, t + d + 26], [l, t + d], [l + s, t + d + 18], [l + s, t + d - rc]);
  line(l + s, t + d - rc, l + s, t + rc);
  arc(l + s + rc, t + rc, rc, 2 * H, 3 * H);
  return pts;
}

/** Bumper triangles (flat edge on the wall at x=50 / x=670, tip pointing in). */
const LEFT_BUMPER = [
  { x: 50, y: 950 - 58 },
  { x: 50 + 78, y: 950 },
  { x: 50, y: 950 + 58 },
];
const RIGHT_BUMPER = LEFT_BUMPER.map((p) => ({ x: 720 - p.x, y: p.y }));

interface Collider {
  pts: Array<{ x: number; y: number }>;
  closed: boolean;
  source: 'wall' | 'bumper';
  /** 'inside' keeps the circle inside the loop; 'outside' pushes it away */
  mode: 'inside' | 'outside';
}

/** Exported for the equivalence test, which replays the reference algorithm
 *  over this exact geometry — not for gameplay use. */
export const COLLIDERS: Collider[] = [
  { pts: sampleTub(INSET), closed: true, source: 'wall', mode: 'inside' },
  { pts: LEFT_BUMPER, closed: true, source: 'bumper', mode: 'outside' },
  { pts: RIGHT_BUMPER, closed: true, source: 'bumper', mode: 'outside' },
];

/**
 * The hot-path geometry, packed once at load. collideCircle runs ~35x/tick from
 * wall collision and up to ~405x per aim-preview sweep, so the per-edge work is
 * flat arrays and zero allocation — the original object-per-edge scan showed up
 * as the sim's whole GC churn in profiles. The maths is UNCHANGED: the
 * equivalence test in tests/sim/shapes.test.ts replays the original algorithm
 * and requires bit-identical results, because replays depend on it.
 */
interface Packed {
  /** edge endpoints, one entry per edge (closed loops pre-wrapped) */
  ax: Float64Array; ay: Float64Array; bx: Float64Array; by: Float64Array;
  /** per-edge AABB, for an exact-safe "cannot beat the current best" reject */
  minx: Float64Array; miny: Float64Array; maxx: Float64Array; maxy: Float64Array;
  edges: number;
  col: Collider;
}

const PACKED: Packed[] = COLLIDERS.map((col) => {
  const n = col.pts.length;
  const edges = col.closed ? n : n - 1;
  const p: Packed = {
    ax: new Float64Array(edges), ay: new Float64Array(edges),
    bx: new Float64Array(edges), by: new Float64Array(edges),
    minx: new Float64Array(edges), miny: new Float64Array(edges),
    maxx: new Float64Array(edges), maxy: new Float64Array(edges),
    edges, col,
  };
  for (let i = 0; i < edges; i++) {
    const a = col.pts[i]!, b = col.pts[(i + 1) % n]!;
    p.ax[i] = a.x; p.ay[i] = a.y; p.bx[i] = b.x; p.by[i] = b.y;
    p.minx[i] = Math.min(a.x, b.x); p.maxx[i] = Math.max(a.x, b.x);
    p.miny[i] = Math.min(a.y, b.y); p.maxy[i] = Math.max(a.y, b.y);
  }
  return p;
});

function pointInPacked(px: number, py: number, p: Packed): boolean {
  // same crossing test as the original pointInPolygon, over the packed verts
  const pts = p.col.pts;
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!, b = pts[j]!;
    if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Signed clearance field, built once: for each cell centre, the distance to the
 * nearest collider boundary, negative when the centre is in violation (outside
 * the tub or inside a bumper). Distance-to-a-fixed-set is 1-Lipschitz, so any
 * point in a cell is at least `sd(centre) - CELL_DIAG` clear — when that still
 * exceeds r, no contact is possible and the whole edge scan is skipped. This is
 * a conservative filter only: it can never change an answer, just skip work.
 */
const CELL = 16;
const CELL_DIAG = (CELL / 2) * Math.SQRT2;
const GX0 = -64, GY0 = -64;
const GW = Math.ceil((720 + 128) / CELL);
const GH = Math.ceil((1280 + 128) / CELL);
const CLEARANCE = (() => {
  const grid = new Float64Array(GW * GH);
  for (let gy = 0; gy < GH; gy++) {
    for (let gx = 0; gx < GW; gx++) {
      const x = GX0 + (gx + 0.5) * CELL;
      const y = GY0 + (gy + 0.5) * CELL;
      let d2min = Infinity;
      let violated = false;
      for (const p of PACKED) {
        for (let i = 0; i < p.edges; i++) {
          const abx = p.bx[i]! - p.ax[i]!, aby = p.by[i]! - p.ay[i]!;
          const len2 = abx * abx + aby * aby || 1;
          let t = ((x - p.ax[i]!) * abx + (y - p.ay[i]!) * aby) / len2;
          t = Math.max(0, Math.min(1, t));
          const dx = p.ax[i]! + abx * t - x, dy = p.ay[i]! + aby * t - y;
          const d2 = dx * dx + dy * dy;
          if (d2 < d2min) d2min = d2;
        }
        const inside = pointInPacked(x, y, p);
        if (p.col.mode === 'inside' ? !inside : inside) violated = true;
      }
      grid[gy * GW + gx] = (violated ? -1 : 1) * Math.sqrt(d2min);
    }
  }
  return grid;
})();

/**
 * Test a circle against every collider. Returns the corrected centre plus the
 * contact normal (pointing into free space), or null when unobstructed.
 * Resolves ONE contact per call — callers iterate (substeps make this stable).
 */
export function collideCircle(x: number, y: number, r: number): Hit | null {
  // O(1) clear-water fast path — see CLEARANCE
  if (x >= GX0 && y >= GY0) {
    const gx = ((x - GX0) / CELL) | 0;
    const gy = ((y - GY0) / CELL) | 0;
    if (gx < GW && gy < GH && CLEARANCE[gy * GW + gx]! - CELL_DIAG > r) return null;
  }

  for (const p of PACKED) {
    // nearest boundary point across all segments — identical arithmetic to the
    // reference; the AABB reject only skips edges that cannot strictly beat
    // the running best, so the argmin (and its floats) are unchanged
    let bestX = 0, bestY = 0;
    let bestD2 = Infinity;
    for (let i = 0; i < p.edges; i++) {
      const rx = x < p.minx[i]! ? p.minx[i]! - x : x > p.maxx[i]! ? x - p.maxx[i]! : 0;
      const ry = y < p.miny[i]! ? p.miny[i]! - y : y > p.maxy[i]! ? y - p.maxy[i]! : 0;
      if (rx * rx + ry * ry >= bestD2) continue;
      const abx = p.bx[i]! - p.ax[i]!, aby = p.by[i]! - p.ay[i]!;
      const len2 = abx * abx + aby * aby || 1;
      let t = ((x - p.ax[i]!) * abx + (y - p.ay[i]!) * aby) / len2;
      t = Math.max(0, Math.min(1, t));
      const cx = p.ax[i]! + abx * t, cy = p.ay[i]! + aby * t;
      const d2 = (cx - x) ** 2 + (cy - y) ** 2;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestX = cx;
        bestY = cy;
      }
    }
    if (bestD2 === Infinity) continue;
    const d = Math.sqrt(bestD2);
    const inside = pointInPacked(x, y, p);
    const flip = p.col.mode === 'inside' ? !inside : inside;
    if (flip || d < r) {
      let nx = x - bestX, ny = y - bestY;
      if (flip) { nx = -nx; ny = -ny; }
      const len = Math.hypot(nx, ny) || 1;
      nx /= len; ny /= len;
      return { x: bestX + nx * r, y: bestY + ny * r, nx, ny, source: p.col.source };
    }
  }
  return null;
}
