import type { Creative } from "../types.js";

export interface ApprovalResult {
  launch: boolean;
  approved: Creative[];
}

export function groupCreativesByVariantGroup(
  creatives: Creative[],
): Map<string, Creative[]> {
  const groups = new Map<string, Creative[]>();
  for (const c of creatives) {
    const bucket = groups.get(c.variantGroupId);
    if (bucket) {
      bucket.push(c);
    } else {
      groups.set(c.variantGroupId, [c]);
    }
  }
  return groups;
}

export function groupApprovalCheck(group: Creative[]): ApprovalResult {
  const approved = group.filter(
    (c) => c.status === "approved" || c.status === "edited",
  );
  return { launch: approved.length >= 2, approved };
}
