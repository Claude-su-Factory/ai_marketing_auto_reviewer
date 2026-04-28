import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { rm, readFile } from "fs/promises";
import path from "path";
import { runImprovementCycle } from "./runner.js";
import {
  setPromptsForTesting,
  setPromptsPathForTesting,
  loadPrompts,
  type Prompts,
} from "../learning/prompts.js";
import type { AnalysisResult } from "./index.js";
import type { Report } from "../types.js";

// 테스트 전용 path — production data/learned/prompts.json 와 data/improvements/ 를
// 절대 건드리지 않도록 격리. afterAll 에서 디렉토리 자체를 정리한다.
const PROMPTS_DIR = "data/learned/__test__";
const PROMPTS_PATH = path.join(PROMPTS_DIR, "prompts.json");
const IMPROVEMENTS_DIR = "data/improvements/__test__";

async function clearAll(): Promise<void> {
  try { await rm(PROMPTS_PATH, { force: true }); } catch {}
  try { await rm(IMPROVEMENTS_DIR, { recursive: true, force: true }); } catch {}
}

const mkWeak = (id: string, ctr: number): Report => ({
  id, campaignId: id, productId: "p1", date: "2026-04-25",
  impressions: 1000, clicks: 8, ctr,
  spend: 10000, cpc: 1250, reach: 800, frequency: 1.25,
});

let mockClaudeResponse: string;

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: vi.fn().mockImplementation(async () => ({
        content: [{ type: "text", text: mockClaudeResponse }],
      })),
    };
  },
}));

beforeEach(async () => {
  setPromptsForTesting(null);
  setPromptsPathForTesting(PROMPTS_PATH);
  await clearAll();
  mockClaudeResponse = "{}";
});

afterAll(async () => {
  setPromptsPathForTesting(null);
  // cleanup test dirs (afterAll 한 번만 실행)
  try { await rm(PROMPTS_DIR, { recursive: true, force: true }); } catch {}
  try { await rm(IMPROVEMENTS_DIR, { recursive: true, force: true }); } catch {}
});

