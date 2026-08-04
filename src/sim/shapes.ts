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

const COLLIDERS: Collider[] = [
  { pts: sampleTub(INSET), closed: true, source: 'wall', mode: 'inside' },
  { pts: LEFT_BUMPER, closed: true, source: 'bumper', mode: 'outside' },
  { pts: RIGHT_BUMPER, closed: true, source: 'bumper', mode: 'outside' },
];

function closestOnSegment(
  px: number, py: number, ax: number, ay: number, bx: number, by: number,
): { x: number; y: number } {
  const abx = bx - ax, aby = by - ay;
  const len2 = abx * abx + aby * aby || 1;
  let t = ((px - ax) * abx + (py - ay) * aby) / len2;
  t = Math.max(0, Math.min(1, t));
  return { x: ax + abx * t, y: ay + aby * t };
}

function pointInPolygon(px: number, py: number, pts: Array<{ x: number; y: number }>): boolean {
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
 * Test a circle against every collider. Returns the corrected centre plus the
 * contact normal (pointing into free space), or null when unobstructed.
 * Resolves ONE contact per call — callers iterate (substeps make this stable).
 */
export function collideCircle(x: number, y: number, r: number): Hit | null {
  for (const col of COLLIDERS) {
    // nearest boundary point across all segments
    let best: { x: number; y: number } | null = null;
    let bestD2 = Infinity;
    const n = col.pts.length;
    const last = col.closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const a = col.pts[i]!;
      const b = col.pts[(i + 1) % n]!;
      const c = closestOnSegment(x, y, a.x, a.y, b.x, b.y);
      const d2 = (c.x - x) ** 2 + (c.y - y) ** 2;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = c;
      }
    }
    if (!best) continue;
    const d = Math.sqrt(bestD2);
    const inside = pointInPolygon(x, y, col.pts);
    if (col.mode === 'inside') {
      // must stay inside the loop, at least r from the boundary
      if (!inside || d < r) {
        let nx = x - best.x, ny = y - best.y;
        if (!inside) { nx = -nx; ny = -ny; }
        const len = Math.hypot(nx, ny) || 1;
        nx /= len; ny /= len;
        return { x: best.x + nx * r, y: best.y + ny * r, nx, ny, source: col.source };
      }
    } else {
      // must stay outside the loop, at least r from the boundary
      if (inside || d < r) {
        let nx = x - best.x, ny = y - best.y;
        if (inside) { nx = -nx; ny = -ny; }
        const len = Math.hypot(nx, ny) || 1;
        nx /= len; ny /= len;
        return { x: best.x + nx * r, y: best.y + ny * r, nx, ny, source: col.source };
      }
    }
  }
  return null;
}
