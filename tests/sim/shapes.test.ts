import { describe, expect, it } from 'vitest';
import { COLLIDERS, collideCircle, type Hit } from '../../src/sim/shapes';
import { mulberry32 } from '../../src/sim/rng';

describe('tub boundary collision', () => {
  it('does nothing for a circle well inside', () => {
    expect(collideCircle(360, 700, 46)).toBeNull();
  });

  it('pushes a circle back inside through the left wall', () => {
    const hit = collideCircle(30, 700, 46);
    expect(hit).not.toBeNull();
    expect(hit!.x).toBeGreaterThan(30);
    expect(hit!.nx).toBeGreaterThan(0.9); // normal points inward (+x)
  });

  it('pushes back at the bottom edge', () => {
    const hit = collideCircle(360, 1265, 46);
    expect(hit).not.toBeNull();
    expect(hit!.y).toBeLessThan(1265);
    expect(hit!.ny).toBeLessThan(-0.9);
  });

  it('collides with the top-right shoulder region', () => {
    const hit = collideCircle(660, 230, 46);
    expect(hit).not.toBeNull();
  });

  it('collides with the left bumper triangle', () => {
    const hit = collideCircle(120, 950, 46);
    expect(hit).not.toBeNull();
    expect(hit!.nx).toBeGreaterThan(0.3); // deflects rightward off the tip slope
  });

  it('registers bumper hits with source=bumper', () => {
    const hit = collideCircle(120, 950, 46);
    expect(hit!.source).toBe('bumper');
  });

  it('boundary hits report source=wall', () => {
    expect(collideCircle(30, 700, 46)!.source).toBe('wall');
  });
});

/**
 * The original, un-optimized collideCircle, kept verbatim as the reference the
 * shipping implementation must match BIT-FOR-BIT — the sim is deterministic and
 * replays depend on it, so a geometry optimization may not move a single float.
 */
function referenceClosest(
  px: number, py: number, ax: number, ay: number, bx: number, by: number,
): { x: number; y: number } {
  const abx = bx - ax, aby = by - ay;
  const len2 = abx * abx + aby * aby || 1;
  let t = ((px - ax) * abx + (py - ay) * aby) / len2;
  t = Math.max(0, Math.min(1, t));
  return { x: ax + abx * t, y: ay + aby * t };
}

function referenceInPolygon(px: number, py: number, pts: Array<{ x: number; y: number }>): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!, b = pts[j]!;
    if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function referenceCollide(x: number, y: number, r: number): Hit | null {
  for (const col of COLLIDERS) {
    let best: { x: number; y: number } | null = null;
    let bestD2 = Infinity;
    const n = col.pts.length;
    const last = col.closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const a = col.pts[i]!;
      const b = col.pts[(i + 1) % n]!;
      const c = referenceClosest(x, y, a.x, a.y, b.x, b.y);
      const d2 = (c.x - x) ** 2 + (c.y - y) ** 2;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = c;
      }
    }
    if (!best) continue;
    const d = Math.sqrt(bestD2);
    const inside = referenceInPolygon(x, y, col.pts);
    const violating = col.mode === 'inside' ? !inside || d < r : inside || d < r;
    if (violating) {
      let nx = x - best.x, ny = y - best.y;
      const flip = col.mode === 'inside' ? !inside : inside;
      if (flip) { nx = -nx; ny = -ny; }
      const len = Math.hypot(nx, ny) || 1;
      nx /= len; ny /= len;
      return { x: best.x + nx * r, y: best.y + ny * r, nx, ny, source: col.source };
    }
  }
  return null;
}

describe('collideCircle equivalence with the reference sweep', () => {
  it('matches exactly over grid, boundary bands and random probes', () => {
    const probes: Array<[number, number, number]> = [];
    for (let gx = -32; gx <= 752; gx += 16) {
      for (let gy = 168; gy <= 1312; gy += 16) probes.push([gx, gy, 46]);
    }
    // dense jittered band hugging every collider vertex, mixed radii
    const rng = mulberry32(20260808);
    for (const col of COLLIDERS) {
      for (let i = 0; i < col.pts.length; i += 3) {
        const p = col.pts[i]!;
        for (let k = 0; k < 6; k++) {
          probes.push([p.x + (rng() - 0.5) * 130, p.y + (rng() - 0.5) * 130, 8 + rng() * 40]);
        }
      }
    }
    for (let k = 0; k < 3000; k++) {
      probes.push([rng() * 840 - 60, rng() * 1420 - 70, 6 + rng() * 44]);
    }
    let hits = 0;
    for (const [px, py, r] of probes) {
      const got = collideCircle(px, py, r);
      const want = referenceCollide(px, py, r);
      expect(got).toEqual(want);
      if (want) hits++;
    }
    // the probe set must genuinely exercise contact resolution, not just misses
    expect(hits).toBeGreaterThan(800);
  });
});
