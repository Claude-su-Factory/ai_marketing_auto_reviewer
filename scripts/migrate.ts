import "dotenv/config";
import { readdir, readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

interface OldCourse {
  id: string; title: string; description: string; thumbnail: string;
  url: string; platform: string; price: number; tags: string[]; scrapedAt: string;
}

async function migrate() {
  const sourceDir = "data/courses";
  const targetDir = "data/products";

  if (!existsSync(sourceDir)) {
    console.log("data/courses/ 없음. 마이그레이션 불필요.");
    return;
  }

  if (!existsSync(targetDir)) {
    await mkdir(targetDir, { recursive: true });
  }

  const files = await readdir(sourceDir);
  const jsonFiles = files.filter((f) => f.endsWith(".json"));
  console.log(`마이그레이션 대상: ${jsonFiles.length}개 파일`);

  for (const file of jsonFiles) {
    const sourcePath = path.join(sourceDir, file);
    const content = await readFile(sourcePath, "utf-8");
    const old: OldCourse = JSON.parse(content);

    const product = {
      id: old.id,
      name: old.title,
      description: old.description,
      imageUrl: old.thumbnail,
      targetUrl: old.url,
      category: old.platform === "other" ? "other" : "course",
      price: old.price,
      currency: "KRW",
      tags: old.tags,
      inputMethod: "scraped",
      createdAt: old.scrapedAt,
    };

    const targetPath = path.join(targetDir, file);
    await writeFile(targetPath, JSON.stringify(product, null, 2), "utf-8");
    console.log(`✓ ${file} → data/products/${file}`);
  }

  console.log(`\n완료: ${jsonFiles.length}개 파일 마이그레이션됨`);
  console.log("data/courses/ 폴더는 수동으로 삭제하세요 (백업 보존).");
}

migrate().catch(console.error);
