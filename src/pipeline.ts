import "dotenv/config";
import React from "react";
import { render } from "ink";
import type { PipelineStep, StepStatus } from "./tui/PipelineProgress.js";
import { PipelineProgress } from "./tui/PipelineProgress.js";
import { scrapeProduct } from "./scraper/index.js";
import { generateCopy, createAnthropicClient } from "./generator/copy.js";
import { generateImage } from "./generator/image.js";
import { generateVideo } from "./generator/video.js";
import { writeJson } from "../core/storage.js";
import type { Product, Creative } from "../core/types.js";
import { randomUUID } from "crypto";

export async function runPipeline(urls: string[]): Promise<void> {
  const stepStatuses: Record<PipelineStep, StepStatus> = {
    scrape: "pending",
    generate: "pending",
    review: "pending",
    launch: "pending",
  };

  let progressMessage = "";
  let currentCourse = "";
  let courseIndex = 0;

  const { rerender, unmount } = render(
    React.createElement(PipelineProgress, {
      currentStep: "scrape",
      stepStatuses,
      currentCourse,
      courseIndex,
      totalCourses: urls.length,
      progressMessage,
    })
  );

  const update = (step: PipelineStep, status: StepStatus, msg: string, course = currentCourse, idx = courseIndex) => {
    stepStatuses[step] = status;
    progressMessage = msg;
    currentCourse = course;
    courseIndex = idx;
    rerender(
      React.createElement(PipelineProgress, {
        currentStep: step,
        stepStatuses: { ...stepStatuses },
        currentCourse,
        courseIndex,
        totalCourses: urls.length,
        progressMessage,
      })
    );
  };

  const client = createAnthropicClient();

  // Step 1: Scrape
  update("scrape", "running", "스크래핑 시작...");
  const products: Product[] = [];
  for (let i = 0; i < urls.length; i++) {
    update("scrape", "running", `스크래핑 중... ${urls[i].slice(0, 40)}`, urls[i].split("/").pop() ?? "", i + 1);
    const product = await scrapeProduct(urls[i]);
    products.push(product);
  }
  update("scrape", "done", `${products.length}개 제품 스크래핑 완료`);

  // Step 2: Generate
  update("generate", "running", "소재 생성 시작...");
  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    update("generate", "running", `카피 생성 중...`, product.name, i + 1);
    const copy = await generateCopy(client, product);

    update("generate", "running", `이미지 생성 중...`, product.name, i + 1);
    const imageLocalPath = await generateImage(product);

    update("generate", "running", `영상 생성 중... (최대 10분 소요)`, product.name, i + 1);
    const videoLocalPath = await generateVideo(product, (msg) =>
      update("generate", "running", msg, product.name, i + 1)
    );

    const creative: Creative = {
      id: randomUUID(),
      productId: product.id,
      copy,
      imageLocalPath,
      videoLocalPath,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    await writeJson(`data/creatives/${creative.id}.json`, creative);
  }
  update("generate", "done", "소재 생성 완료 — 검토 대기 중");

  unmount();
  console.log("\n소재 생성 완료. 검토를 시작하려면 npm run review 를 실행하세요.");
}
