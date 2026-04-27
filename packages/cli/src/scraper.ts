import { chromium } from "playwright";
import type { Product } from "@ad-ai/core/types.js";
import { writeJson } from "@ad-ai/core/storage.js";
import { parseProductWithClaude } from "@ad-ai/core/product/parser.js";
import { createAnthropicClient } from "@ad-ai/core/creative/copy.js";

export async function scrapeProduct(url: string): Promise<Product> {
  const client = createAnthropicClient();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    const html = await page.content();
    const product = await parseProductWithClaude(client, url, html);
    await writeJson(`data/products/${product.id}.json`, product);
    return product;
  } finally {
    await browser.close();
  }
}
