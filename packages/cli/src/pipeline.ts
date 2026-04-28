import React from "react";
import { render } from "ink";
import { PipelineScreen } from "./tui/screens/PipelineScreen.js";
import { scrapeProduct } from "./scraper.js";
import { generateCopy, createAnthropicClient } from "@ad-ai/core/creative/copy.js";
import { generateImage } from "@ad-ai/core/creative/image.js";
import { writeJson } from "@ad-ai/core/storage.js";
import type { Product, Creative } from "@ad-ai/core/types.js";
import { randomUUID } from "crypto";
import { VARIANT_LABELS, type FewShotExample } from "@ad-ai/core/creative/prompt.js";
import { retrieveFewShotForProduct } from "@ad-ai/core/rag/retriever.js";
import { createVoyageClient } from "@ad-ai/core/rag/voyage.js";
import { createCreativesDb } from "@ad-ai/core/rag/db.js";
import { WinnerStore } from "@ad-ai/core/rag/store.js";

export async function runPipeline(urls: string[]): Promise<void> {
  let currentStage: "scrape" | "generate" = "scrape";
  let progressMessage = "";

  const { rerender, unmount } = render(
    React.createElement(PipelineScreen, {
      currentStage,
      progress: { message: progressMessage },
    })
  );

  const update = (stage: "scrape" | "generate", msg: string) => {
    currentStage = stage;
    progressMessage = msg;
    rerender(
      React.createElement(PipelineScreen, {
        currentStage,
        progress: { message: progressMessage },
      })
    );
  };

  const client = createAnthropicClient();

  // Step 1: Scrape
  update("scrape", "스크래핑 시작...");
  const products: Product[] = [];
  for (let i = 0; i < urls.length; i++) {
    update("scrape", `스크래핑 중... ${urls[i].slice(0, 40)}`);
    const product = await scrapeProduct(urls[i]);
    products.push(product);
  }
  update("scrape", `${products.length}개 제품 스크래핑 완료`);

  // Step 2: Generate
  update("generate", "소재 생성 시작...");

  let creativesDb: ReturnType<typeof createCreativesDb> | null = null;
  try {
    const voyage = createVoyageClient();
    creativesDb = createCreativesDb();
    const winnerStore = new WinnerStore(creativesDb);

    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      update("generate", `이미지 생성 중... ${product.name}`);
      const imageLocalPath = await generateImage(product);

      const variantGroupId = randomUUID();

      const fewShot: FewShotExample[] = await retrieveFewShotForProduct(product, {
        embed: (texts) => voyage.embed(texts),
        loadAllWinners: () => winnerStore.loadAll(),
      });

      for (const label of VARIANT_LABELS) {
        update("generate", `카피 생성 중 (${label})... ${product.name}`);
        const copy = await generateCopy(client, product, fewShot, label);

        const creative: Creative = {
          id: randomUUID(),
          productId: product.id,
          variantGroupId,
          copy: {
            ...copy,
            variantLabel: label,
            assetLabel: `${variantGroupId}::${label}`,
          },
          imageLocalPath,
          status: "pending",
          createdAt: new Date().toISOString(),
        };
        await writeJson(`data/creatives/${creative.id}.json`, creative);
      }
    }
  } finally {
    creativesDb?.close();
  }
  update("generate", "소재 생성 완료 — 검토 대기 중");

  unmount();
  console.log("\n소재 생성 완료. 검토를 시작하려면 npm run review 를 실행하세요.");
}
