import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readJson, writeJson, appendJson, listJson } from "./storage.js";
import { rmSync, existsSync } from "fs";
import path from "path";

const TEST_DIR = "data/test-storage";

beforeEach(() => {});
afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

describe("storage", () => {
  it("writeJson creates file and readJson retrieves it", async () => {
    const data = { id: "1", name: "test" };
    await writeJson(path.join(TEST_DIR, "item.json"), data);
    const result = await readJson<typeof data>(path.join(TEST_DIR, "item.json"));
    expect(result).toEqual(data);
  });

  it("appendJson adds item to array file", async () => {
    await appendJson(path.join(TEST_DIR, "items.json"), { id: "1" });
    await appendJson(path.join(TEST_DIR, "items.json"), { id: "2" });
    const result = await readJson<Array<{ id: string }>>(path.join(TEST_DIR, "items.json"));
    expect(result).not.toBeNull();
    expect(result).toHaveLength(2);
    expect(result![1].id).toBe("2");
  });

  it("listJson returns all JSON files in directory", async () => {
    await writeJson(path.join(TEST_DIR, "a.json"), { id: "a" });
    await writeJson(path.join(TEST_DIR, "b.json"), { id: "b" });
    const files = await listJson(TEST_DIR);
    expect(files).toHaveLength(2);
  });

  it("readJson returns null for non-existent file", async () => {
    const result = await readJson(path.join(TEST_DIR, "missing.json"));
    expect(result).toBeNull();
  });

  it("listJson returns only .json files, not other file types", async () => {
    const { writeFile } = await import("fs/promises");
    await writeJson(path.join(TEST_DIR, "valid.json"), { id: "valid" });
    await writeFile(path.join(TEST_DIR, "ignore.txt"), "text file");
    const files = await listJson(TEST_DIR);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain("valid.json");
  });
});
