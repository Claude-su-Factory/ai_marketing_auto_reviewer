import { Router } from "express";
import { GoogleGenAI } from "@google/genai";
import { parseProductWithGemini } from "../../src/scraper/index.js";
import type { AppDb } from "../db.js";
import { PRICING } from "../pricing.js";
import { randomUUID } from "crypto";

export function createAiParseRouter(db: AppDb) {
  const router = Router();

  router.post("/ai/parse", async (req, res) => {
    try {
      const { url, html } = req.body as { url: string; html: string };
      const licenseId = (req as any).licenseId;
      const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY! });
      const product = await parseProductWithGemini(ai, url, html);

      const pricing = PRICING.parse;
      db.prepare(
        "INSERT INTO usage_events (id, license_id, type, ai_cost_usd, charged_usd, metadata) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(randomUUID(), licenseId, "parse", pricing.aiCost, pricing.charged, JSON.stringify({ url }));

      res.json(product);
    } catch (e) {
      // 실패해도 AI API 비용은 발생했을 수 있으므로 기록
      try {
        const pricing = PRICING.parse;
        db.prepare(
          "INSERT INTO usage_events (id, license_id, type, ai_cost_usd, charged_usd, metadata) VALUES (?, ?, ?, ?, ?, ?)"
        ).run(randomUUID(), (req as any).licenseId, "parse", pricing.aiCost, 0, JSON.stringify({ error: true }));
      } catch {}
      res.status(500).json({ error: "AI 처리 중 오류가 발생했습니다." });
    }
  });

  return router;
}
