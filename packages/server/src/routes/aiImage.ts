import { Router } from "express";
import { GoogleGenAI } from "@google/genai";
import { buildImagePrompt } from "@ad-ai/core/creative/image.js";
import { callGoogleModel } from "@ad-ai/core/creative/geminiRetry.js";
import { requireGoogleAiKey, getGoogleImageModel } from "@ad-ai/core/config/helpers.js";
import type { Product } from "@ad-ai/core/types.js";
import type { BillingService } from "../billing.js";
import { PRICING } from "@ad-ai/core/billing/pricing.js";
import { createStripeClient, triggerAutoRecharge } from "../stripe.js";

export function createAiImageRouter(billing: BillingService) {
  const router = Router();

  router.post("/ai/image", async (req, res) => {
    const { product } = req.body as { product: Product };
    const licenseId = (req as any).licenseId;
    const pricing = PRICING.image_gen;

    if (!billing.checkBalance(licenseId, pricing.charged)) {
      res.status(402).json({ error: "잔액 부족", required: pricing.charged });
      return;
    }

    const eventId = billing.deductAndRecord(licenseId, "image_gen", pricing.aiCost, pricing.charged);
    try {
      const ai = new GoogleGenAI({ apiKey: requireGoogleAiKey() });
      const prompt = buildImagePrompt(product);
      const model = getGoogleImageModel();

      const response = await callGoogleModel(
        () => ai.models.generateImages({
          model,
          prompt,
          config: { numberOfImages: 1, aspectRatio: "1:1", outputMimeType: "image/jpeg" },
        }),
        model,
        "image",
      );

      const imageData = response.generatedImages?.[0]?.image?.imageBytes;
      if (!imageData) {
        billing.refund(eventId, licenseId, pricing.charged);
        res.status(500).json({ error: `Google image (${model}): 이미지 생성 실패` });
        return;
      }

      const imageBase64 = typeof imageData === "string"
        ? imageData
        : Buffer.from(imageData).toString("base64");

      billing.confirmUsage(eventId);

      if (billing.needsRecharge(licenseId)) {
        const license = billing.getLicense(licenseId);
        if (license?.stripe_customer_id && license?.stripe_payment_method_id) {
          const stripe = createStripeClient();
          triggerAutoRecharge(stripe, license.stripe_customer_id, license.stripe_payment_method_id, license.recharge_amount, licenseId).catch(() => {});
        }
      }

      res.json({ imageBase64 });
    } catch (e) {
      billing.refund(eventId, licenseId, pricing.charged);
      res.status(500).json({ error: "AI 처리 실패. 잔액이 환불되었습니다." });
    }
  });

  return router;
}
