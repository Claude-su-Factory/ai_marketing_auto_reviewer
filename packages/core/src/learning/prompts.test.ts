import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { writeFile, mkdir, rm } from "fs/promises";
import path from "path";
import {
  loadPrompts,
  setPromptsForTesting,
  setPromptsPathForTesting,
  invalidatePromptsCache,
  validateUserTemplate,
  substitutePlaceholders,
  DEFAULT_PROMPTS,
  PromptsSchema,
  type Prompts,
} from "./prompts.js";

// 테스트 전용 path — production data/learned/prompts.json 을 절대 건드리지 않도록 격리.
// afterAll 에서 디렉토리 자체를 정리한다.
const TMP_DIR = "data/learned/__test__";
const TMP_FILE = path.join(TMP_DIR, "prompts.json");

async function writeTmpFile(content: string): Promise<void> {
  await mkdir(TMP_DIR, { recursive: true });
  await writeFile(TMP_FILE, content, "utf-8");
}

async function clearTmpFile(): Promise<void> {
  try { await rm(TMP_FILE, { force: true }); } catch {}
}

afterAll(async () => {
  setPromptsPathForTesting(null);
  // Final guarantee — remove the entire test directory
  try { await rm(TMP_DIR, { recursive: true, force: true }); } catch {}
});

describe("loadPrompts", () => {
  beforeEach(async () => {
    setPromptsForTesting(null);
    setPromptsPathForTesting(TMP_FILE);
    await clearTmpFile();
  });
  afterEach(async () => {
    await clearTmpFile();
  });

  it("returns DEFAULT_PROMPTS when file is missing", async () => {
    const result = await loadPrompts();
    expect(result).toEqual(DEFAULT_PROMPTS);
  });

  it("returns parsed value when valid JSON file exists", async () => {
    const custom: Prompts = {
      copy: {
        systemPrompt: "X".repeat(60),
        userTemplate: "{{name}} {{description}} {{angleHint}}".padEnd(120, " "),
        angleHints: {
          emotional: "감정테스트값입니다요",
          numerical: "수치테스트값입니다요",
          urgency: "긴급테스트값입니다요",
        },
      },
    };
    await writeTmpFile(JSON.stringify(custom));
    const result = await loadPrompts();
    expect(result.copy.systemPrompt).toBe(custom.copy.systemPrompt);
    expect(result.copy.angleHints.emotional).toBe("감정테스트값입니다요");
  });

  it("returns DEFAULT_PROMPTS + warns when file is corrupt JSON", async () => {
    const warns: string[] = [];
    const orig = console.warn;
    console.warn = (m: string, ..._rest: unknown[]) => { warns.push(m); };
    try {
      await writeTmpFile("not valid json {{{");
      const result = await loadPrompts();
      expect(result).toEqual(DEFAULT_PROMPTS);
      expect(warns.some((w) => w.includes("JSON parse 실패"))).toBe(true);
    } finally {
      console.warn = orig;
    }
  });

  it("returns DEFAULT_PROMPTS + warns when schema validation fails", async () => {
    const warns: string[] = [];
    const orig = console.warn;
    console.warn = (m: string) => { warns.push(m); };
    try {
      await writeTmpFile(JSON.stringify({ copy: { systemPrompt: "too short", userTemplate: "x", angleHints: { emotional: "x", numerical: "x", urgency: "x" } } }));
      const result = await loadPrompts();
      expect(result).toEqual(DEFAULT_PROMPTS);
      expect(warns.some((w) => w.includes("검증 실패"))).toBe(true);
    } finally {
      console.warn = orig;
    }
  });

  it("caches result — second call does not re-read disk", async () => {
    setPromptsForTesting(DEFAULT_PROMPTS);
    const first = await loadPrompts();
    const second = await loadPrompts();
    expect(first).toBe(second); // 같은 reference
  });
});