describe("runImprovementCycle", () => {
  it("returns immediately when weakReports is empty", async () => {
    const analysis: AnalysisResult = { improvements: [{ campaignId: "c1", issue: "x", suggestion: "y", promptKey: "copy.systemPrompt" }] };
    await runImprovementCycle([], analysis, { promptsPath: PROMPTS_PATH, improvementsDir: IMPROVEMENTS_DIR });
    // No file written
    await expect(readFile(PROMPTS_PATH, "utf-8")).rejects.toThrow();
  });

  it("returns when all improvements have disallowed promptKey", async () => {
    const analysis: AnalysisResult = {
      improvements: [
        { campaignId: "c1", issue: "x", suggestion: "y", promptKey: "analysis.template" as any },
        { campaignId: "c2", issue: "x", suggestion: "y", promptKey: "unknown.key" as any },
      ],
    };
    await runImprovementCycle([mkWeak("c1", 0.5)], analysis, { promptsPath: PROMPTS_PATH, improvementsDir: IMPROVEMENTS_DIR });
    await expect(readFile(PROMPTS_PATH, "utf-8")).rejects.toThrow();
  });

  it("caps proposals at MAX_PROPOSALS_PER_CYCLE=5", async () => {
    mockClaudeResponse = JSON.stringify({
      promptKey: "copy.angleHints.emotional",
      newValue: "새로운 감정 호소 가이드 — 충분한 길이",
      reason: "테스트",
    });
    const proposals = Array.from({ length: 6 }, (_, i) => ({
      campaignId: `c${i}`,
      issue: `issue ${i}`,
      suggestion: `suggestion ${i}`,
      promptKey: "copy.angleHints.emotional" as const,
    }));
    const analysis: AnalysisResult = { improvements: proposals };

    const logs: string[] = [];
    const orig = console.log;
    console.log = (m: string) => { logs.push(m); };
    try {
      await runImprovementCycle([mkWeak("c0", 0.5)], analysis, { promptsPath: PROMPTS_PATH, improvementsDir: IMPROVEMENTS_DIR });
    } finally {
      console.log = orig;
    }

    // 5 accepted (proposals 6 → 5 cap, 모두 같은 mock 응답 받아 schema 통과)
    const finalLog = logs.find((l) => l.includes("cycle complete"));
    expect(finalLog).toMatch(/accepted=5/);
  });

  it("writes prompts.json + invalidates cache + audit on accepted proposal (happy path)", async () => {
    mockClaudeResponse = JSON.stringify({
      promptKey: "copy.angleHints.emotional",
      newValue: "감정 호소를 더 강하게 — 새 학습된 값입니다.",
      reason: "데이터 분석 결과",
    });
    const analysis: AnalysisResult = {
      improvements: [{ campaignId: "c1", issue: "weak emotional", suggestion: "stronger emotion", promptKey: "copy.angleHints.emotional" }],
    };
    await runImprovementCycle([mkWeak("c1", 0.5)], analysis, { promptsPath: PROMPTS_PATH, improvementsDir: IMPROVEMENTS_DIR });

    // 파일 작성 확인
    const written = await readFile(PROMPTS_PATH, "utf-8");
    const parsed: Prompts = JSON.parse(written);
    expect(parsed.copy.angleHints.emotional).toBe("감정 호소를 더 강하게 — 새 학습된 값입니다.");

    // 캐시 invalidation 확인 — 다음 loadPrompts 가 새 값 반환
    const reloaded = await loadPrompts();
    expect(reloaded.copy.angleHints.emotional).toBe("감정 호소를 더 강하게 — 새 학습된 값입니다.");

    // Audit 파일 작성 확인
    const dateKey = new Date().toISOString().split("T")[0];
    const auditPath = path.join(IMPROVEMENTS_DIR, `${dateKey}.json`);
    const auditRaw = await readFile(auditPath, "utf-8");
    const audit = JSON.parse(auditRaw);
    expect(audit[0].changes[0].promptKey).toBe("copy.angleHints.emotional");
    expect(audit[0].changes[0].after).toContain("감정 호소를 더 강하게");
  });

  it("rejects proposal when Claude response is malformed (no JSON)", async () => {
    mockClaudeResponse = "this is not JSON at all";
    const analysis: AnalysisResult = {
      improvements: [{ campaignId: "c1", issue: "x", suggestion: "y", promptKey: "copy.angleHints.emotional" }],
    };
    await runImprovementCycle([mkWeak("c1", 0.5)], analysis, { promptsPath: PROMPTS_PATH, improvementsDir: IMPROVEMENTS_DIR });

    const dateKey = new Date().toISOString().split("T")[0];
    const rejectedPath = path.join(IMPROVEMENTS_DIR, `${dateKey}-rejected.json`);
    const raw = await readFile(rejectedPath, "utf-8");
    const rec = JSON.parse(raw);
    expect(rec[0].rejected[0].reason).toMatch(/parse fail/);
  });

  it("rejects when Claude returns mismatched promptKey", async () => {
    mockClaudeResponse = JSON.stringify({
      promptKey: "copy.userTemplate",
      newValue: "x".repeat(150),
      reason: "test",
    });
    const analysis: AnalysisResult = {
      improvements: [{ campaignId: "c1", issue: "x", suggestion: "y", promptKey: "copy.angleHints.emotional" }],
    };
    await runImprovementCycle([mkWeak("c1", 0.5)], analysis, { promptsPath: PROMPTS_PATH, improvementsDir: IMPROVEMENTS_DIR });

    const dateKey = new Date().toISOString().split("T")[0];
    const rejectedPath = path.join(IMPROVEMENTS_DIR, `${dateKey}-rejected.json`);
    const raw = await readFile(rejectedPath, "utf-8");
    const rec = JSON.parse(raw);
    expect(rec[0].rejected[0].reason).toMatch(/key mismatch/);
  });

  it("rejects when newValue too short (schema fail)", async () => {
    mockClaudeResponse = JSON.stringify({
      promptKey: "copy.systemPrompt",
      newValue: "too short",
      reason: "test",
    });
    const analysis: AnalysisResult = {
      improvements: [{ campaignId: "c1", issue: "x", suggestion: "y", promptKey: "copy.systemPrompt" }],
    };
    await runImprovementCycle([mkWeak("c1", 0.5)], analysis, { promptsPath: PROMPTS_PATH, improvementsDir: IMPROVEMENTS_DIR });

    const dateKey = new Date().toISOString().split("T")[0];
    const rejectedPath = path.join(IMPROVEMENTS_DIR, `${dateKey}-rejected.json`);
    const raw = await readFile(rejectedPath, "utf-8");
    const rec = JSON.parse(raw);
    expect(rec[0].rejected[0].reason).toMatch(/schema validation/);
  });

  it("rejects userTemplate update when required placeholders missing", async () => {
    // newValue 가 100자 이상이지만 {{name}} 누락
    mockClaudeResponse = JSON.stringify({
      promptKey: "copy.userTemplate",
      newValue: "no placeholders here at all".padEnd(150, "x"),
      reason: "test",
    });
    const analysis: AnalysisResult = {
      improvements: [{ campaignId: "c1", issue: "x", suggestion: "y", promptKey: "copy.userTemplate" }],
    };
    await runImprovementCycle([mkWeak("c1", 0.5)], analysis, { promptsPath: PROMPTS_PATH, improvementsDir: IMPROVEMENTS_DIR });

    const dateKey = new Date().toISOString().split("T")[0];
    const rejectedPath = path.join(IMPROVEMENTS_DIR, `${dateKey}-rejected.json`);
    const raw = await readFile(rejectedPath, "utf-8");
    const rec = JSON.parse(raw);
    expect(rec[0].rejected[0].reason).toMatch(/missing required placeholders/);
  });

  it("processes mixed accepted + rejected — accepted goes to prompts.json, rejected to -rejected.json", async () => {
    // 첫 호출은 valid, 두 번째는 invalid (mock 한 번에 하나의 response 만 반환)
    // → 동일 응답 받지만 두 번째 promptKey 가 mismatch 라 reject
    mockClaudeResponse = JSON.stringify({
      promptKey: "copy.angleHints.emotional",
      newValue: "감정 호소 새 가이드 — 충분히 긴 길이입니다.",
      reason: "test",
    });
    const analysis: AnalysisResult = {
      improvements: [
        { campaignId: "c1", issue: "x", suggestion: "y", promptKey: "copy.angleHints.emotional" },
        { campaignId: "c2", issue: "x", suggestion: "y", promptKey: "copy.angleHints.numerical" }, // mock 응답의 emotional 과 mismatch
      ],
    };
    await runImprovementCycle([mkWeak("c1", 0.5)], analysis, { promptsPath: PROMPTS_PATH, improvementsDir: IMPROVEMENTS_DIR });

    const dateKey = new Date().toISOString().split("T")[0];
    // accepted 파일
    const auditRaw = await readFile(path.join(IMPROVEMENTS_DIR, `${dateKey}.json`), "utf-8");
    expect(JSON.parse(auditRaw)[0].changes).toHaveLength(1);
    // rejected 파일
    const rejRaw = await readFile(path.join(IMPROVEMENTS_DIR, `${dateKey}-rejected.json`), "utf-8");
    expect(JSON.parse(rejRaw)[0].rejected).toHaveLength(1);
  });

  it("rejects newValue with personalization tokens (Gate 4)", async () => {
    mockClaudeResponse = JSON.stringify({
      promptKey: "copy.angleHints.emotional",
      newValue: "회원님께만 드리는 특별한 감정 호소 가이드 — 충분히 긴 길이",
      reason: "test",
    });
    const analysis: AnalysisResult = {
      improvements: [{ campaignId: "c1", issue: "x", suggestion: "y", promptKey: "copy.angleHints.emotional" }],
    };
    await runImprovementCycle([mkWeak("c1", 0.5)], analysis, { promptsPath: PROMPTS_PATH, improvementsDir: IMPROVEMENTS_DIR });

    const dateKey = new Date().toISOString().split("T")[0];
    const rejectedPath = path.join(IMPROVEMENTS_DIR, `${dateKey}-rejected.json`);
    const raw = await readFile(rejectedPath, "utf-8");
    const rec = JSON.parse(raw);
    expect(rec[0].rejected[0].reason).toMatch(/banned pattern.*personalization/);
  });

  it("rejects newValue with generic [name]+님 honorific (Gate 4 regression)", async () => {
    mockClaudeResponse = JSON.stringify({
      promptKey: "copy.systemPrompt",
      newValue: "이 광고는 고객님께 직접 추천하는 메시지로 작성하세요. 헤드라인 본문 CTA 해시태그 가이드 — 충분히 긴 길이.",
      reason: "test",
    });
    const analysis: AnalysisResult = {
      improvements: [{ campaignId: "c1", issue: "x", suggestion: "y", promptKey: "copy.systemPrompt" }],
    };
    await runImprovementCycle([mkWeak("c1", 0.5)], analysis, { promptsPath: PROMPTS_PATH, improvementsDir: IMPROVEMENTS_DIR });

    const dateKey = new Date().toISOString().split("T")[0];
    const rejectedPath = path.join(IMPROVEMENTS_DIR, `${dateKey}-rejected.json`);
    const raw = await readFile(rejectedPath, "utf-8");
    const rec = JSON.parse(raw);
    expect(rec[0].rejected[0].reason).toMatch(/banned pattern.*personalization/);
  });

  it("does NOT reject legitimate '회원가입' / '부모님과' (boundary positive control)", async () => {
    mockClaudeResponse = JSON.stringify({
      promptKey: "copy.angleHints.numerical",
      newValue: "회원가입 시 즉시 할인 혜택. 부모님과 함께 즐기는 수치 강조 가이드 — 충분히 긴 길이.",
      reason: "test",
    });
    const analysis: AnalysisResult = {
      improvements: [{ campaignId: "c1", issue: "x", suggestion: "y", promptKey: "copy.angleHints.numerical" }],
    };
    await runImprovementCycle([mkWeak("c1", 0.5)], analysis, { promptsPath: PROMPTS_PATH, improvementsDir: IMPROVEMENTS_DIR });

    const dateKey = new Date().toISOString().split("T")[0];
    const acceptedPath = path.join(IMPROVEMENTS_DIR, `${dateKey}.json`);
    const raw = await readFile(acceptedPath, "utf-8");
    const rec = JSON.parse(raw);
    expect(rec[0].changes[0].after).toContain("회원가입");
  });

  it("rejects newValue with unverified hyperbole (Gate 4)", async () => {
    mockClaudeResponse = JSON.stringify({
      promptKey: "copy.angleHints.numerical",
      newValue: "100% 효과 보장 + 1위 입증된 수치 강조 가이드 — 충분히 긴 길이",
      reason: "test",
    });
    const analysis: AnalysisResult = {
      improvements: [{ campaignId: "c1", issue: "x", suggestion: "y", promptKey: "copy.angleHints.numerical" }],
    };
    await runImprovementCycle([mkWeak("c1", 0.5)], analysis, { promptsPath: PROMPTS_PATH, improvementsDir: IMPROVEMENTS_DIR });

    const dateKey = new Date().toISOString().split("T")[0];
    const rejectedPath = path.join(IMPROVEMENTS_DIR, `${dateKey}-rejected.json`);
    const raw = await readFile(rejectedPath, "utf-8");
    const rec = JSON.parse(raw);
    expect(rec[0].rejected[0].reason).toMatch(/banned pattern.*hyperbole/);
  });

  it("rejects newValue with '최고의 X' superlative (Gate 4 regression)", async () => {
    mockClaudeResponse = JSON.stringify({
      promptKey: "copy.systemPrompt",
      newValue: "이 광고는 최고의 성능을 강조하세요. 헤드라인 본문 CTA 해시태그 가이드 — 충분히 긴 길이로 유지.",
      reason: "test",
    });
    const analysis: AnalysisResult = {
      improvements: [{ campaignId: "c1", issue: "x", suggestion: "y", promptKey: "copy.systemPrompt" }],
    };
    await runImprovementCycle([mkWeak("c1", 0.5)], analysis, { promptsPath: PROMPTS_PATH, improvementsDir: IMPROVEMENTS_DIR });

    const dateKey = new Date().toISOString().split("T")[0];
    const rejectedPath = path.join(IMPROVEMENTS_DIR, `${dateKey}-rejected.json`);
    const raw = await readFile(rejectedPath, "utf-8");
    const rec = JSON.parse(raw);
    expect(rec[0].rejected[0].reason).toMatch(/banned pattern.*hyperbole/);
  });

  it("rejects newValue with '효과 보장합니다' result-guarantee pattern (Gate 4)", async () => {
    mockClaudeResponse = JSON.stringify({
      promptKey: "copy.angleHints.numerical",
      newValue: "이 강의는 학습 효과 보장합니다. 수치 강조 가이드 — 충분히 긴 길이로 유지.",
      reason: "test",
    });
    const analysis: AnalysisResult = {
      improvements: [{ campaignId: "c1", issue: "x", suggestion: "y", promptKey: "copy.angleHints.numerical" }],
    };
    await runImprovementCycle([mkWeak("c1", 0.5)], analysis, { promptsPath: PROMPTS_PATH, improvementsDir: IMPROVEMENTS_DIR });

    const dateKey = new Date().toISOString().split("T")[0];
    const rejectedPath = path.join(IMPROVEMENTS_DIR, `${dateKey}-rejected.json`);
    const raw = await readFile(rejectedPath, "utf-8");
    const rec = JSON.parse(raw);
    expect(rec[0].rejected[0].reason).toMatch(/banned pattern.*result-guarantee/);
  });

  it("rejects newValue with '100% 마스터' result-guarantee pattern (Gate 4)", async () => {
    mockClaudeResponse = JSON.stringify({
      promptKey: "copy.angleHints.emotional",
      newValue: "이 강의로 100% 마스터 가능. 감정 호소 가이드 — 충분히 긴 길이로 유지.",
      reason: "test",
    });
    const analysis: AnalysisResult = {
      improvements: [{ campaignId: "c1", issue: "x", suggestion: "y", promptKey: "copy.angleHints.emotional" }],
    };
    await runImprovementCycle([mkWeak("c1", 0.5)], analysis, { promptsPath: PROMPTS_PATH, improvementsDir: IMPROVEMENTS_DIR });

    const dateKey = new Date().toISOString().split("T")[0];
    const rejectedPath = path.join(IMPROVEMENTS_DIR, `${dateKey}-rejected.json`);
    const raw = await readFile(rejectedPath, "utf-8");
    const rec = JSON.parse(raw);
    expect(rec[0].rejected[0].reason).toMatch(/banned pattern.*result-guarantee/);
  });

  it("rejects newValue with '역대 최저' discount-superlative pattern (Gate 4)", async () => {
    mockClaudeResponse = JSON.stringify({
      promptKey: "copy.angleHints.urgency",
      newValue: "역대 최저가 할인 진행 중. 긴급성 강조 가이드 — 충분히 긴 길이로 유지.",
      reason: "test",
    });
    const analysis: AnalysisResult = {
      improvements: [{ campaignId: "c1", issue: "x", suggestion: "y", promptKey: "copy.angleHints.urgency" }],
    };
    await runImprovementCycle([mkWeak("c1", 0.5)], analysis, { promptsPath: PROMPTS_PATH, improvementsDir: IMPROVEMENTS_DIR });

    const dateKey = new Date().toISOString().split("T")[0];
    const rejectedPath = path.join(IMPROVEMENTS_DIR, `${dateKey}-rejected.json`);
    const raw = await readFile(rejectedPath, "utf-8");
    const rec = JSON.parse(raw);
    expect(rec[0].rejected[0].reason).toMatch(/banned pattern.*discount-superlative/);
  });

  it("rejects newValue with '최대 할인' discount-superlative pattern (Gate 4)", async () => {
    mockClaudeResponse = JSON.stringify({
      promptKey: "copy.angleHints.urgency",
      newValue: "최대 할인 혜택 진행 중. 긴급성 강조 가이드 — 충분히 긴 길이로 유지.",
      reason: "test",
    });
    const analysis: AnalysisResult = {
      improvements: [{ campaignId: "c1", issue: "x", suggestion: "y", promptKey: "copy.angleHints.urgency" }],
    };
    await runImprovementCycle([mkWeak("c1", 0.5)], analysis, { promptsPath: PROMPTS_PATH, improvementsDir: IMPROVEMENTS_DIR });

    const dateKey = new Date().toISOString().split("T")[0];
    const rejectedPath = path.join(IMPROVEMENTS_DIR, `${dateKey}-rejected.json`);
    const raw = await readFile(rejectedPath, "utf-8");
    const rec = JSON.parse(raw);
    expect(rec[0].rejected[0].reason).toMatch(/banned pattern.*discount-superlative/);
  });

  it("does NOT reject legitimate '환불 보장' / '품질 보장된' (result-guarantee boundary positive control)", async () => {
    mockClaudeResponse = JSON.stringify({
      promptKey: "copy.angleHints.urgency",
      newValue: "환불 보장으로 안심하고 결제. 품질 보장된 제품의 긴급성 강조 가이드 — 충분히 긴 길이로 유지.",
      reason: "test",
    });
    const analysis: AnalysisResult = {
      improvements: [{ campaignId: "c1", issue: "x", suggestion: "y", promptKey: "copy.angleHints.urgency" }],
    };
    await runImprovementCycle([mkWeak("c1", 0.5)], analysis, { promptsPath: PROMPTS_PATH, improvementsDir: IMPROVEMENTS_DIR });

    // 합법 commercial 표현 — accepted 되어 prompts.json 에 반영됨
    const dateKey = new Date().toISOString().split("T")[0];
    const acceptedPath = path.join(IMPROVEMENTS_DIR, `${dateKey}.json`);
    const raw = await readFile(acceptedPath, "utf-8");
    const rec = JSON.parse(raw);
    expect(rec[0].changes[0].after).toContain("환불 보장");
  });

  it("does NOT reject legitimate '최고급' / '최고온도' (boundary positive control)", async () => {
    mockClaudeResponse = JSON.stringify({
      promptKey: "copy.angleHints.numerical",
      newValue: "최고급 원단으로 만든 제품의 수치 강조 가이드 — 보장 최고온도 100도까지.",
      reason: "test",
    });
    const analysis: AnalysisResult = {
      improvements: [{ campaignId: "c1", issue: "x", suggestion: "y", promptKey: "copy.angleHints.numerical" }],
    };
    await runImprovementCycle([mkWeak("c1", 0.5)], analysis, { promptsPath: PROMPTS_PATH, improvementsDir: IMPROVEMENTS_DIR });

    // 정상 처리되어 prompts.json 에 반영됨 (rejected 파일 없음)
    const dateKey = new Date().toISOString().split("T")[0];
    const acceptedPath = path.join(IMPROVEMENTS_DIR, `${dateKey}.json`);
    const raw = await readFile(acceptedPath, "utf-8");
    const rec = JSON.parse(raw);
    expect(rec[0].changes[0].after).toContain("최고급");
  });

  it("emits cost log at end of cycle", async () => {
    mockClaudeResponse = JSON.stringify({
      promptKey: "copy.angleHints.emotional",
      newValue: "감정 호소 — 충분히 긴 새 가이드 텍스트입니다.",
      reason: "test",
    });
    const analysis: AnalysisResult = {
      improvements: [{ campaignId: "c1", issue: "x", suggestion: "y", promptKey: "copy.angleHints.emotional" }],
    };
    const logs: string[] = [];
    const orig = console.log;
    console.log = (m: string) => { logs.push(m); };
    try {
      await runImprovementCycle([mkWeak("c1", 0.5)], analysis, { promptsPath: PROMPTS_PATH, improvementsDir: IMPROVEMENTS_DIR });
    } finally {
      console.log = orig;
    }
    const costLog = logs.find((l) => l.includes("cycle complete") && l.includes("est_cost"));
    expect(costLog).toBeDefined();
    expect(costLog).toMatch(/accepted=1/);
    expect(costLog).toMatch(/est_cost=\$0\.0\d+/);
  });
});
