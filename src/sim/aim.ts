import { SIM } from './config';
import type { World } from './world';
import type { Duck } from './types';

/**
 * Pull-back slingshot: begin() on/near a duck, move() drags the pointer away,
 * end() fires opposite the pull. Aim assist bends the launch direction toward
 * the best target (same-colour duck or any barrel) within the assist cone.
 */
export class Slingshot {
  /** 0..1 — director raises this over the level */
  assist = 0.35;
  private duck: Duck | null = null;
  private px = 0;
  private py = 0;

  constructor(private world: World) {}

  get aiming(): boolean {
    return this.duck !== null;
  }

  /** Current pull vector for the view (aim UI). Null when not aiming. */
  get pull(): { duck: Duck; dx: number; dy: number; len: number } | null {
    if (!this.duck) return null;
    const dx = this.duck.x - this.px;
    const dy = this.duck.y - this.py;
    return { duck: this.duck, dx, dy, len: Math.hypot(dx, dy) };
  }

  begin(x: number, y: number): boolean {
    let best: Duck | null = null;
    let bestD: number = SIM.GRAB_R;
    for (const d of this.world.ducks) {
      if (d.live || d.popping) continue;
      const dist = Math.hypot(d.x - x, d.y - y);
      if (dist < bestD) {
        bestD = dist;
        best = d;
      }
    }
    if (!best) return false;
    this.duck = best;
    this.px = x;
    this.py = y;
    return true;
  }

  move(x: number, y: number): void {
    if (!this.duck) return;
    this.px = x;
    this.py = y;
  }

  cancel(): void {
    this.duck = null;
  }

  /** Returns true when a real shot was fired (false = whiff, costs nothing). */
  end(): boolean {
    const p = this.pull;
    this.duck = null;
    if (!p || p.len < SIM.MIN_PULL) return false;
    const len = Math.min(p.len, SIM.MAX_PULL);
    let dx = p.dx / p.len;
    let dy = p.dy / p.len;
    const bent = this.applyAssist(p.duck, dx, dy);
    dx = bent.dx;
    dy = bent.dy;
    this.world.launch(p.duck.id, dx * len * SIM.LAUNCH_K, dy * len * SIM.LAUNCH_K);
    return true;
  }

  private applyAssist(duck: Duck, dx: number, dy: number): { dx: number; dy: number } {
    if (this.assist <= 0) return { dx, dy };
    const cone = (SIM.ASSIST_CONE_DEG * Math.PI) / 180;
    let bestAngle = cone;
    let bestDir: { dx: number; dy: number } | null = null;
    const consider = (tx: number, ty: number): void => {
      const vx = tx - duck.x, vy = ty - duck.y;
      const len = Math.hypot(vx, vy) || 1;
      const ux = vx / len, uy = vy / len;
      const ang = Math.acos(Math.max(-1, Math.min(1, ux * dx + uy * dy)));
      if (ang < bestAngle) {
        bestAngle = ang;
        bestDir = { dx: ux, dy: uy };
      }
    };
    for (const d of this.world.ducks) {
      if (d.id !== duck.id && d.colour === duck.colour && !d.popping) consider(d.x, d.y);
    }
    for (const b of this.world.barrels) consider(b.x, b.y);
    if (!bestDir) return { dx, dy };
    const t = this.assist;
    const bd = bestDir as { dx: number; dy: number };
    const mx = dx * (1 - t) + bd.dx * t;
    const my = dy * (1 - t) + bd.dy * t;
    const len = Math.hypot(mx, my) || 1;
    return { dx: mx / len, dy: my / len };
  }
}
