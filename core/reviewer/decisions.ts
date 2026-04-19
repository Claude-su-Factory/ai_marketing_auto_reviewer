import type { Creative } from "../types.js";

export type ReviewAction =
  | { action: "approve" }
  | { action: "reject"; note: string }
  | { action: "edit"; field: keyof Creative["copy"]; value: string };

export function applyReviewDecision(
  creative: Creative,
  decision: ReviewAction
): Creative {
  switch (decision.action) {
    case "approve":
      return { ...creative, status: "approved" };
    case "reject":
      return { ...creative, status: "rejected", reviewNote: decision.note };
    case "edit":
      return {
        ...creative,
        status: "edited",
        copy: { ...creative.copy, [decision.field]: decision.value },
      };
  }
}
