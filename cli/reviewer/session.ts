import React from "react";
import { render } from "ink";
import type { Creative, Product } from "../../core/types.js";
import { ReviewScreen } from "../tui/ReviewScreen.js";
import { readJson, writeJson, listJson } from "../../core/storage.js";
import { applyReviewDecision } from "../../core/reviewer/decisions.js";

export async function runReviewSession(): Promise<void> {
  const creativePaths = await listJson("data/creatives");
  const items: Array<{ creative: Creative; product: Product }> = [];

  for (const p of creativePaths) {
    const creative = await readJson<Creative>(p);
    if (!creative || creative.status !== "pending") continue;
    const product = await readJson<Product>(`data/products/${creative.productId}.json`);
    if (product) items.push({ creative, product });
  }

  if (items.length === 0) {
    console.log("검토 대기 항목이 없습니다.");
    return;
  }

  await new Promise<void>((resolve) => {
    const { unmount } = render(
      React.createElement(ReviewScreen, {
        creatives: items,
        onApprove: async (id) => {
          const item = items.find((i) => i.creative.id === id);
          if (!item) return;
          const updated = applyReviewDecision(item.creative, { action: "approve" });
          item.creative = updated;  // update in-memory reference
          await writeJson(`data/creatives/${id}.json`, updated);
          if (items.every((i) => i.creative.status !== "pending")) {
            unmount();
            resolve();
          }
        },
        onReject: async (id, note) => {
          const item = items.find((i) => i.creative.id === id);
          if (!item) return;
          const updated = applyReviewDecision(item.creative, { action: "reject", note });
          item.creative = updated;  // update in-memory reference
          await writeJson(`data/creatives/${id}.json`, updated);
        },
        onEdit: async (id, field, value) => {
          const item = items.find((i) => i.creative.id === id);
          if (!item) return;
          const updated = applyReviewDecision(item.creative, {
            action: "edit",
            field,
            value,
          });
          item.creative = updated;  // update in-memory reference
          await writeJson(`data/creatives/${id}.json`, updated);
        },
      })
    );
  });
}
