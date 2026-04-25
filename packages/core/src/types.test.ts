import { describe, it, expect, expectTypeOf } from "vitest";
import type { Product, Creative, Campaign, Report, Improvement } from "./types.js";

describe("types", () => {
  it("Product has required fields", () => {
    expectTypeOf<Product>().toMatchTypeOf<{
      id: string;
      name: string;
      targetUrl: string;
      currency: string;
    }>();
  });

  it("Creative productId is string", () => {
    expectTypeOf<Creative["productId"]>().toEqualTypeOf<string>();
  });

  it("Creative status is union type", () => {
    expectTypeOf<Creative["status"]>().toEqualTypeOf<
      "pending" | "approved" | "rejected" | "edited"
    >();
  });

  it("Product inputMethod is union type", () => {
    expectTypeOf<Product["inputMethod"]>().toEqualTypeOf<"scraped" | "manual">();
  });

  it("Improvement has changes array", () => {
    expectTypeOf<Improvement["changes"]>().toEqualTypeOf<
      Array<{ file: string; type: "prompt_update" | "param_update" | "bug_fix"; before: string; after: string }>
    >();
  });
});

// ---- Plan A Task 3 additions ----

describe("Creative (Plan A extensions)", () => {
  it("has variantGroupId, variantLabel, assetLabel fields", () => {
    const c: Creative = {
      id: "c1",
      productId: "p1",
      variantGroupId: "g1",
      copy: {
        headline: "h",
        body: "b",
        cta: "cta",
        hashtags: ["x"],
        variantLabel: "emotional",
        assetLabel: "variant-abc",
      },
      imageLocalPath: "/tmp/i.png",
      videoLocalPath: "/tmp/v.mp4",
      status: "pending",
      createdAt: "2026-04-20T00:00:00.000Z",
    };
    expect(c.variantGroupId).toBe("g1");
    expect(c.copy.variantLabel).toBe("emotional");
    expect(c.copy.assetLabel).toBe("variant-abc");
  });
});

describe("Campaign (Plan A extensions)", () => {
  it("has variantGroupId, platform, externalIds map, orphans", () => {
    const c: Campaign = {
      id: "cam1",
      variantGroupId: "g1",
      productId: "p1",
      platform: "meta",
      externalIds: {
        campaign: "meta-c1",
        adSet: "meta-as1",
        ad: "meta-ad1",
      },
      launchedAt: "2026-04-20T00:00:00.000Z",
      status: "active",
      orphans: [],
    };
    expect(c.platform).toBe("meta");
    expect(c.externalIds.ad).toBe("meta-ad1");
    expect(c.orphans).toEqual([]);
  });

  it("accepts launch_failed and externally_modified statuses", () => {
    const failed: Campaign["status"] = "launch_failed";
    const extMod: Campaign["status"] = "externally_modified";
    expect(failed).toBe("launch_failed");
    expect(extMod).toBe("externally_modified");
  });
});