describe("setPromptsForTesting", () => {
  beforeEach(() => {
    setPromptsForTesting(null);
    setPromptsPathForTesting(TMP_FILE);
  });

  it("injects custom prompts into the cache", async () => {
    const custom: Prompts = {
      copy: {
        systemPrompt: "Y".repeat(60),
        userTemplate: "{{name}} {{description}} {{angleHint}}".padEnd(120, " "),
        angleHints: { emotional: "e".repeat(15), numerical: "n".repeat(15), urgency: "u".repeat(15) },
      },
    };
    setPromptsForTesting(custom);
    const result = await loadPrompts();
    expect(result.copy.systemPrompt).toBe(custom.copy.systemPrompt);
  });

  it("setPromptsForTesting(null) clears cache so loadPrompts reads disk again", async () => {
    setPromptsForTesting({ copy: { systemPrompt: "A".repeat(60), userTemplate: "{{name}}{{description}}{{angleHint}}".padEnd(120, " "), angleHints: { emotional: "x".repeat(15), numerical: "x".repeat(15), urgency: "x".repeat(15) } } });
    setPromptsForTesting(null);
    const result = await loadPrompts();
    expect(result).toEqual(DEFAULT_PROMPTS);
  });
});

describe("invalidatePromptsCache", () => {
  beforeEach(async () => {
    setPromptsForTesting(null);
    setPromptsPathForTesting(TMP_FILE);
    await clearTmpFile();
  });
  afterEach(async () => {
    await clearTmpFile();
  });

  it("after invalidation, next loadPrompts re-reads disk", async () => {
    await loadPrompts(); // cache = DEFAULT (file missing)
    const custom: Prompts = {
      copy: {
        systemPrompt: "Z".repeat(60),
        userTemplate: "{{name}} {{description}} {{angleHint}}".padEnd(120, " "),
        angleHints: { emotional: "e".repeat(15), numerical: "n".repeat(15), urgency: "u".repeat(15) },
      },
    };
    await writeTmpFile(JSON.stringify(custom));
    invalidatePromptsCache();
    const reloaded = await loadPrompts();
    expect(reloaded.copy.systemPrompt).toBe(custom.copy.systemPrompt);
  });
});

describe("validateUserTemplate", () => {
  it("returns [] when all required placeholders present", () => {
    const t = "Product: {{name}} desc: {{description}} hint: {{angleHint}}";
    expect(validateUserTemplate(t)).toEqual([]);
  });

  it("returns missing placeholders when some are absent", () => {
    const t = "Only: {{name}}";
    const missing = validateUserTemplate(t);
    expect(missing).toContain("{{description}}");
    expect(missing).toContain("{{angleHint}}");
    expect(missing).not.toContain("{{name}}");
  });
});

describe("DEFAULT_PROMPTS personalization + hyperbole guards", () => {
  it("systemPrompt 가 개인화 표현 금지 규칙 포함", () => {
    expect(DEFAULT_PROMPTS.copy.systemPrompt).toMatch(/개인화|당신만을 위한|회원님|~님/);
  });

  it("systemPrompt 가 과장/superlative 금지 규칙 포함", () => {
    expect(DEFAULT_PROMPTS.copy.systemPrompt).toMatch(/100%|1위|최고|유일한|과장|superlative|표시광고법/);
  });
});

describe("substitutePlaceholders", () => {
  it("substitutes a single placeholder", () => {
    expect(substitutePlaceholders("hi {{name}}", { name: "X" })).toBe("hi X");
  });

  it("substitutes the same placeholder appearing multiple times", () => {
    expect(substitutePlaceholders("{{a}}-{{a}}-{{b}}", { a: "1", b: "2" })).toBe("1-1-2");
  });

  it("leaves undefined placeholders intact", () => {
    expect(substitutePlaceholders("{{name}} {{unknown}}", { name: "X" })).toBe("X {{unknown}}");
  });

  it("does not substitute placeholders that appear inside replacement values", () => {
    expect(substitutePlaceholders("{{a}} {{b}}", { a: "{{b}}", b: "X" })).toBe("{{b}} X");
  });
});
