import { describe, it, expect } from "vitest";
import { buildImagePrompt, saveBase64Image } from "./image.js";
import type { Product } from "../types.js";
import { existsSync, unlinkSync } from "fs";

const mockProduct: Product = {
  id: "test-id", name: "Docker 기초", description: "컨테이너 기술의 기초",
  imageUrl: "", targetUrl: "https://inflearn.com/course/docker",
  category: "course", currency: "KRW", price: 44000, tags: ["docker", "devops"],
  inputMethod: "scraped", createdAt: "2026-04-16T00:00:00.000Z",
};

describe("buildImagePrompt", () => {
  it("generates a descriptive prompt from product data", () => {
    const prompt = buildImagePrompt(mockProduct);
    expect(prompt).toContain("Docker");
    expect(prompt.length).toBeGreaterThan(30);
  });
});

describe("saveBase64Image", () => {
  it("saves base64 image to file and returns path", async () => {
    const fakeBase64 = Buffer.from("fake image data").toString("base64");
    const filePath = await saveBase64Image(fakeBase64, "test-id");
    expect(existsSync(filePath)).toBe(true);
    unlinkSync(filePath);
  });
});
