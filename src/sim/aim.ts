import { SIM } from './config';
import { predictShot, type AimPreview } from './trajectory';
import type { World } from './world';
import type { Duck } from './types';

/**
 * Pull-back slingshot: begin() on/near a duck, move() drags the pointer away,
 * end() fires opposite the pull at a fixed speed; the drag sets direction only.
 * Aim assist bends the launch direction toward the best target (same-colour
 * duck or any barrel) within the assist cone.
 */
export class Slingshot {
  /** 0..1 — director raises this over the level */
  assist = 0.35;
  private duck: Duck | null = null;
  /** pointer-down position — the pull is anchored here, not at the duck centre,
   *  so an off-centre grab followed by an immediate release is a whiff */
  private gx = 0;
  private gy = 0;
  private px = 0;
  private py = 0;

  constructor(private world: World) {}

  get aiming(): boolean {
    return this.duck !== null;
  }

  /** Current pull vector for the view (aim UI). Null when not aiming. */
  get pull(): { duck: Duck; dx: number; dy: number; len: number } | null {
    if (!this.duck) return null;
    const dx = this.gx - this.px;
    const dy = this.gy - this.py;
    return { duck: this.duck, dx, dy, len: Math.hypot(dx, dy) };
  }

  begin(x: number, y: number): boolean {
    let best: Duck | null = null;
    let bestD: number = SIM.GRAB_R;
    for (const d of this.world.ducks) {
      // a matched duck is on its fuse: still a solid, still a target, not a shot
      if (d.live || d.popping || d.matched) continue;
      const dist = Math.hypot(d.x - x, d.y - y);
      if (dist < bestD) {
        bestD = dist;
        best = d;
      }
    }
    if (!best) return false;
    this.duck = best;
    this.gx = x;
    this.gy = y;
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

  /**
   * Post-assist unit launch direction for the current pull, or null when the
   * pull is too short to aim or fire. One code path for both end() and preview().
   */
  private aimDir(): { x: number; y: number } | null {
    const p = this.pull;
    if (!p || p.len < SIM.MIN_PULL) return null;
    const bent = this.applyAssist(p.duck, p.dx / p.len, p.dy / p.len);
    return { x: bent.dx, y: bent.dy };
  }

  /** Projected shot for the aim UI. Null when not aiming (or under MIN_PULL). */
  preview(): AimPreview | null {
    const duck = this.duck;
    if (!duck) return null;
    const dir = this.aimDir();
    if (!dir) return null;
    return predictShot(this.world, duck, dir);
  }

  /** Returns true when a real shot was fired (false = whiff, costs nothing). */
  end(): boolean {
    const duck = this.duck;
    const dir = this.aimDir();
    this.duck = null;
    if (!duck || !dir) return false;
    this.world.launch(duck.id, dir.x * SIM.LAUNCH_SPEED, dir.y * SIM.LAUNCH_SPEED);
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
