import { describe, it, expect } from "vitest";
import { assembleAssetFeedSpec } from "./assetFeedSpec.js";
import type { Creative, Product } from "../../types.js";

const mockProduct: Product = {
  id: "p1", name: "Test", description: "desc", targetUrl: "https://example.com",
  currency: "KRW", category: "course", tags: ["x"], inputMethod: "manual",
  learningOutcomes: [], differentiators: [],
  createdAt: "2026-04-20T00:00:00.000Z",
};

const mockCreative = (label: "emotional" | "numerical" | "urgency"): Creative => ({
  id: `c-${label}`,
  productId: "p1",
  variantGroupId: "g1",
  copy: {
    headline: "Common Headline",
    body: `Body for ${label}`,
    cta: "LEARN_MORE",
    hashtags: ["ad", "promo"],
    variantLabel: label,
    assetLabel: `variant-${label}-uuid`,
  },
  imageLocalPath: "/tmp/i.png",
  videoLocalPath: "/tmp/v.mp4",
  status: "approved",
  createdAt: "2026-04-20T00:00:00.000Z",
});

describe("assembleAssetFeedSpec", () => {
  it("assembles a spec with 1 title, N bodies, 1 image, 1 video", () => {
    const creatives = [mockCreative("emotional"), mockCreative("numerical")];
    const spec = assembleAssetFeedSpec({
      product: mockProduct,
      creatives,
      imageHash: "IMG_HASH_123",
      videoId: "VID_ID_123",
    });

    expect(spec.titles).toHaveLength(1);
    expect(spec.titles[0].text).toBe("Common Headline");
    expect(spec.bodies).toHaveLength(2);
    expect(spec.images).toEqual([{ hash: "IMG_HASH_123" }]);
    expect(spec.videos).toEqual([{ video_id: "VID_ID_123" }]);
    expect(spec.link_urls).toEqual([{ website_url: "https://example.com" }]);
    expect(spec.call_to_action_types).toEqual(["LEARN_MORE"]);
  });

  it("appends hashtags to each body and attaches adlabels", () => {
    const creatives = [mockCreative("emotional")];
    const spec = assembleAssetFeedSpec({
      product: mockProduct,
      creatives,
      imageHash: "IMG",
      videoId: "VID",
    });

    expect(spec.bodies[0].text).toBe("Body for emotional\n\n#ad #promo");
    expect(spec.bodies[0].adlabels).toEqual([{ name: "variant-emotional-uuid" }]);
  });

  it("rejects empty creatives array", () => {
    expect(() =>
      assembleAssetFeedSpec({
        product: mockProduct,
        creatives: [],
        imageHash: "IMG",
        videoId: "VID",
      }),
    ).toThrow(/at least one creative/i);
  });

  it("throws when two creatives produce identical normalized body text", () => {
    const product: Product = {
      id: "p1",
      name: "Test Product",
      description: "d",
      currency: "KRW",
      targetUrl: "https://example.com",
      tags: [],
      learningOutcomes: [],
      differentiators: [],
      inputMethod: "manual",
      createdAt: "2026-04-20T00:00:00Z",
    };
    const mkCreative = (id: string, body: string, hashtags: string[]): Creative => ({
      id,
      productId: "p1",
      variantGroupId: "g1",
      copy: {
        headline: "h",
        body,
        cta: "SHOP_NOW",
        hashtags,
        variantLabel: "emotional",
        assetLabel: `variant-${id}`,
      },
      imageLocalPath: "/tmp/a.jpg",
      videoLocalPath: "/tmp/a.mp4",
      status: "approved",
      createdAt: "2026-04-20T00:00:00Z",
    });

    // same body and same hashtags → same submitted text → collision
    const creatives = [
      mkCreative("c1", "Same body", ["tag"]),
      mkCreative("c2", "Same body", ["tag"]),
    ];

    expect(() =>
      assembleAssetFeedSpec({ product, creatives, imageHash: "h", videoId: "v" }),
    ).toThrow(/duplicate body text/i);
  });

  it("throws when CRLF/whitespace normalization collapses distinct raw bodies", () => {
    const product: Product = {
      id: "p1",
      name: "Test Product",
      description: "d",
      currency: "KRW",
      targetUrl: "https://example.com",
      tags: [],
      learningOutcomes: [],
      differentiators: [],
      inputMethod: "manual",
      createdAt: "2026-04-20T00:00:00Z",
    };
    const mkCreative = (id: string, body: string): Creative => ({
      id,
      productId: "p1",
      variantGroupId: "g1",
      copy: {
        headline: "h",
        body,
        cta: "SHOP_NOW",
        hashtags: [],
        variantLabel: "emotional",
        assetLabel: `variant-${id}`,
      },
      imageLocalPath: "/tmp/a.jpg",
      videoLocalPath: "/tmp/a.mp4",
      status: "approved",
      createdAt: "2026-04-20T00:00:00Z",
    });

    const creatives = [
      mkCreative("c1", "Body  "),       // trailing whitespace
      mkCreative("c2", "Body"),         // clean
    ];

    expect(() =>
      assembleAssetFeedSpec({ product, creatives, imageHash: "h", videoId: "v" }),
    ).toThrow(/duplicate body text/i);
  });
});
