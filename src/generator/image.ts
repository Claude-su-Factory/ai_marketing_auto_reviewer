import { GoogleGenAI } from "@google/genai";
import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import type { Course } from "../types.js";

export function buildImagePrompt(course: Course): string {
  return `Instagram advertisement image for an online course.
Course: "${course.title}"
Topic: ${course.tags.slice(0, 3).join(", ")}
Style: Modern, professional, tech-focused. Clean background, bold typography area.
Format: Square 1:1, suitable for Instagram feed ad.
No text overlay needed. Visually represent the learning outcome.`;
}

export async function saveBase64Image(
  base64Data: string,
  courseId: string
): Promise<string> {
  const dir = "data/creatives";
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${courseId}-image.jpg`);
  await writeFile(filePath, Buffer.from(base64Data, "base64"));
  return filePath;
}

export async function generateImage(course: Course): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY! });
  const prompt = buildImagePrompt(course);

  const response = await ai.models.generateImages({
    model: "imagen-3.0-generate-002",
    prompt,
    config: {
      numberOfImages: 1,
      aspectRatio: "1:1",
      outputMimeType: "image/jpeg",
    },
  });

  const imageData = response.generatedImages?.[0]?.image?.imageBytes;
  if (!imageData) throw new Error("Imagen 3: 이미지 생성 실패");

  return saveBase64Image(
    typeof imageData === "string" ? imageData : Buffer.from(imageData).toString("base64"),
    course.id
  );
}
