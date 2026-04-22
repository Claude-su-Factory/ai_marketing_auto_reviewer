import { stat } from "fs/promises";
import sharp from "sharp";

export interface AssetMeta {
  kind: "image" | "video";
  width?: number;
  height?: number;
  format: string;
  sizeBytes: number;
}

const cache = new Map<string, AssetMeta>();

export async function getAssetMeta(path: string): Promise<AssetMeta> {
  const hit = cache.get(path);
  if (hit) return hit;
  const s = await stat(path);
  let meta: AssetMeta;
  if (path.endsWith(".mp4")) {
    meta = { kind: "video", format: "mp4", sizeBytes: s.size };
  } else {
    const m = await sharp(path).metadata();
    meta = {
      kind: "image",
      width: m.width ?? 0,
      height: m.height ?? 0,
      format: m.format ?? "unknown",
      sizeBytes: s.size,
    };
  }
  cache.set(path, meta);
  return meta;
}

export function clearAssetMetaCache() {
  cache.clear();
}
