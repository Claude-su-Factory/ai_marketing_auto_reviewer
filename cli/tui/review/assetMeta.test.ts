import { describe, it, expect, vi, beforeEach } from "vitest";
import { getAssetMeta, clearAssetMetaCache } from "./assetMeta.js";

vi.mock("fs/promises", () => ({
  stat: vi.fn(async () => ({ size: 342000 })),
}));
vi.mock("sharp", () => ({
  default: () => ({ metadata: async () => ({ width: 1080, height: 1080, format: "jpeg" }) }),
}));

beforeEach(() => { clearAssetMetaCache(); });

describe("getAssetMeta", () => {
  it("returns width/height/format/size for image", async () => {
    const m = await getAssetMeta("x.jpg");
    expect(m).toEqual({ kind: "image", width: 1080, height: 1080, format: "jpeg", sizeBytes: 342000 });
  });
  it("returns 1080x1920 hardcoded for video", async () => {
    const m = await getAssetMeta("x.mp4");
    expect(m).toEqual({ kind: "video", width: 1080, height: 1920, format: "mp4", sizeBytes: 342000 });
  });
});
