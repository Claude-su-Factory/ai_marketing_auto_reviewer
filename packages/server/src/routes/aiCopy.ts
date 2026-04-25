import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { generateCopy } from "@ad-ai/core/creative/copy.js";
import { requireAnthropicKey } from "@ad-ai/core/config/helpers.js";
import type { Product } from "@ad-ai/core/types.js";
import type { FewShotExample, VariantLabel } from "@ad-ai/core/creative/prompt.js";
import type { BillingService } from "../billing.js";
import { PRICING } from "@ad-ai/core/billing/pricing.js";
import { createStripeClient, triggerAutoRecharge } from "../stripe.js";

export function createAiCopyRouter(billing: BillingService) {
  const router = Router();
  const client = new Anthropic({ apiKey: requireAnthropicKey() });

  router.post("/ai/copy", async (req, res) => {
    const { product, fewShot, variantLabel } = req.body as { product: Product; fewShot?: FewShotExample[]; variantLabel?: VariantLabel };
    const licenseId = (req as any).licenseId;
    const pricing = PRICING.copy_gen;

    if (!billing.checkBalance(licenseId, pricing.charged)) {
      res.status(402).json({ error: "잔액 부족", required: pricing.charged });
      return;
    }

    const eventId = billing.deductAndRecord(licenseId, "copy_gen", pricing.aiCost, pricing.charged);
    try {
      const copy = await generateCopy(client, product, fewShot ?? [], variantLabel ?? "emotional");
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
