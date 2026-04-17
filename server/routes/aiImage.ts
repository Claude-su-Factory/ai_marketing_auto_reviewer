import { Router } from "express";
import { GoogleGenAI } from "@google/genai";
import { buildImagePrompt } from "../../src/generator/image.js";
import type { Product } from "../../src/types.js";
import type { BillingService } from "../billing.js";
import { PRICING } from "../pricing.js";
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
      const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY! });
      const prompt = buildImagePrompt(product);

      const response = await ai.models.generateImages({
        model: "imagen-3.0-generate-002",
        prompt,
        config: { numberOfImages: 1, aspectRatio: "1:1", outputMimeType: "image/jpeg" },
      });

      const imageData = response.generatedImages?.[0]?.image?.imageBytes;
      if (!imageData) {
        billing.refund(eventId, licenseId, pricing.charged);
        res.status(500).json({ error: "Imagen 3: 이미지 생성 실패" });
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
