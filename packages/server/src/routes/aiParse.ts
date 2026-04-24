import { Router } from "express";
import { GoogleGenAI } from "@google/genai";
import { parseProductWithGemini } from "@ad-ai/core/product/parser.js";
import type { BillingService } from "../billing.js";
import { PRICING } from "@ad-ai/core/billing/pricing.js";
import { createStripeClient, triggerAutoRecharge } from "../stripe.js";

export function createAiParseRouter(billing: BillingService) {
  const router = Router();

  router.post("/ai/parse", async (req, res) => {
    const { url, html } = req.body as { url: string; html: string };
    const licenseId = (req as any).licenseId;
    const pricing = PRICING.parse;

    if (!billing.checkBalance(licenseId, pricing.charged)) {
      res.status(402).json({ error: "잔액 부족", required: pricing.charged });
      return;
    }

    const eventId = billing.deductAndRecord(licenseId, "parse", pricing.aiCost, pricing.charged);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY! });
      const product = await parseProductWithGemini(ai, url, html);
      billing.confirmUsage(eventId);

      if (billing.needsRecharge(licenseId)) {
        const license = billing.getLicense(licenseId);
        if (license?.stripe_customer_id && license?.stripe_payment_method_id) {
          const stripe = createStripeClient();
          triggerAutoRecharge(stripe, license.stripe_customer_id, license.stripe_payment_method_id, license.recharge_amount, licenseId).catch(() => {});
        }
      }

      res.json(product);
    } catch (e) {
      billing.refund(eventId, licenseId, pricing.charged);
      res.status(500).json({ error: "AI 처리 실패. 잔액이 환불되었습니다." });
    }
  });

  return router;
}
