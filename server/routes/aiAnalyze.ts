import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { computeStats, buildAnalysisPrompt } from "../../src/monitor/index.js";
import type { Report } from "../../src/types.js";
import type { AppDb } from "../db.js";
import { PRICING } from "../pricing.js";
import { randomUUID } from "crypto";

export function createAiAnalyzeRouter(db: AppDb) {
  const router = Router();
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

  router.post("/ai/analyze", async (req, res) => {
    try {
      const { reports } = req.body as { reports: Report[] };
      const licenseId = (req as any).licenseId;

      const stats = computeStats(reports);
      const prompt = buildAnalysisPrompt(reports, stats);
      const response = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      });

      const analysis = response.content[0].type === "text" ? response.content[0].text : "";

      const pricing = PRICING.analyze;
      db.prepare(
        "INSERT INTO usage_events (id, license_id, type, ai_cost_usd, charged_usd, metadata) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(randomUUID(), licenseId, "analyze", pricing.aiCost, pricing.charged, JSON.stringify({ reportCount: reports.length }));

      res.json({ analysis });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  return router;
}
