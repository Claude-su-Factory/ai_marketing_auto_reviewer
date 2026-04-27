import { chromium } from "playwright";
import { GoogleGenAI } from "@google/genai";
import type { Product } from "@ad-ai/core/types.js";
import { writeJson } from "@ad-ai/core/storage.js";
import { parseProductWithGemini } from "@ad-ai/core/product/parser.js";
import { requireGoogleAiKey } from "@ad-ai/core/config/helpers.js";

export async function scrapeProduct(url: string): Promise<Product> {
  const ai = new GoogleGenAI({ apiKey: requireGoogleAiKey() });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    const html = await page.content();
    const product = await parseProductWithGemini(ai, url, html);
    await writeJson(`data/products/${product.id}.json`, product);
    return product;
  } finally {
    await browser.close();
  }
}
