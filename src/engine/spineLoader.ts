// Manual Spine loading. Why not Assets.load('x.skel')? In the production build every
// asset is a data: URI, and Pixi's Assets loader sniffs file EXTENSIONS to pick a
// parser — data URIs have none. So: fetch the bytes ourselves, parse with the spine
// runtime directly, and wire the atlas page texture by hand. One code path for dev
// (real URLs) and build (data URIs).
import { Texture } from 'pixi.js';
import {
  AtlasAttachmentLoader,
  SkeletonBinary,
  SkeletonData,
  SkeletonJson,
  Spine,
  SpineTexture,
  TextureAtlas,
} from '@esotericsoftware/spine-pixi-v8';

/** Decode an image URL (path or data URI) into a Pixi texture, reliably. */
async function loadImageTexture(url: string): Promise<Texture> {
  const img = new Image();
  img.src = url;
  await img.decode();
  return Texture.from(img);
}

async function fetchOk(url: string): Promise<Response> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch failed (${res.status}): ${url.slice(0, 120)}`);
  return res;
}

interface SpineSourceBase {
  /** .atlas file CONTENT (import with ?raw) */
  atlasText: string;
  /** the single atlas page image URL */
  pageUrl: string;
  /** skeleton scale applied at parse time */
  scale?: number;
}

/** Exactly one of skelUrl (.skel binary) or jsonUrl (spine .json) must be given. */
export type SpineSource = SpineSourceBase &
  ({ skelUrl: string; jsonUrl?: never } | { jsonUrl: string; skelUrl?: never });

// One SkeletonData per rig, ever. Texture.from() caches by Image element, so an
// uncached second load of the same rig would permanently retain a duplicate atlas
// texture. Caching the PROMISE also makes concurrent first loads safe.
const skeletonCache = new Map<string, Promise<SkeletonData>>();

export function loadSkeleton(src: SpineSource): Promise<SkeletonData> {
  const key = `${src.skelUrl ?? src.jsonUrl}|${src.scale ?? 1}`;
  let cached = skeletonCache.get(key);
  if (!cached) {
    cached = loadSkeletonUncached(src);
    skeletonCache.set(key, cached);
  }
  return cached;
}

async function loadSkeletonUncached(src: SpineSource): Promise<SkeletonData> {
  const pageTexture = await loadImageTexture(src.pageUrl);
  const atlas = new TextureAtlas(src.atlasText);
  if (atlas.pages.length !== 1) {
    // Multi-page atlases are out of scope; widen pageUrl to a name→url map if that changes.
    throw new Error(`expected single-page atlas, got ${atlas.pages.length}`);
  }
  const page = atlas.pages[0]!;
  // The whole PNG→WebP staging strategy rests on "identical dimensions or UVs break".
  // Assert it here so a silently-resized page fails loudly instead of rendering skewed.
  const { pixelWidth, pixelHeight } = pageTexture.source;
  if (page.width !== pixelWidth || page.height !== pixelHeight) {
    throw new Error(
      `atlas page ${page.width}x${page.height} != texture ${pixelWidth}x${pixelHeight} (${src.pageUrl.slice(0, 80)})`,
    );
  }
  page.setTexture(SpineTexture.from(pageTexture.source));

  const loader = new AtlasAttachmentLoader(atlas);
  if (src.skelUrl !== undefined) {
    const parser = new SkeletonBinary(loader);
    parser.scale = src.scale ?? 1;
    const buf = await (await fetchOk(src.skelUrl)).arrayBuffer();
    return parser.readSkeletonData(new Uint8Array(buf));
  }
  const parser = new SkeletonJson(loader);
  parser.scale = src.scale ?? 1;
  return parser.readSkeletonData(await (await fetchOk(src.jsonUrl)).text());
}

/** Create a display object for a parsed skeleton. autoUpdate stays OFF — skeletons
 *  are ticked centrally so hidden/pooled rigs cost zero (perf doctrine). */
export function makeSpine(data: SkeletonData): Spine {
  const spine = new Spine({ skeletonData: data });
  spine.autoUpdate = false;
  return spine;
}

/**
 * A free-list of Spine instances for one rig. Constructing a Spine clones the
 * full bone/slot/attachment tree — measured at 150-360ms for a board's worth on
 * a weak phone, which is exactly the level-load and respawn-batch hitch — so
 * boards acquire prewarmed rigs and give them back instead of destroying them.
 *
 * release() rewinds everything acquire()-side code configures (tracks, pose,
 * timeScale, transform hook, alpha/rotation/visibility) so a reused rig is
 * indistinguishable from a fresh makeSpine() — the add-view methods then apply
 * skin, animations and placement exactly as they always did.
 */
export class SpinePool {
  private readonly free: Spine[] = [];
  /** membership guard: a stale animation closure double-releasing a rig would
   *  otherwise hand the same instance to two boards at once */
  private readonly pooled = new Set<Spine>();

  constructor(private readonly data: SkeletonData) {}

  prewarm(n: number): void {
    while (this.free.length < n) {
      const s = makeSpine(this.data);
      this.free.push(s);
      this.pooled.add(s);
    }
  }

  acquire(): Spine {
    const s = this.free.pop();
    if (s) {
      this.pooled.delete(s);
      return s;
    }
    return makeSpine(this.data);
  }

  release(s: Spine): void {
    if (s.destroyed || this.pooled.has(s)) return;
    s.removeFromParent();
    s.state.clearTracks();
    s.state.timeScale = 1;
    s.skeleton.setToSetupPose();
    s.beforeUpdateWorldTransforms = () => {};
    s.visible = true;
    s.alpha = 1;
    s.rotation = 0;
    this.free.push(s);
    this.pooled.add(s);
  }
}
