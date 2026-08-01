import { Application, Text } from 'pixi.js';

export const DESIGN_W = 720;
export const DESIGN_H = 1280;

/** CSS letterbox fit. The GL canvas is sized ONCE (iOS WebKit leaks on GL resize);
 *  only its CSS size ever changes. */
function fitCanvas(app: Application): void {
  const scale = Math.min(window.innerWidth / DESIGN_W, window.innerHeight / DESIGN_H);
  app.canvas.style.width = `${DESIGN_W * scale}px`;
  app.canvas.style.height = `${DESIGN_H * scale}px`;
}

async function boot(): Promise<void> {
  const app = new Application();
  await app.init({
    width: DESIGN_W,
    height: DESIGN_H,
    backgroundColor: 0xf8dfe4,
    preference: 'webgl',
    antialias: false, // MSAA alone halves FPS on mid-range Android
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
    roundPixels: true,
  });
  app.ticker.maxFPS = 60; // 120 Hz phones must not run 2× work
  document.getElementById('game')!.appendChild(app.canvas);
  fitCanvas(app);
  window.addEventListener('resize', () => fitCanvas(app));
  window.visualViewport?.addEventListener('resize', () => fitCanvas(app));

  app.stage.addChild(new Text({
    text: 'boot ok',
    style: { fill: 0x2c1e31, fontSize: 48 },
  }));
}

void boot();
