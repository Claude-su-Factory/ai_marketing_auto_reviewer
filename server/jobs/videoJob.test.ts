import { describe, it, expect } from "vitest";
import { getJob } from "./videoJob.js";

describe("videoJob", () => {
  it("getJob returns undefined for non-existent job", () => {
    expect(getJob("non-existent-id")).toBeUndefined();
  });
});
