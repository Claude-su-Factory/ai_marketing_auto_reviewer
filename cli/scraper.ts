import { chromium } from "playwright";
import { GoogleGenAI } from "@google/genai";
import type { Product } from "../core/types.js";
import { writeJson } from "../core/storage.js";
import { parseProductWithGemini } from "../core/product/parser.js";

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
