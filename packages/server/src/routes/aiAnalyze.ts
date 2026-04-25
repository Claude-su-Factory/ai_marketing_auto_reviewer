import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { computeStats, buildAnalysisPrompt } from "@ad-ai/core/campaign/monitor.js";
import { requireAnthropicKey } from "@ad-ai/core/config/helpers.js";
import type { Report } from "@ad-ai/core/types.js";
import type { BillingService } from "../billing.js";
import { PRICING } from "@ad-ai/core/billing/pricing.js";
import { createStripeClient, triggerAutoRecharge } from "../stripe.js";

export function createAiAnalyzeRouter(billing: BillingService) {
  const router = Router();
  const client = new Anthropic({ apiKey: requireAnthropicKey() });

  router.post("/ai/analyze", async (req, res) => {
    const { reports } = req.body as { reports: Report[] };
    const licenseId = (req as any).licenseId;
    const pricing = PRICING.analyze;

    if (!billing.checkBalance(licenseId, pricing.charged)) {
      res.status(402).json({ error: "잔액 부족", required: pricing.charged });
      return;
    }

    const eventId = billing.deductAndRecord(licenseId, "analyze", pricing.aiCost, pricing.charged);
    try {
      const stats = computeStats(reports);
      const prompt = buildAnalysisPrompt(reports, stats);
      const response = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      });

      const analysis = response.content[0].type === "text" ? response.content[0].text : "";
      billing.confirmUsage(eventId);

      if (billing.needsRecharge(licenseId)) {
        const license = billing.getLicense(licenseId);
        if (license?.stripe_customer_id && license?.stripe_payment_method_id) {
          const stripe = createStripeClient();
          triggerAutoRecharge(stripe, license.stripe_customer_id, license.stripe_payment_method_id, license.recharge_amount, licenseId).catch(() => {});
        }
      }

      res.json({ analysis });
    } catch (e) {
      billing.refund(eventId, licenseId, pricing.charged);
      res.status(500).json({ error: "AI 처리 실패. 잔액이 환불되었습니다." });
    }
  });

  return router;
}
