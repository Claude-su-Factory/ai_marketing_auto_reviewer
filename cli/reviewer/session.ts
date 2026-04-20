import React from "react";
import { render } from "ink";
import type { Creative, Product } from "../../core/types.js";
import { ReviewScreen, type ReviewGroup } from "../tui/ReviewScreen.js";
import { readJson, writeJson, listJson } from "../../core/storage.js";
import { applyReviewDecision } from "../../core/reviewer/decisions.js";
import { groupCreativesByVariantGroup } from "../../core/launch/groupApproval.js";

export async function runReviewSession(): Promise<void> {
  const creativePaths = await listJson("data/creatives");
  const allCreatives: Creative[] = [];
  for (const p of creativePaths) {
    const c = await readJson<Creative>(p);
    if (c) allCreatives.push(c);
  }

  const grouped = groupCreativesByVariantGroup(allCreatives);
  const pendingGroups: ReviewGroup[] = [];

  for (const [variantGroupId, members] of grouped.entries()) {
    const hasPending = members.some((c) => c.status === "pending");
    if (!hasPending) continue;
    const product = await readJson<Product>(`data/products/${members[0].productId}.json`);
    if (!product) continue;
    pendingGroups.push({ variantGroupId, product, creatives: members });
  }

  if (pendingGroups.length === 0) {
    console.log("검토 대기 항목이 없습니다.");
    return;
  }

  await new Promise<void>((resolve) => {
    const { unmount } = render(
      React.createElement(ReviewScreen, {
        groups: pendingGroups,
        onApprove: async (variantGroupId, creativeId) => {
          const group = pendingGroups.find((g) => g.variantGroupId === variantGroupId);
          if (!group) return;
          const idx = group.creatives.findIndex((c) => c.id === creativeId);
          if (idx < 0) return;
          const updated = applyReviewDecision(group.creatives[idx], { action: "approve" });
          group.creatives[idx] = updated;
          await writeJson(`data/creatives/${creativeId}.json`, updated);
          if (pendingGroups.every((g) => g.creatives.every((c) => c.status !== "pending"))) {
            unmount();
            resolve();
          }
        },
        onReject: async (variantGroupId, creativeId, note) => {
          const group = pendingGroups.find((g) => g.variantGroupId === variantGroupId);
          if (!group) return;
          const idx = group.creatives.findIndex((c) => c.id === creativeId);
          if (idx < 0) return;
          const updated = applyReviewDecision(group.creatives[idx], { action: "reject", note });
          group.creatives[idx] = updated;
          await writeJson(`data/creatives/${creativeId}.json`, updated);
        },
        onEdit: async (variantGroupId, creativeId, field, value) => {
          const group = pendingGroups.find((g) => g.variantGroupId === variantGroupId);
          if (!group) return;
          const idx = group.creatives.findIndex((c) => c.id === creativeId);
          if (idx < 0) return;
          const updated = applyReviewDecision(group.creatives[idx], {
            action: "edit",
            field,
            value,
          });
          group.creatives[idx] = updated;
          await writeJson(`data/creatives/${creativeId}.json`, updated);
        },
      })
    );
  });
}
