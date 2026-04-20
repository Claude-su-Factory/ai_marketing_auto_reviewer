import { describe, it, expect, vi } from "vitest";
import { executeRollback } from "./rollback.js";

describe("executeRollback", () => {
  it("deletes in reverse order and returns all deleted on success", async () => {
    const calls: string[] = [];
    const deleter = vi.fn(async (type: string, id: string) => {
      calls.push(`${type}:${id}`);
    });

    const result = await executeRollback({
      created: [
        { type: "campaign", id: "c1" },
        { type: "adset", id: "as1" },
        { type: "ad", id: "ad1" },
      ],
      deleter,
    });

    expect(calls).toEqual(["ad:ad1", "adset:as1", "campaign:c1"]);
    expect(result.deleted).toEqual(["ad1", "as1", "c1"]);
    expect(result.orphans).toEqual([]);
  });

  it("collects orphans when a delete throws and continues", async () => {
    const deleter = vi.fn(async (type: string, id: string) => {
      if (type === "adset") throw new Error("meta API failed");
    });

    const result = await executeRollback({
      created: [
        { type: "campaign", id: "c1" },
        { type: "adset", id: "as1" },
        { type: "ad", id: "ad1" },
      ],
      deleter,
    });

    expect(result.deleted).toEqual(["ad1", "c1"]);
    expect(result.orphans).toEqual([{ type: "adset", id: "as1" }]);
  });

  it("handles empty created list", async () => {
    const deleter = vi.fn();
    const result = await executeRollback({ created: [], deleter });
    expect(result.deleted).toEqual([]);
    expect(result.orphans).toEqual([]);
    expect(deleter).not.toHaveBeenCalled();
  });
});
