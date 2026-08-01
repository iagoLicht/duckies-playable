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

export interface SpineSource {
  /** .skel binary URL — provide this OR jsonUrl */
  skelUrl?: string;
  /** spine .json URL (barrel, tutorial-hand) */
  jsonUrl?: string;
  /** .atlas file CONTENT (import with ?raw) */
  atlasText: string;
  /** the single atlas page image URL */
  pageUrl: string;
  /** skeleton scale applied at parse time */
  scale?: number;
}

export async function loadSkeleton(src: SpineSource): Promise<SkeletonData> {
  const pageTexture = await loadImageTexture(src.pageUrl);
  const atlas = new TextureAtlas(src.atlasText);
  if (atlas.pages.length !== 1) {
    throw new Error(`expected single-page atlas, got ${atlas.pages.length}`);
  }
  atlas.pages[0]!.setTexture(SpineTexture.from(pageTexture.source));

  const loader = new AtlasAttachmentLoader(atlas);
  if (src.skelUrl) {
    const parser = new SkeletonBinary(loader);
    parser.scale = src.scale ?? 1;
    const buf = await (await fetch(src.skelUrl)).arrayBuffer();
    return parser.readSkeletonData(new Uint8Array(buf));
  }
  const parser = new SkeletonJson(loader);
  parser.scale = src.scale ?? 1;
  return parser.readSkeletonData(await (await fetch(src.jsonUrl!)).text());
}

/** Create a display object for a parsed skeleton. autoUpdate stays OFF — skeletons
 *  are ticked centrally so hidden/pooled rigs cost zero (perf doctrine). */
export function makeSpine(data: SkeletonData): Spine {
  const spine = new Spine({ skeletonData: data });
  spine.autoUpdate = false;
  return spine;
}
