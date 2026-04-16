import { describe, it, expectTypeOf } from "vitest";
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
