import { describe, it, expectTypeOf } from "vitest";
import type { Course, Creative, Campaign, Report, Improvement } from "./types.js";

describe("types", () => {
  it("Course has required fields", () => {
    expectTypeOf<Course>().toMatchTypeOf<{
      id: string;
      title: string;
      url: string;
      platform: string;
    }>();
  });

  it("Creative status is union type", () => {
    expectTypeOf<Creative["status"]>().toEqualTypeOf<
      "pending" | "approved" | "rejected" | "edited"
    >();
  });

  it("Improvement has changes array", () => {
    expectTypeOf<Improvement["changes"]>().toEqualTypeOf<
      Array<{ file: string; type: string; before: string; after: string }>
    >();
  });
});
