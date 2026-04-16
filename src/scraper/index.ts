import { chromium } from "playwright";
import { GoogleGenAI } from "@google/genai";
import type { Product } from "../types.js";
import { writeJson } from "../storage.js";
import { randomUUID } from "crypto";

export function detectCategory(url: string): string {
  if (url.includes("inflearn.com")) return "course";
  if (url.includes("class101.net")) return "course";
  return "other";
}

export async function parseProductWithGemini(
  ai: GoogleGenAI,
  url: string,
  html: string
): Promise<Product> {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-05-20",
    contents: `다음 HTML에서 제품/서비스 정보를 추출해 JSON으로 반환해주세요.
반드시 아래 형식만 반환하고 다른 텍스트는 포함하지 마세요:
{"name":"","description":"","price":0,"tags":[],"imageUrl":""}

HTML:
${html.slice(0, 8000)}`,
  });

  const raw = response.text ?? "{}";
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(jsonMatch?.[0] ?? "{}");

  return {
    id: randomUUID(),
    name: parsed.name ?? "",
    description: parsed.description ?? "",
    imageUrl: parsed.imageUrl ?? "",
    targetUrl: url,
    category: detectCategory(url),
    price: parsed.price ?? 0,
    currency: "KRW",
    tags: parsed.tags ?? [],
    inputMethod: "scraped",
    createdAt: new Date().toISOString(),
  };
}

export async function scrapeProduct(url: string): Promise<Product> {
  const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY! });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    const html = await page.content();
    const product = await parseProductWithGemini(ai, url, html);
    await writeJson(`data/products/${product.id}.json`, product);
    return product;
  } finally {
    await browser.close();
  }
}
