import { Router } from "express";
import { GoogleGenAI } from "@google/genai";
import { buildImagePrompt } from "../../src/generator/image.js";
import type { Product } from "../../src/types.js";
import type { AppDb } from "../db.js";
import { PRICING } from "../pricing.js";
import { randomUUID } from "crypto";

export function createAiImageRouter(db: AppDb) {
  const router = Router();

  router.post("/ai/image", async (req, res) => {
    try {
      const { product } = req.body as { product: Product };
      const licenseId = (req as any).licenseId;
      const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY! });
      const prompt = buildImagePrompt(product);

      const response = await ai.models.generateImages({
        model: "imagen-3.0-generate-002",
        prompt,
        config: { numberOfImages: 1, aspectRatio: "1:1", outputMimeType: "image/jpeg" },
      });

      const imageData = response.generatedImages?.[0]?.image?.imageBytes;
      if (!imageData) { res.status(500).json({ error: "Imagen 3: 이미지 생성 실패" }); return; }

      const imageBase64 = typeof imageData === "string"
        ? imageData
        : Buffer.from(imageData).toString("base64");

      const pricing = PRICING.image_gen;
      db.prepare(
        "INSERT INTO usage_events (id, license_id, type, ai_cost_usd, charged_usd, metadata) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(randomUUID(), licenseId, "image_gen", pricing.aiCost, pricing.charged, JSON.stringify({ productId: product.id }));

      res.json({ imageBase64 });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  return router;
}
