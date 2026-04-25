import { describe, it, expect } from "vitest";
import {
  groupCreativesByVariantGroup,
  groupApprovalCheck,
} from "./groupApproval.js";
import type { Creative } from "../types.js";

function mkCreative(
  id: string,
  variantGroupId: string,
  status: Creative["status"],
  variantLabel: Creative["copy"]["variantLabel"] = "emotional",
): Creative {
  return {
    id,
    productId: "prod-1",
    variantGroupId,
    copy: {
      headline: "h",
      body: "b",
      cta: "c",
      hashtags: ["a"],
      variantLabel,
      assetLabel: `variant-${id}`,
    },
    imageLocalPath: "/tmp/i.png",
    videoLocalPath: "/tmp/v.mp4",
    status,
    createdAt: "2026-04-20T00:00:00Z",
  };
}

describe("groupCreativesByVariantGroup", () => {
  it("groups creatives by variantGroupId", () => {
    const creatives = [
      mkCreative("a1", "g1", "approved"),
      mkCreative("a2", "g1", "pending"),
      mkCreative("b1", "g2", "approved"),
    ];
    const groups = groupCreativesByVariantGroup(creatives);
    expect(groups.size).toBe(2);
    expect(groups.get("g1")?.length).toBe(2);
    expect(groups.get("g2")?.length).toBe(1);
  });

  it("returns empty map for empty input", () => {
    expect(groupCreativesByVariantGroup([]).size).toBe(0);
  });

  it("preserves insertion order within each group", () => {
    const creatives = [
      mkCreative("a2", "g1", "pending"),
      mkCreative("a1", "g1", "approved"),
    ];
    const groups = groupCreativesByVariantGroup(creatives);
    expect(groups.get("g1")?.map((c) => c.id)).toEqual(["a2", "a1"]);
  });
});

describe("groupApprovalCheck", () => {
  it("returns {launch: true, approved: [...]} when 2 approved", () => {
    const group = [
      mkCreative("a1", "g1", "approved"),
      mkCreative("a2", "g1", "approved"),
      mkCreative("a3", "g1", "rejected"),
    ];
    const result = groupApprovalCheck(group);
    expect(result.launch).toBe(true);
    expect(result.approved).toHaveLength(2);
  });

  it("returns {launch: true, approved: [...]} when 3 approved", () => {
    const group = [
      mkCreative("a1", "g1", "approved"),
      mkCreative("a2", "g1", "approved"),
      mkCreative("a3", "g1", "approved"),
    ];
    const result = groupApprovalCheck(group);
    expect(result.launch).toBe(true);
    expect(result.approved).toHaveLength(3);
  });

  it("treats 'edited' status as approved", () => {
    const group = [
      mkCreative("a1", "g1", "edited"),
      mkCreative("a2", "g1", "approved"),
    ];
    const result = groupApprovalCheck(group);
    expect(result.launch).toBe(true);
    expect(result.approved).toHaveLength(2);
  });

  it("returns {launch: false, approved: [1]} when only 1 approved", () => {
    const group = [
      mkCreative("a1", "g1", "approved"),
      mkCreative("a2", "g1", "rejected"),
      mkCreative("a3", "g1", "pending"),
    ];
    const result = groupApprovalCheck(group);
    expect(result.launch).toBe(false);
    expect(result.approved).toHaveLength(1);
  });

  it("returns {launch: false, approved: []} when 0 approved", () => {
    const group = [
      mkCreative("a1", "g1", "rejected"),
      mkCreative("a2", "g1", "pending"),
    ];
    const result = groupApprovalCheck(group);
    expect(result.launch).toBe(false);
    expect(result.approved).toHaveLength(0);
  });

  it("does not include rejected/pending creatives in approved list", () => {
    const group = [
      mkCreative("a1", "g1", "approved"),
      mkCreative("a2", "g1", "approved"),
      mkCreative("a3", "g1", "pending"),
    ];
    const result = groupApprovalCheck(group);
    expect(result.approved.map((c) => c.id)).toEqual(["a1", "a2"]);
  });
});
