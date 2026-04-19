import { readFile, writeFile, mkdir, readdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

export async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const content = await readFile(filePath, "utf-8");
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

export async function writeJson<T>(filePath: string, data: T): Promise<void> {
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
}

export async function appendJson<T>(filePath: string, item: T): Promise<void> {
  const existing = await readJson<T[]>(filePath);
  const arr = existing ?? [];
  arr.push(item);
  await writeJson(filePath, arr);
}

export async function listJson(dirPath: string): Promise<string[]> {
  try {
    const files = await readdir(dirPath);
    return files
      .filter((f) => f.endsWith(".json"))
      .map((f) => path.join(dirPath, f));
  } catch {
    return [];
  }
}
