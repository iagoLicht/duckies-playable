import { describe, expect, it } from 'vitest';
import { SIM } from '../../src/sim/config';
import { World } from '../../src/sim/world';

// Scratch verification for the bumper retune ג€” fires ducks at the left bumper
// tip (128, 950) from several angles and speeds, and tabulates in vs out.

interface Impact { label: string; inSpeed: number; outSpeed: number; ratio: number }

function shoot(angleDeg: number, speed: number, label: string): Impact | null {
  const w = new World(1);
  const a = (angleDeg * Math.PI) / 180;
  // approach direction points AT the tip; start 300px out along the reverse
  const dx = -Math.cos(a), dy = -Math.sin(a); // e.g. 0ֲ° ג†’ travelling -x (head-on)
  const tip = { x: 128, y: 950 };
  const d = w.spawnDuck('red', tip.x - dx * 300, tip.y - dy * 300);
  w.launch(d.id, dx * speed, dy * speed);
  for (let t = 0; t < 240; t++) {
    w.step(SIM.DT);
    const hit = w.events.find((e) => e.type === 'wallHit' && e.source === 'bumper');
    if (hit && hit.type === 'wallHit') {
      const out = Math.hypot(d.vx, d.vy);
      return { label, inSpeed: hit.speed, outSpeed: out, ratio: out / hit.speed };
    }
    w.events.length = 0;
  }
  return null;
}

describe('bumper retune: mild redirect, not a launcher', () => {
  it('moderates every angle and speed', () => {
    const cases: Array<[number, number, string]> = [
      [0, 2700, 'head-on  fast'],
      [30, 2700, '30ֲ° above fast'],
      [-30, 2700, '30ֲ° below fast'],
      [45, 2700, '45ֲ° above fast'],
      [-45, 2700, '45ֲ° below fast'],
      [60, 2700, '60ֲ° above fast'],
      [0, 600, 'head-on  slow'],
      [30, 600, '30ֲ° above slow'],
      [-45, 600, '45ֲ° below slow'],
      [0, 300, 'head-on  crawl'],
    ];
    const rows: Impact[] = [];
    for (const [ang, sp, label] of cases) {
      const r = shoot(ang, sp, label);
      expect(r, `no bumper hit for ${label}`).not.toBeNull();
      rows.push(r!);
    }
    // eslint-disable-next-line no-console
    console.table(rows.map((r) => ({
      case: r.label,
      in: r.inSpeed.toFixed(0),
      out: r.outSpeed.toFixed(0),
      'out/in': r.ratio.toFixed(2),
    })));

    for (const r of rows) {
      // never a launcher: outgoing never exceeds incoming by more than a nudge,
      // and fast hits leave clearly SLOWER than they arrived
      expect(r.outSpeed).toBeLessThan(Math.max(r.inSpeed * 1.0, 700));
      if (r.inSpeed > 2000) {
        expect(r.ratio).toBeGreaterThan(0.35);
        expect(r.ratio).toBeLessThan(0.95);
      }
      // ...but every hit still visibly reacts
      expect(r.outSpeed).toBeGreaterThan(SIM.STOP_SPEED * 4);
    }
  });
});
