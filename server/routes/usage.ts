import { Router } from "express";
import type { AppDb } from "../db.js";
import { PRICING } from "../pricing.js";
import { randomUUID } from "crypto";

export function createUsageRouter(db: AppDb) {
  const router = Router();

  router.post("/usage/report", (req, res) => {
    const { type, metadata } = req.body;
    const licenseId = (req as any).licenseId;

    const pricing = PRICING[type];
    if (!pricing) { res.status(400).json({ error: `Unknown usage type: ${type}` }); return; }

    db.prepare(
      "INSERT INTO usage_events (id, license_id, type, ai_cost_usd, charged_usd, metadata) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(randomUUID(), licenseId, type, pricing.aiCost, pricing.charged, JSON.stringify(metadata ?? {}));

    res.json({ recorded: true });
  });

  router.get("/usage/summary", (req, res) => {
    const licenseId = (req as any).licenseId;
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString();

    const events = db.prepare(
      "SELECT type, COUNT(*) as count, SUM(charged_usd) as total FROM usage_events WHERE license_id = ? AND created_at >= ? GROUP BY type"
    ).all(licenseId, periodStart) as Array<{ type: string; count: number; total: number }>;

    const summary: Record<string, number> = {};
    let totalCharged = 0;
    for (const e of events) {
      summary[e.type] = e.count;
      totalCharged += e.total;
    }

    res.json({
      currentPeriod: { start: periodStart.split("T")[0], end: periodEnd.split("T")[0] },
      events: summary,
      totalCharged: Math.round(totalCharged * 100) / 100,
    });
  });

  return router;
}
