import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { generateCopy } from "../../core/creative/copy.js";
import type { Product } from "../../core/types.js";
import type { BillingService } from "../billing.js";
import { PRICING } from "../../core/billing/pricing.js";
import { createStripeClient, triggerAutoRecharge } from "../stripe.js";

export function createAiCopyRouter(billing: BillingService) {
  const router = Router();
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

  router.post("/ai/copy", async (req, res) => {
    const { product } = req.body as { product: Product };
    const licenseId = (req as any).licenseId;
    const pricing = PRICING.copy_gen;

    if (!billing.checkBalance(licenseId, pricing.charged)) {
      res.status(402).json({ error: "잔액 부족", required: pricing.charged });
      return;
    }

    const eventId = billing.deductAndRecord(licenseId, "copy_gen", pricing.aiCost, pricing.charged);
    try {
      const copy = await generateCopy(client, product);
      billing.confirmUsage(eventId);

      if (billing.needsRecharge(licenseId)) {
        const license = billing.getLicense(licenseId);
        if (license?.stripe_customer_id && license?.stripe_payment_method_id) {
          const stripe = createStripeClient();
          triggerAutoRecharge(stripe, license.stripe_customer_id, license.stripe_payment_method_id, license.recharge_amount, licenseId).catch(() => {});
        }
      }

      res.json(copy);
    } catch (e) {
      billing.refund(eventId, licenseId, pricing.charged);
      res.status(500).json({ error: "AI 처리 실패. 잔액이 환불되었습니다." });
    }
  });

  return router;
}
