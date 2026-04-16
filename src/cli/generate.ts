import "dotenv/config";
import { generateCopy, createAnthropicClient } from "../generator/copy.js";
import { generateImage } from "../generator/image.js";
import { generateVideo } from "../generator/video.js";
import { readJson, writeJson } from "../storage.js";
import type { Course, Creative } from "../types.js";
import { randomUUID } from "crypto";

const courseId = process.argv[2];
if (!courseId) { console.error("Usage: npm run generate <courseId>"); process.exit(1); }

const course = await readJson<Course>(`data/courses/${courseId}.json`);
if (!course) { console.error("강의를 찾을 수 없습니다:", courseId); process.exit(1); }

const client = createAnthropicClient();
console.log("카피 생성 중...");
const copy = await generateCopy(client, course);
console.log("이미지 생성 중...");
const imageLocalPath = await generateImage(course);
console.log("영상 생성 중... (최대 10분 소요)");
const videoLocalPath = await generateVideo(course, console.log);

const creative: Creative = {
  id: randomUUID(), courseId: course.id, copy,
  imageLocalPath, videoLocalPath, status: "pending",
  createdAt: new Date().toISOString(),
};
await writeJson(`data/creatives/${creative.id}.json`, creative);
console.log("완료:", creative.id);
