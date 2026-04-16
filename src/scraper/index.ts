import { chromium } from "playwright";
import { GoogleGenAI } from "@google/genai";
import type { Course } from "../types.js";
import { writeJson } from "../storage.js";
import { randomUUID } from "crypto";

function detectPlatform(url: string): Course["platform"] {
  if (url.includes("inflearn.com")) return "inflearn";
  if (url.includes("class101.net")) return "class101";
  return "other";
}

export async function parseCourseWithGemini(
  ai: GoogleGenAI,
  url: string,
  html: string
): Promise<Course> {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-05-20",
    contents: `다음 HTML에서 온라인 강의 정보를 추출해 JSON으로 반환해주세요.
반드시 아래 형식만 반환하고 다른 텍스트는 포함하지 마세요:
{"title":"","description":"","price":0,"tags":[],"thumbnail":""}

HTML:
${html.slice(0, 8000)}`,
  });

  const raw = response.text ?? "{}";
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(jsonMatch?.[0] ?? "{}");

  return {
    id: randomUUID(),
    title: parsed.title ?? "",
    description: parsed.description ?? "",
    thumbnail: parsed.thumbnail ?? "",
    url,
    platform: detectPlatform(url),
    price: parsed.price ?? 0,
    tags: parsed.tags ?? [],
    scrapedAt: new Date().toISOString(),
  };
}

export async function scrapeCourse(url: string): Promise<Course> {
  const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY! });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    const html = await page.content();
    const course = await parseCourseWithGemini(ai, url, html);
    await writeJson(`data/courses/${course.id}.json`, course);
    return course;
  } finally {
    await browser.close();
  }
}
