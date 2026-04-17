import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { generateCopy } from "../../src/generator/copy.js";
import type { Product } from "../../src/types.js";
import type { AppDb } from "../db.js";
import { PRICING } from "../pricing.js";
import { randomUUID } from "crypto";

export function createAiCopyRouter(db: AppDb) {
  const router = Router();
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

  router.post("/ai/copy", async (req, res) => {
    try {
      const { product } = req.body as { product: Product };
      const licenseId = (req as any).licenseId;
      const copy = await generateCopy(client, product);

      const pricing = PRICING.copy_gen;
      db.prepare(
        "INSERT INTO usage_events (id, license_id, type, ai_cost_usd, charged_usd, metadata) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(randomUUID(), licenseId, "copy_gen", pricing.aiCost, pricing.charged, JSON.stringify({ productId: product.id }));

      res.json(copy);
    } catch (e) {
      // 실패해도 AI API 비용은 발생했을 수 있으므로 기록
      try {
        const pricing = PRICING.copy_gen;
        db.prepare(
          "INSERT INTO usage_events (id, license_id, type, ai_cost_usd, charged_usd, metadata) VALUES (?, ?, ?, ?, ?, ?)"
        ).run(randomUUID(), (req as any).licenseId, "copy_gen", pricing.aiCost, 0, JSON.stringify({ error: true }));
      } catch {}
      res.status(500).json({ error: "AI 처리 중 오류가 발생했습니다." });
    }
  });

  return router;
}
