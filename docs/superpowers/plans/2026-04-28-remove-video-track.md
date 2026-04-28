# 영상 트랙 제거 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Veo / video.ts / videoJob.ts / aiVideo.ts / video 관련 모든 코드 + 데이터 필드 (`Creative.videoLocalPath` / `VariantGroup.assets.video` / `AssetFeedSpec.videos`) 완전 제거. 광고 자동화 = image + copy 만으로 단순화.

**Architecture:** 2 atomic commits. Commit 1 = type-level removal + production 코드 변경 (atomic — TypeScript cascade). Commit 2 = Veo dead code 파일 삭제 + STATUS/ROADMAP 정리. Commit 1 land 후 video 관련 코드가 import 되지 않으므로 Commit 2 의 파일 삭제 안전.

**Tech Stack:** TypeScript, vitest, Ink (TUI), Express (server, 미실행이지만 코드 sync). tsx 런타임.

**Spec:** `docs/superpowers/specs/2026-04-28-remove-video-track-design.md` (커밋 `bba1c94`)

**브랜치:** master 직접 commit (CLAUDE.md 정책).

**견적:** ~6.5h (1일).

**Subagent 호출:**
- Commit 1 → `meta-platform-expert` (CLAUDE.md "Subagent 호출 규칙" — `packages/core/src/platform/meta/launcher.ts` 수정 — uploadVideo 함수 제거 + asset_feed_spec 호출 변경) + `superpowers:code-reviewer`
- Commit 2 → `superpowers:code-reviewer` (deletion only, platform/meta 무변경)
- DEFAULT_PROMPTS / buildCopyPrompt 변경 없음 → `marketing-copy-reviewer` 트리거 안 함

---

## Task 0: Pre-flight

### Task 0.1: 환경 확인

- [ ] **Step 1: 작업 트리 깨끗**
```bash
git status --short
```
Expected: 빈 출력 또는 `.claude/scheduled_tasks.lock` 만.

- [ ] **Step 2: HEAD = spec commit**
```bash
git log --oneline -3
```
Expected 최상단: `bba1c94 docs(specs): add 영상 트랙 제거 design spec`

- [ ] **Step 3: Test baseline**
```bash
npm test 2>&1 | tail -3
```
Expected: ~460 passing + 1 useReports 알려진 flake.

- [ ] **Step 4: TypeScript clean**
```bash
npx tsc --noEmit -p packages/core/tsconfig.json 2>&1 | grep -v "facebook-nodejs\|TS7016" | head
npx tsc --noEmit -p packages/cli/tsconfig.json 2>&1 | grep -v "facebook-nodejs\|TS7016" | head
npx tsc --noEmit -p packages/server/tsconfig.json 2>&1 | grep -v "facebook-nodejs\|TS7016" | head
```
Expected: 0 errors after filter.

---

## Commit 1: Type-level removal + production code (atomic)

### Task 1.1: 타입 변경 — Creative + VariantGroup + AssetFeedSpec

**Files:**
- Modify: `packages/core/src/types.ts:25-35` (Creative interface)
- Modify: `packages/core/src/platform/types.ts:3-8` (VariantGroup interface)
- Modify: `packages/core/src/platform/meta/assetFeedSpec.ts:1-62` (전체)

- [ ] **Step 1: `packages/core/src/types.ts` Creative — videoLocalPath 라인 제거**

```ts
// Before (line 25-35)
export interface Creative {
  id: string;
  productId: string;
  variantGroupId: string;                   // Plan A 신규 — 같은 제품의 variant 공유 ID
  copy: { ... };
  imageLocalPath: string;
  videoLocalPath: string;
  status: "pending" | "approved" | "rejected" | "edited";
  reviewNote?: string;
  createdAt: string;
}

// After (line 25-34)
export interface Creative {
  id: string;
  productId: string;
  variantGroupId: string;
  copy: { ... };
  imageLocalPath: string;
  status: "pending" | "approved" | "rejected" | "edited";
  reviewNote?: string;
  createdAt: string;
}
```

- [ ] **Step 2: `packages/core/src/platform/types.ts` VariantGroup — assets 에서 video 키 제거**

```ts
// Before (line 3-8)
export interface VariantGroup {
  variantGroupId: string;
  product: Product;
  creatives: Creative[];
  assets: { image: string; video: string };
}

// After
export interface VariantGroup {
  variantGroupId: string;
  product: Product;
  creatives: Creative[];
  assets: { image: string };
}
```

- [ ] **Step 3: `packages/core/src/platform/meta/assetFeedSpec.ts` 전체 교체**

```ts
import type { Creative, Product } from "../../types.js";

export interface AssetFeedSpecInput {
  product: Product;
  creatives: Creative[];
  imageHash: string;
}

export interface AssetFeedSpec {
  titles: { text: string }[];
  bodies: { text: string; adlabels: { name: string }[] }[];
  link_urls: { website_url: string }[];
  images: { hash: string }[];
  call_to_action_types: string[];
}

export function assembleAssetFeedSpec(input: AssetFeedSpecInput): AssetFeedSpec {
  const { product, creatives, imageHash } = input;
  if (creatives.length === 0) {
    throw new Error("assembleAssetFeedSpec requires at least one creative");
  }

  const sharedHeadline = creatives[0].copy.headline;
  const sharedCta = creatives[0].copy.cta;

  const normalize = (t: string) => t.replace(/\r\n/g, "\n").trim();
  const bodies = creatives.map((c) => {
    const hashtags = c.copy.hashtags.map((t) => `#${t}`).join(" ");
    const text = hashtags ? `${c.copy.body}\n\n${hashtags}` : c.copy.body;
    return {
      text,
      adlabels: [{ name: c.copy.assetLabel }],
    };
  });

  // Validate: after CRLF/trim normalization, every body.text must be unique.
  // Otherwise parseBodyAssetBreakdown will silently attribute performance to
  // the first matching creative (Strategy B collision).
  const seen = new Map<string, string>();
  for (let i = 0; i < bodies.length; i++) {
    const key = normalize(bodies[i].text);
    if (seen.has(key)) {
      throw new Error(
        `assembleAssetFeedSpec: duplicate body text in variant group. ` +
          `Creative[${seen.get(key)}] and Creative[${i}] produce the same normalized text. ` +
          `Regenerate one of the copies.`,
      );
    }
    seen.set(key, String(i));
  }

  return {
    titles: [{ text: sharedHeadline }],
    bodies,
    link_urls: [{ website_url: product.targetUrl }],
    images: [{ hash: imageHash }],
    call_to_action_types: [sharedCta],
  };
}
```

- [ ] **Step 4: TypeScript check (이 시점은 fail 예상 — 모든 호출처가 `videoLocalPath`/`videoId` 사용 중)**

```bash
npx tsc --noEmit -p packages/core/tsconfig.json 2>&1 | grep -v "facebook-nodejs\|TS7016" | head -20
```
Expected: 다수 에러 — 다음 task 에서 차례로 fix.

### Task 1.2: `meta/launcher.ts` — uploadVideo 함수 + 호출 + asset_feed_spec 매개변수 정리

**Files:**
- Modify: `packages/core/src/platform/meta/launcher.ts:85-92` (uploadVideo 함수 제거)
- Modify: `packages/core/src/platform/meta/launcher.ts:139-150` (호출 + assembleAssetFeedSpec)

- [ ] **Step 1: `uploadVideo` 함수 제거 (line 85-92)**

다음 함수 전체 삭제:

```ts
async function uploadVideo(account: any, videoPath: string): Promise<string> {
  const videoBuffer = await readFile(videoPath);
  const video = await account.createAdVideo([], {
    source: videoBuffer,
    title: "Ad Video",
  });
  return video.id as string;
}
```

- [ ] **Step 2: 호출처 변경 (line ~138-150)**

```ts
// Before
    // 3. Upload assets (image + video)
    const imageHash = await uploadImage(account, group.assets.image);
    onLog?.({ ts: new Date().toISOString(), method: "POST", path: "/act/adimages", status: 200, refId: imageHash });
    const videoId = await uploadVideo(account, group.assets.video);
    onLog?.({ ts: new Date().toISOString(), method: "POST", path: "/act/advideos", status: 200, refId: videoId });

    // 4. Assemble asset_feed_spec
    const assetFeedSpec = assembleAssetFeedSpec({
      product: group.product,
      creatives: group.creatives,
      imageHash,
      videoId,
    });

// After
    // 3. Upload image asset
    const imageHash = await uploadImage(account, group.assets.image);
    onLog?.({ ts: new Date().toISOString(), method: "POST", path: "/act/adimages", status: 200, refId: imageHash });

    // 4. Assemble asset_feed_spec
    const assetFeedSpec = assembleAssetFeedSpec({
      product: group.product,
      creatives: group.creatives,
      imageHash,
    });
```

### Task 1.3: `actions.ts` — runGenerate + runLaunch + buildOverallProgress

**Files:**
- Modify: `packages/cli/src/actions.ts:24-26` (imports), `:33-35` (buildOverallProgress), `:65-180` (runGenerate), `:230` (runLaunch)

- [ ] **Step 1: imports 정리 (line 24-26 근처)**

```ts
// Before
import { generateCopy, createAnthropicClient } from "@ad-ai/core/creative/copy.js";
import { generateImage } from "@ad-ai/core/creative/image.js";
import { generateVideo } from "@ad-ai/core/creative/video.js";

// After
import { generateCopy, createAnthropicClient } from "@ad-ai/core/creative/copy.js";
import { generateImage } from "@ad-ai/core/creative/image.js";
// generateVideo import 제거
```

- [ ] **Step 2: `buildOverallProgress` (line 33-35) 수정**

```ts
// Before
export function buildOverallProgress(p: TaskProgress): number {
  return Math.round((p.copy + p.image + p.video) / 3);
}

// After
export function buildOverallProgress(p: TaskProgress): number {
  return Math.round((p.copy + p.image) / 2);
}
```

- [ ] **Step 3: `runGenerate` 의 tracks 객체 (line ~91-95) — video 키 제거**

```ts
// Before
type Track = { status: "pending" | "running" | "done"; pct: number; label: string };
const tracks: { copy: Track; image: Track; video: Track } = {
  copy:  { status: "running", pct: 0, label: "대기" },
  image: { status: "running", pct: 0, label: "시작" },
  video: { status: "running", pct: 0, label: "시작" },
};

// After
type Track = { status: "pending" | "running" | "done"; pct: number; label: string };
const tracks: { copy: Track; image: Track } = {
  copy:  { status: "running", pct: 0, label: "대기" },
  image: { status: "running", pct: 0, label: "시작" },
};
```

- [ ] **Step 4: `videoTask` 정의 제거 (line ~114-123) — 다음 블록 전체 삭제**

```ts
const videoTask = (async () => {
  const p = await generateVideo(product, (msg) => {
    const match = msg.match(/\((\d+)\/(\d+)\)/);
    if (match) tracks.video = { status: "running", pct: Math.round((Number(match[1]) / Number(match[2])) * 95), label: msg };
    emit(msg);
  });
  tracks.video = { status: "done", pct: 100, label: "done" };
  emit(`${product.name} 영상 완료`);
  return p;
})();
```

- [ ] **Step 5: `Promise.allSettled` 호출 변경 (line ~143-180)**

```ts
// Before
const [imageRes, videoRes, copyRes] = await Promise.allSettled([imageTask, videoTask, copiesTask]);

// 부분 실패 시 성공한 image/video 파일을 cleanup ...
const failed = [imageRes, videoRes, copyRes].some((r) => r.status === "rejected");
if (failed) {
  if (imageRes.status === "fulfilled") await unlink(imageRes.value).catch(() => {});
  if (videoRes.status === "fulfilled") await unlink(videoRes.value).catch(() => {});
  const reasons = [
    imageRes.status === "rejected" ? `image: ${String(imageRes.reason).slice(0, 200)}` : null,
    videoRes.status === "rejected" ? `video: ${String(videoRes.reason).slice(0, 200)}` : null,
    copyRes.status === "rejected" ? `copy: ${String(copyRes.reason).slice(0, 200)}` : null,
  ].filter((s): s is string => s !== null);
  throw new Error(`Generate 부분 실패 (${product.name}) — ${reasons.join(" | ")}`);
}

const imageLocalPath = (imageRes as PromiseFulfilledResult<string>).value;
const videoLocalPath = (videoRes as PromiseFulfilledResult<string>).value;
const copies = (copyRes as PromiseFulfilledResult<...>).value;

for (const { label, data } of copies) {
  const creative: Creative = {
    id: randomUUID(),
    productId: product.id,
    variantGroupId,
    copy: { ...data, variantLabel: label, assetLabel: `${variantGroupId}::${label}` },
    imageLocalPath, videoLocalPath, status: "pending",
    createdAt: new Date().toISOString(),
  };
  await writeJson(`data/creatives/${creative.id}.json`, creative);
}

// After
const [imageRes, copyRes] = await Promise.allSettled([imageTask, copiesTask]);

// 부분 실패 시 성공한 image 파일을 cleanup — 다음 단계 (Review) 가 고아 파일을 보지 않도록
const failed = [imageRes, copyRes].some((r) => r.status === "rejected");
if (failed) {
  if (imageRes.status === "fulfilled") await unlink(imageRes.value).catch(() => {});
  const reasons = [
    imageRes.status === "rejected" ? `image: ${String(imageRes.reason).slice(0, 200)}` : null,
    copyRes.status === "rejected" ? `copy: ${String(copyRes.reason).slice(0, 200)}` : null,
  ].filter((s): s is string => s !== null);
  throw new Error(`Generate 부분 실패 (${product.name}) — ${reasons.join(" | ")}`);
}

const imageLocalPath = (imageRes as PromiseFulfilledResult<string>).value;
const copies = (copyRes as PromiseFulfilledResult<typeof VARIANT_LABELS extends readonly (infer L)[] ? { label: L; data: Awaited<ReturnType<typeof generateCopy>> }[] : never>).value;

for (const { label, data } of copies) {
  const creative: Creative = {
    id: randomUUID(),
    productId: product.id,
    variantGroupId,
    copy: { ...data, variantLabel: label, assetLabel: `${variantGroupId}::${label}` },
    imageLocalPath, status: "pending",
    createdAt: new Date().toISOString(),
  };
  await writeJson(`data/creatives/${creative.id}.json`, creative);
}
```

- [ ] **Step 6: `runLaunch` (line ~230) 의 VariantGroup assets — video 제거**

```ts
// Before
const group: VariantGroup = { variantGroupId: groupId, product, creatives: approved, assets: { image: approved[0].imageLocalPath, video: approved[0].videoLocalPath } };

// After
const group: VariantGroup = { variantGroupId: groupId, product, creatives: approved, assets: { image: approved[0].imageLocalPath } };
```

### Task 1.4: CLI entry points — pipeline.ts + entries/generate.ts + entries/launch.ts

**Files:**
- Modify: `packages/cli/src/pipeline.ts`
- Modify: `packages/cli/src/entries/generate.ts`
- Modify: `packages/cli/src/entries/launch.ts`

- [ ] **Step 1: `pipeline.ts` — generateVideo import + 호출 + Creative literal**

```ts
// Before (line 7)
import { generateVideo } from "@ad-ai/core/creative/video.js";

// After (line 7 제거)
```

```ts
// Before (line 62-68)
update("generate", `이미지 생성 중... ${product.name}`);
const imageLocalPath = await generateImage(product);

update("generate", `영상 생성 중... (최대 10분 소요) ${product.name}`);
const videoLocalPath = await generateVideo(product, (msg) =>
  update("generate", msg)
);

// After
update("generate", `이미지 생성 중... ${product.name}`);
const imageLocalPath = await generateImage(product);
```

```ts
// Before (line 81-94)
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
  videoLocalPath,
  status: "pending",
  createdAt: new Date().toISOString(),
};

// After
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
```

- [ ] **Step 2: `entries/generate.ts` — 동일 패턴**

```ts
// Before (line 3)
import { generateVideo } from "@ad-ai/core/creative/video.js";

// After (line 3 제거)
```

```ts
// Before (line 26-29)
console.log("이미지 생성 중...");
const imageLocalPath = await generateImage(product);
console.log("영상 생성 중... (최대 10분 소요)");
const videoLocalPath = await generateVideo(product, console.log);

// After
console.log("이미지 생성 중...");
const imageLocalPath = await generateImage(product);
```

```ts
// Before (line 41-54) Creative literal
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
  videoLocalPath,
  status: "pending",
  createdAt: new Date().toISOString(),
};

// After (videoLocalPath 라인 제거)
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
```

- [ ] **Step 3: `entries/launch.ts:45-49` — VariantGroup assets**

```ts
// Before
const group: VariantGroup = {
  variantGroupId: groupId,
  product,
  creatives: approved,
  assets: {
    image: approved[0].imageLocalPath,
    video: approved[0].videoLocalPath,
  },
};

// After
const group: VariantGroup = {
  variantGroupId: groupId,
  product,
  creatives: approved,
  assets: {
    image: approved[0].imageLocalPath,
  },
};
```

### Task 1.5: TUI — AppTypes + GenerateScreen + ReviewScreen + PipelineScreen

**Files:**
- Modify: `packages/cli/src/tui/AppTypes.ts:6-10, 59-68`
- Modify: `packages/cli/src/tui/screens/GenerateScreen.tsx:17, 28`
- Modify: `packages/cli/src/tui/screens/ReviewScreen.tsx:43, 49-58, 152-159`
- Modify: `packages/cli/src/tui/screens/PipelineScreen.tsx:30-31`

- [ ] **Step 1: `AppTypes.ts:6-10` TaskProgress — video 키 제거**

```ts
// Before
export interface TaskProgress {
  copy: number;    // 0-100
  image: number;   // 0-100
  video: number;   // 0-100
}

// After
export interface TaskProgress {
  copy: number;    // 0-100
  image: number;   // 0-100
}
```

- [ ] **Step 2: `AppTypes.ts:59-68` GenerateProgress.tracks — video 키 제거**

```ts
// Before
export interface GenerateProgress {
  queue: ("done" | "running" | "pending")[];
  currentProduct: { id: string; name: string };
  tracks: {
    copy:  { status: "pending" | "running" | "done"; pct: number; label: string };
    image: { status: "pending" | "running" | "done"; pct: number; label: string };
    video: { status: "pending" | "running" | "done"; pct: number; label: string };
  };
  elapsedMs: number;
}

// After
export interface GenerateProgress {
  queue: ("done" | "running" | "pending")[];
  currentProduct: { id: string; name: string };
  tracks: {
    copy:  { status: "pending" | "running" | "done"; pct: number; label: string };
    image: { status: "pending" | "running" | "done"; pct: number; label: string };
  };
  elapsedMs: number;
}
```

- [ ] **Step 3: `GenerateScreen.tsx:17` — overallPct 계산 변경**

```ts
// Before
const overallPct = Math.round((g.tracks.copy.pct + g.tracks.image.pct + g.tracks.video.pct) / 3);

// After
const overallPct = Math.round((g.tracks.copy.pct + g.tracks.image.pct) / 2);
```

- [ ] **Step 4: `GenerateScreen.tsx:28` — "영상" ProgressTrack 라인 제거**

```ts
// Before
React.createElement(ProgressTrack, { label: "카피", status: g.tracks.copy.status, pct: g.tracks.copy.pct, detail: g.tracks.copy.label }),
React.createElement(ProgressTrack, { label: "이미지", status: g.tracks.image.status, pct: g.tracks.image.pct, detail: g.tracks.image.label }),
React.createElement(ProgressTrack, { label: "영상", status: g.tracks.video.status, pct: g.tracks.video.pct, detail: g.tracks.video.label }),

// After (영상 라인 제거)
React.createElement(ProgressTrack, { label: "카피", status: g.tracks.copy.status, pct: g.tracks.copy.pct, detail: g.tracks.copy.label }),
React.createElement(ProgressTrack, { label: "이미지", status: g.tracks.image.status, pct: g.tracks.image.pct, detail: g.tracks.image.label }),
```

- [ ] **Step 5: `ReviewScreen.tsx:43` meta state 타입**

```ts
// Before
const [meta, setMeta] = useState<{ image?: AssetMeta; video?: AssetMeta }>({});

// After
const [meta, setMeta] = useState<{ image?: AssetMeta }>({});
```

- [ ] **Step 6: `ReviewScreen.tsx:49-58` useEffect — getAssetMeta video 제거**

```ts
// Before
useEffect(() => {
  if (!currentVariant) return;
  let cancelled = false;
  void Promise.all([
    getAssetMeta(currentVariant.imageLocalPath),
    getAssetMeta(currentVariant.videoLocalPath),
  ]).then(([image, video]) => { if (!cancelled) setMeta({ image, video }); })
    .catch(() => {});
  return () => { cancelled = true; };
}, [currentVariant?.imageLocalPath, currentVariant?.videoLocalPath]);

// After
useEffect(() => {
  if (!currentVariant) return;
  let cancelled = false;
  void getAssetMeta(currentVariant.imageLocalPath)
    .then((image) => { if (!cancelled) setMeta({ image }); })
    .catch(() => {});
  return () => { cancelled = true; };
}, [currentVariant?.imageLocalPath]);
```

- [ ] **Step 7: `ReviewScreen.tsx:152-159` 렌더링 — "영상(공유)" + meta.video 블록 제거**

```tsx
// Before
<Text dimColor>이미지(공유): {currentVariant.imageLocalPath}</Text>
<Text dimColor>영상(공유): {currentVariant.videoLocalPath}</Text>
<Text>헤드라인: {currentVariant.copy.headline}</Text>
...
{meta.image && (
  <Text>image: {meta.image.width}×{meta.image.height} {meta.image.format} {Math.round(meta.image.sizeBytes / 1000)}KB</Text>
)}
{meta.video && (
  <Text>video: {meta.video.format} {Math.round(meta.video.sizeBytes / 1000)}KB</Text>
)}

// After (영상 line + meta.video block 제거)
<Text dimColor>이미지(공유): {currentVariant.imageLocalPath}</Text>
<Text>헤드라인: {currentVariant.copy.headline}</Text>
...
{meta.image && (
  <Text>image: {meta.image.width}×{meta.image.height} {meta.image.format} {Math.round(meta.image.sizeBytes / 1000)}KB</Text>
)}
```

- [ ] **Step 8: `PipelineScreen.tsx:25-31` — videoPct 변수 + genSummary 의 videos 부분 제거**

```ts
// Before
if (gp) {
  const doneCount = gp.queue.filter((s) => s === "done").length;
  const total = gp.queue.length;
  const copyPct = gp.tracks.copy.pct;
  const imagePct = gp.tracks.image.pct;
  const videoPct = gp.tracks.video.pct;
  genSummary = `gen: copies ${Math.round(copyPct)}/${100} | images ${Math.round(imagePct)}/${100} | videos ${Math.round(videoPct)}/${100}  [${doneCount}/${total}]`;
}

// After
if (gp) {
  const doneCount = gp.queue.filter((s) => s === "done").length;
  const total = gp.queue.length;
  const copyPct = gp.tracks.copy.pct;
  const imagePct = gp.tracks.image.pct;
  genSummary = `gen: copies ${Math.round(copyPct)}/${100} | images ${Math.round(imagePct)}/${100}  [${doneCount}/${total}]`;
}
```

### Task 1.6: server/index.ts — videoJob/aiVideo 관련 라인 제거

**Files:**
- Modify: `packages/server/src/index.ts:11, 16, 43-46, 85, 90-92`

server/ 미실행이지만 코드 sync 위해 정리. videoJob.ts / aiVideo.ts 파일 삭제는 Commit 2 에서 — 먼저 import + 사용 라인 제거.

- [ ] **Step 1: import 제거 (line 11, 16)**

```ts
// Before
import { createAiVideoRouter } from "./routes/aiVideo.js";
...
import { cleanupOldFiles } from "./jobs/videoJob.js";

// After (두 라인 제거)
```

- [ ] **Step 2: video downloads static file serving 블록 제거 (line 43-46)**

```ts
// Before
// Static file serving for video downloads
const tmpDir = "server/tmp";
if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
app.use("/files", express.static(tmpDir));

// After (블록 전체 제거)
```

이로 인해 `existsSync`, `mkdirSync` 가 다른 곳에서 사용되지 않으면 import 도 제거. line 2 의 `import { existsSync, mkdirSync } from "fs"` — server/index.ts 내 다른 사용처 검증:

```bash
grep -n "existsSync\|mkdirSync" packages/server/src/index.ts
```

위 grep 이 line 2 import 외 다른 결과 0이면 import 도 제거.

- [ ] **Step 3: createAiVideoRouter mount 제거 (line 85)**

```ts
// Before
app.use(createAiCopyRouter(billing));
app.use(createAiImageRouter(billing));
app.use(createAiVideoRouter(billing, SERVER_URL));
app.use(createAiParseRouter(billing));

// After
app.use(createAiCopyRouter(billing));
app.use(createAiImageRouter(billing));
app.use(createAiParseRouter(billing));
```

- [ ] **Step 4: cleanup setInterval + 호출 제거 (line 90-92)**

```ts
// Before
// Cleanup old video files
setInterval(cleanupOldFiles, 60 * 60 * 1000);
cleanupOldFiles();

// After (3 라인 + 주석 제거)
```

또한 `SERVER_URL` 이 다른 곳에서 사용 안 되면 `const SERVER_URL = ...` 도 제거 가능. grep 으로 확인:

```bash
grep -n "SERVER_URL" packages/server/src/index.ts
```

line 21 외 사용처 0이면 제거.

### Task 1.7: 17 fixture 갱신 — videoLocalPath 키 제거

**Files** (9 파일, 17 위치):

- [ ] **Step 1: `packages/core/src/types.test.ts:52` Creative literal — videoLocalPath 라인 제거**

```ts
// Before (line ~50-55)
const c: Creative = {
  ...
  imageLocalPath: "/tmp/i.png",
  videoLocalPath: "/tmp/v.mp4",
  status: "pending",
  ...
};

// After (videoLocalPath 라인 제거)
const c: Creative = {
  ...
  imageLocalPath: "/tmp/i.png",
  status: "pending",
  ...
};
```

- [ ] **Step 2: `packages/core/src/reviewer/decisions.test.ts:21` — 동일**

`videoLocalPath: "data/creatives/product-1-video.mp4"` 라인 제거.

- [ ] **Step 3: `packages/core/src/launch/groupApproval.test.ts:27` — 동일**

`videoLocalPath: "/tmp/v.mp4"` 라인 제거.

- [ ] **Step 4: `packages/core/src/platform/meta/breakdown.test.ts:14` — 동일**

`imageLocalPath: "", videoLocalPath: "",` → `imageLocalPath: "",` (videoLocalPath 단어만 제거)

- [ ] **Step 5: `packages/core/src/platform/meta/assetFeedSpec.test.ts:25, 99, 141` — 3 위치**

각 위치에서 `videoLocalPath: "/tmp/v.mp4"` 또는 `videoLocalPath: "/tmp/a.mp4"` 라인 제거.

- [ ] **Step 6: `packages/core/src/rag/qualifyJob.test.ts:29` — 동일**

`videoLocalPath: "/tmp/a.mp4"` 라인 제거.

- [ ] **Step 7: `packages/core/src/rag/qualifier.test.ts:185` — 동일**

`imageLocalPath: "/tmp/a.jpg", videoLocalPath: "/tmp/a.mp4",` → `imageLocalPath: "/tmp/a.jpg",`

- [ ] **Step 8: `packages/cli/src/actions.test.ts:244, 264, 269, 298, 303` — 5 위치**

mock 안 inline Creative literal 의 `videoLocalPath: "v"` 또는 `imageLocalPath: "i", videoLocalPath: "v"` 의 video 부분 제거.

- [ ] **Step 9: `packages/cli/src/tui/screens/ReviewScreen.test.tsx:21` — 동일**

`imageLocalPath: "img.jpg", videoLocalPath: "vid.mp4",` → `imageLocalPath: "img.jpg",`

### Task 1.8: 3 위치 TaskProgress fixture 갱신 + buildOverallProgress test 갱신

**Files:**
- Modify: `packages/cli/src/actions.test.ts:5-19` (3 케이스)

- [ ] **Step 1: line 7 — `{ copy: 0, image: 0, video: 0 }` 갱신**

```ts
// Before
it("returns 0 when all tasks are 0", () => {
  const p: TaskProgress = { copy: 0, image: 0, video: 0 };
  expect(buildOverallProgress(p)).toBe(0);
});

// After
it("returns 0 when all tasks are 0", () => {
  const p: TaskProgress = { copy: 0, image: 0 };
  expect(buildOverallProgress(p)).toBe(0);
});
```

- [ ] **Step 2: line 12 — 동일 패턴**

```ts
// Before
it("returns 100 when all tasks are 100", () => {
  const p: TaskProgress = { copy: 100, image: 100, video: 100 };
  expect(buildOverallProgress(p)).toBe(100);
});

// After
it("returns 100 when all tasks are 100", () => {
  const p: TaskProgress = { copy: 100, image: 100 };
  expect(buildOverallProgress(p)).toBe(100);
});
```

- [ ] **Step 3: line 17 — 평균 분모 3→2 반영, expect 값 50→75**

```ts
// Before
it("averages the three task percentages", () => {
  const p: TaskProgress = { copy: 100, image: 50, video: 0 };
  expect(buildOverallProgress(p)).toBe(50);
});

// After
it("averages the two task percentages", () => {
  const p: TaskProgress = { copy: 100, image: 50 };
  expect(buildOverallProgress(p)).toBe(75);
});
```

### Task 1.9: assetFeedSpec.test.ts — videoId / videos 제거

**Files:**
- Modify: `packages/core/src/platform/meta/assetFeedSpec.test.ts:31, 37, 44, 55, 68, 111, 152`

- [ ] **Step 1: line 31 — 테스트 description 갱신**

```ts
// Before
it("assembles a spec with 1 title, N bodies, 1 image, 1 video", () => {

// After
it("assembles a spec with 1 title, N bodies, 1 image", () => {
```

- [ ] **Step 2: line 37 — `videoId: "VID_ID_123"` 제거 (assembleAssetFeedSpec 호출 매개변수)**

해당 호출의 `videoId: "VID_ID_123"` 라인 제거.

- [ ] **Step 3: line 44 — `videos` assertion 제거**

```ts
// Before
expect(spec.videos).toEqual([{ video_id: "VID_ID_123" }]);

// After (라인 전체 제거)
```

- [ ] **Step 4: line 55, 68, 111, 152 — `videoId: "VID"` 또는 `"v"` 매개변수 제거**

각 `assembleAssetFeedSpec({ ..., videoId: ... })` 호출에서 videoId 라인 제거.

### Task 1.10: ReviewScreen.test.tsx — fixture 검증

이미 Task 1.7 Step 9 에서 fixture 의 `videoLocalPath` 제거됨. 추가 작업: 신규 fixture 의 다른 사용 검증.

- [ ] **Step 1: 테스트 실행**

```bash
npx vitest run packages/cli/src/tui/screens/ReviewScreen.test.tsx 2>&1 | tail -10
```

Expected: 5 케이스 모두 passing (이전 Esc/q 핸들러 fix 부분 + 신규 fixture).

만약 영상 관련 추가 assertion 있으면 (예: `expect(f).toContain("영상")`) — 제거.

### Task 1.11: 전체 테스트 + TS check + grep verification

- [ ] **Step 1: TypeScript clean**

```bash
npx tsc --noEmit -p packages/core/tsconfig.json 2>&1 | grep -v "facebook-nodejs\|TS7016" | head
npx tsc --noEmit -p packages/cli/tsconfig.json 2>&1 | grep -v "facebook-nodejs\|TS7016" | head
npx tsc --noEmit -p packages/server/tsconfig.json 2>&1 | grep -v "facebook-nodejs\|TS7016" | head
```

Expected: 0 errors after filter.

- [ ] **Step 2: 전체 테스트**

```bash
npm test 2>&1 | tail -3
```

Expected: ~447 passing + 1 useReports flake (460 - 12 video.test 미삭제 상태에서 일부만 영향. 정확한 수치는 측정).

video.test.ts 는 아직 존재 — Commit 2 에서 삭제. 이 시점은 video.test.ts 가 import 한 generateVideo 가 여전히 존재하므로 (creative/video.ts 존재) test 통과해야 함.

만약 video.test.ts 의 fetchVeoVideoData 같은 함수가 Creative 타입 사용한다면 — 본 spec 의 type 변경에 영향 받음. 확인:

```bash
grep -n "Creative\b" packages/core/src/creative/video.test.ts
```

만약 결과 있으면 video.test.ts 도 임시 갱신 필요. 결과 0이면 Commit 1 통과.

- [ ] **Step 3: grep verification**

```bash
grep -rn "videoLocalPath" packages/ --include="*.ts" --include="*.tsx" | wc -l
```

Expected: 0 hits in production. 단 video.ts / video.test.ts / videoJob.ts / aiVideo.ts 안에 잔존 가능 (Commit 2 에서 삭제).

```bash
grep -rn "tracks\.video\|TaskProgress.*video\|GenerateProgress.*video\|assets\.video" packages/ --include="*.ts" --include="*.tsx" | wc -l
```

Expected: 0 hits.

```bash
grep -rn "uploadVideo\|videoId" packages/ --include="*.ts" --include="*.tsx" | grep -v "\.test\." | wc -l
```

Expected: 0 hits in production. test 안 일부 잔존 가능 — 이번 commit 의 fixture 갱신에서 모두 제거됐는지 verify.

### Task 1.12: STATUS.md 갱신 + commit

- [ ] **Step 1: STATUS.md 갱신**

`docs/STATUS.md` line 3 "마지막 업데이트" 를 `2026-04-28` 로 갱신.

`## 최근 변경 이력` 섹션 맨 위에 신규 entry 추가:

```markdown
- 2026-04-28 refactor(remove video): 영상 트랙 제거 — Veo / video.ts / videoJob.ts / aiVideo.ts 완전 삭제, Creative.videoLocalPath / VariantGroup.assets.video / AssetFeedSpec.videos 필드 제거. 광고 자동화 = image + copy 만으로 단순화. 사용자 의도 (AI 영상 미도입 + 영상 데이터 자체 미취급) 반영. 17 fixture 갱신 + 4 파일 삭제 (Commit 2 에서). Meta DCO image-only 정상 게재 — Reels placement 운영 verify 필요 (R-G1).
```

`## 알려진 결함 / 미구현 이슈` 섹션에 R-G1 신규 등록:

```markdown
- **R-G1** Meta DCO image-only Reels placement 게재 verify (2026-04-28, 영상 트랙 제거 commit) — 첫 실 launch 후 placement breakdown 확인. 만약 Reels 가 0 impression 이면 Meta DCO 가 image 만 으로 Reels 게재 거부 가능 → asset_feed_spec.placement_asset_customization 추가 검토. 운영 1주 후 판단.
```

R-E2 / R-E4 / R-F4 는 Commit 2 에서 갱신 (video.ts 삭제 후).

- [ ] **Step 2: 명시적 add (NEVER -A)**

```bash
git add packages/core/src/types.ts \
  packages/core/src/types.test.ts \
  packages/core/src/platform/types.ts \
  packages/core/src/platform/meta/assetFeedSpec.ts \
  packages/core/src/platform/meta/assetFeedSpec.test.ts \
  packages/core/src/platform/meta/launcher.ts \
  packages/core/src/platform/meta/breakdown.test.ts \
  packages/core/src/reviewer/decisions.test.ts \
  packages/core/src/launch/groupApproval.test.ts \
  packages/core/src/rag/qualifyJob.test.ts \
  packages/core/src/rag/qualifier.test.ts \
  packages/cli/src/actions.ts \
  packages/cli/src/actions.test.ts \
  packages/cli/src/pipeline.ts \
  packages/cli/src/entries/generate.ts \
  packages/cli/src/entries/launch.ts \
  packages/cli/src/tui/AppTypes.ts \
  packages/cli/src/tui/screens/ReviewScreen.tsx \
  packages/cli/src/tui/screens/ReviewScreen.test.tsx \
  packages/cli/src/tui/screens/GenerateScreen.tsx \
  packages/cli/src/tui/screens/PipelineScreen.tsx \
  packages/server/src/index.ts \
  docs/STATUS.md
```

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
refactor(remove video): type-level removal + production code (Commit 1/2)

영상 트랙을 코드베이스에서 완전 제거 — 사용자 의도 (AI 영상 미도입 + 영상
데이터 자체 미취급) 반영. 광고 자동화 = image + copy 만으로 단순화.

타입 변경 (atomic cascade):
- Creative.videoLocalPath 필드 제거
- VariantGroup.assets.video 키 제거
- AssetFeedSpec.videos / AssetFeedSpecInput.videoId 제거
- TaskProgress.video / GenerateProgress.tracks.video 제거

Production 코드:
- meta/launcher.ts: uploadVideo 함수 + 호출 + /act/advideos onLog 제거
- meta/assetFeedSpec.ts: videos 출력 + videoId 매개변수 제거
- actions.ts:runGenerate: videoTask + Promise.allSettled 의 video track 제거
- actions.ts:runLaunch: assets.video 제거
- actions.ts:buildOverallProgress: 분모 3→2
- pipeline.ts / entries/generate.ts / entries/launch.ts: video 호출 + literal 정리
- AppTypes.ts: TaskProgress + GenerateProgress.tracks 의 video 키 제거
- GenerateScreen / PipelineScreen / ReviewScreen: 영상 표시 제거
- server/src/index.ts: createAiVideoRouter / cleanupOldFiles / static serving / setInterval 제거 (server 미실행이지만 sync)

테스트:
- 17 fixture 위치 (9 파일) videoLocalPath / TaskProgress.video 제거
- assetFeedSpec.test.ts: videoId 매개변수 5 위치 + videos assertion + description 갱신
- actions.test.ts: buildOverallProgress 의 평균 분모 3→2 (expect 50→75)

video.ts / videoJob.ts / aiVideo.ts 파일 삭제 + STATUS R-E2/R-E4/R-F4 정리는 Commit 2 에서 별 처리 (Commit 1 land 후 dead code 됨).

Spec: docs/superpowers/specs/2026-04-28-remove-video-track-design.md

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Final verification**

```bash
git log --oneline -3
npm test 2>&1 | tail -3
```

Expected: HEAD = Commit 1, ~447 tests passing + 1 useReports flake.

### Task 1.13: meta-platform-expert 검토 (Commit 1)

CLAUDE.md "Subagent 호출 규칙" — `packages/core/src/platform/meta/launcher.ts` 수정 → meta-platform-expert 트리거.

- [ ] **Step 1: meta-platform-expert 호출**

`Agent` 도구로 `meta-platform-expert` 호출. 컨텍스트:

```
Commit 1 변경 검토 요청 — Meta DCO 흐름에서 video 자산 제거.

변경된 platform/meta 파일:
- packages/core/src/platform/meta/launcher.ts: uploadVideo 함수 (line 85-92) 제거 + 호출처 (line 141-142) 제거 + assembleAssetFeedSpec 호출에서 videoId 매개변수 제거
- packages/core/src/platform/meta/assetFeedSpec.ts: AssetFeedSpec interface 의 videos 필드 + AssetFeedSpecInput.videoId 제거 + assembleAssetFeedSpec 본체에서 videos 출력 라인 제거
- packages/core/src/platform/meta/assetFeedSpec.test.ts: videoId 매개변수 5 위치 + videos assertion 1 위치 + description 갱신

검증 포인트:
1. Meta API 의 asset_feed_spec.videos 가 image-only DCO 광고에서 진짜 omit 가능한가? (interface 문서 + Marketing API 스펙 v18+ 기준)
2. uploadVideo 제거 후 광고 게재 흐름 (campaign → adset → adcreative → ad) 무결성 유지
3. /act/advideos onLog entry 제거가 LaunchScreen 4-step regex 진행 표시에 영향 없음을 verify (LaunchScreen STEPS regex: campaigns/adsets/adcreative/ads)
4. Meta DCO 가 image 만 으로 모든 placement (Feed/Stories/Reels) 정상 게재되는지 — 첫 실 launch 시 placement breakdown 확인 필요 (R-G1 등록됨)
5. classifyMetaError 등 video 업로드 실패 처리 코드가 있다면 dead 됨 — 검토

BASE_SHA: bba1c94 (spec commit)
HEAD_SHA: <Commit 1 SHA>
```

- [ ] **Step 2: 발견 이슈 처리**

Critical / Important: 즉시 수정 후 재검토 (별 fixup commit). Minor: STATUS.md R-G 그룹 추가 또는 수용.

### Task 1.14: code-reviewer 검토 (Commit 1)

- [ ] **Step 1: superpowers:code-reviewer 호출**

`Agent` 도구로 `superpowers:code-reviewer`. 컨텍스트:

```
WHAT_WAS_IMPLEMENTED: spec §4 (Tasks 1.1-1.10 — type cascade + production 코드 변경)
PLAN_OR_REQUIREMENTS: 본 plan Tasks 1.1-1.12
BASE_SHA: bba1c94
HEAD_SHA: <Commit 1 SHA>

검증 포인트:
- 타입 변경 정확 (Creative / VariantGroup / AssetFeedSpec / TaskProgress / GenerateProgress)
- 호출처 cascade 모두 fix (production + 17 fixture + assetFeedSpec.test.ts)
- runGenerate 의 부분 실패 cleanup 단순화 (image 만)
- buildOverallProgress 분모 변경 + 테스트 expected 값 일관 (50→75)
- LaunchScreen 의 STEPS regex 변경 없음 (정정 명시)
- server/index.ts 정리 — videoJob / aiVideo import 모두 제거
- TypeScript 0 errors after filter
- video.ts / videoJob.ts / aiVideo.ts 파일은 dead code 상태 (import 안 되지만 파일 존재) — Commit 2 에서 삭제 예정
- meta-platform-expert 가 검증한 항목 + 미해결 이슈
- STATUS R-G1 등록
```

- [ ] **Step 2: 발견 이슈 처리**

---

## Commit 2: Veo dead code 삭제 + STATUS/ROADMAP 정리

### Task 2.1: 4 파일 삭제

**Files (삭제):**
- `packages/core/src/creative/video.ts`
- `packages/core/src/creative/video.test.ts`
- `packages/server/src/jobs/videoJob.ts`
- `packages/server/src/routes/aiVideo.ts`

- [ ] **Step 1: 4 파일 삭제**

```bash
git rm packages/core/src/creative/video.ts \
  packages/core/src/creative/video.test.ts \
  packages/server/src/jobs/videoJob.ts \
  packages/server/src/routes/aiVideo.ts
```

- [ ] **Step 2: TypeScript check (이 시점은 fail 예상 — modelDiscovery.ts 와 vitest.setup.ts 가 video 관련 export 사용 중)**

```bash
npx tsc --noEmit -p packages/core/tsconfig.json 2>&1 | grep -v "facebook-nodejs\|TS7016" | head -20
```

Expected: discoverVideoModel / setModelOverrideForTesting 의 video 매개변수 미참조 에러 — Task 2.2/2.3/2.4 에서 fix.

### Task 2.2: `modelDiscovery.ts` cleanup

**Files:**
- Modify: `packages/core/src/creative/modelDiscovery.ts:13-130` (전체 정리)

- [ ] **Step 1: video 관련 변수 + 함수 + signature 제거**

```ts
// Before (line 13-18)
let cachedModels: GoogleModel[] | null = null;
let pendingFetch: Promise<GoogleModel[]> | null = null;
let cachedImageModel: string | null = null;
let cachedVideoModel: string | null = null;
let imageOverride: string | null = null;
let videoOverride: string | null = null;

// After
let cachedModels: GoogleModel[] | null = null;
let pendingFetch: Promise<GoogleModel[]> | null = null;
let cachedImageModel: string | null = null;
let imageOverride: string | null = null;
```

- [ ] **Step 2: discoverVideoModel 함수 (line 100-114) 전체 제거**

```ts
export async function discoverVideoModel(): Promise<string> {
  if (videoOverride) return videoOverride;
  if (cachedVideoModel) return cachedVideoModel;
  const models = await fetchModels();
  const picked = pickBestByName(models, "veo", "predictLongRunning");
  if (!picked) {
    throw new Error(...);
  }
  cachedVideoModel = picked;
  return picked;
}
```

- [ ] **Step 3: setModelOverrideForTesting / clearModelDiscoveryCache signature 변경 (line 117-130)**

```ts
// Before
export function setModelOverrideForTesting(opts: { image?: string | null; video?: string | null }): void {
  if (opts.image !== undefined) imageOverride = opts.image;
  if (opts.video !== undefined) videoOverride = opts.video;
}

export function clearModelDiscoveryCache(): void {
  cachedModels = null;
  pendingFetch = null;
  cachedImageModel = null;
  cachedVideoModel = null;
  imageOverride = null;
  videoOverride = null;
}

// After
export function setModelOverrideForTesting(opts: { image?: string | null }): void {
  if (opts.image !== undefined) imageOverride = opts.image;
}

export function clearModelDiscoveryCache(): void {
  cachedModels = null;
  pendingFetch = null;
  cachedImageModel = null;
  imageOverride = null;
}
```

### Task 2.3: `modelDiscovery.test.ts` — video 케이스 제거

**Files:**
- Modify: `packages/core/src/creative/modelDiscovery.test.ts`

- [ ] **Step 1: 다음 test 케이스 3개 제거**

```ts
// 제거 대상 1: "picks veo predictLongRunning best candidate"
it("picks veo predictLongRunning best candidate", async () => { ... });

// 제거 대상 2: "throws actionable error when no veo models in API response"
it("throws actionable error when no veo models in API response", async () => { ... });

// 제거 대상 3: "concurrent calls share a single in-flight fetch" (video 호출 포함된 부분)
// 이 케이스는 image+video 동시 호출 검증 — image 만 4 동시 호출로 축소
```

- [ ] **Step 2: 동시성 케이스 image-only 로 축소**

```ts
// Before
it("concurrent calls share a single in-flight fetch", async () => {
  setModelOverrideForTesting({ image: null, video: null });
  let fetchCount = 0;
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    fetchCount++;
    await new Promise((r) => setTimeout(r, 10));
    return new Response(
      JSON.stringify({
        models: [
          { name: "models/imagen-4.0-generate-001", supportedGenerationMethods: ["predict"] },
          { name: "models/veo-3.0-generate-001", supportedGenerationMethods: ["predictLongRunning"] },
        ],
      }),
      { status: 200 },
    );
  });

  const [a, b, c, d] = await Promise.all([
    discoverImageModel(),
    discoverImageModel(),
    discoverVideoModel(),
    discoverVideoModel(),
  ]);
  expect(a).toBe("imagen-4.0-generate-001");
  expect(b).toBe("imagen-4.0-generate-001");
  expect(c).toBe("veo-3.0-generate-001");
  expect(d).toBe("veo-3.0-generate-001");
  expect(fetchCount).toBe(1);
  fetchSpy.mockRestore();
});

// After
it("concurrent calls share a single in-flight fetch", async () => {
  setModelOverrideForTesting({ image: null });
  let fetchCount = 0;
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    fetchCount++;
    await new Promise((r) => setTimeout(r, 10));
    return new Response(
      JSON.stringify({
        models: [
          { name: "models/imagen-4.0-generate-001", supportedGenerationMethods: ["predict"] },
        ],
      }),
      { status: 200 },
    );
  });

  const [a, b, c, d] = await Promise.all([
    discoverImageModel(),
    discoverImageModel(),
    discoverImageModel(),
    discoverImageModel(),
  ]);
  expect(a).toBe("imagen-4.0-generate-001");
  expect(b).toBe("imagen-4.0-generate-001");
  expect(c).toBe("imagen-4.0-generate-001");
  expect(d).toBe("imagen-4.0-generate-001");
  expect(fetchCount).toBe(1);
  fetchSpy.mockRestore();
});
```

- [ ] **Step 3: 다른 케이스의 `setModelOverrideForTesting({ image: null, video: null })` → `{ image: null }` 만**

3-4 위치 grep 으로 검색 + 일괄 변경:

```bash
grep -n "setModelOverrideForTesting" packages/core/src/creative/modelDiscovery.test.ts
```

각 호출 결과에서 video 매개변수 제거.

- [ ] **Step 4: 테스트 실행**

```bash
npx vitest run packages/core/src/creative/modelDiscovery.test.ts 2>&1 | tail -5
```

Expected: 7 케이스 passing (10 - 3 removed).

### Task 2.4: vitest.setup.ts — video override 제거

**Files:**
- Modify: `vitest.setup.ts:5, 11, 16`

- [ ] **Step 1: video override 제거**

```ts
// Before (line 5)
import { setModelOverrideForTesting, clearModelDiscoveryCache } from "./packages/core/src/creative/modelDiscovery.js";

beforeEach(() => {
  setConfigForTesting(makeTestConfig());
  setPromptsForTesting(null);
  setPromptsPathForTesting(null);
  // 자동 모델 디스커버리는 네트워크 호출이라 테스트에서 차단 — 스텁 ID 주입
  setModelOverrideForTesting({ image: "test-imagen", video: "test-veo" });
});

// After
import { setModelOverrideForTesting, clearModelDiscoveryCache } from "./packages/core/src/creative/modelDiscovery.js";

beforeEach(() => {
  setConfigForTesting(makeTestConfig());
  setPromptsForTesting(null);
  setPromptsPathForTesting(null);
  // 자동 모델 디스커버리는 네트워크 호출이라 테스트에서 차단 — 스텁 ID 주입
  setModelOverrideForTesting({ image: "test-imagen" });
});
```

### Task 2.5: listModels.ts — video 부분 제거

**Files:**
- Modify: `packages/cli/src/entries/listModels.ts:67, 75-91`

- [ ] **Step 1: 출력 분류 헬퍼 (line 67) — `[video]` 라벨 제거**

```ts
// Before
const flag = m.name?.includes("imagen") ? " [image]" :
             m.name?.includes("veo") ? " [video]" :
             m.name?.includes("gemini") ? " [text/multi]" : "";

// After
const flag = m.name?.includes("imagen") ? " [image]" :
             m.name?.includes("gemini") ? " [text/multi]" : "";
```

- [ ] **Step 2: veo 후보 추천 블록 (line 75-91) 제거**

```ts
// Before
const imagenCandidate = pickFirst(models, "imagen", "predict") ?? pickFirst(models, "imagen");
const veoCandidate = pickFirst(models, "veo");

if (imagenCandidate) {
  const imagenAll = models.filter((m) => (m.name ?? "").includes("imagen"));
  console.log(`image = "${shortName(imagenCandidate)}"  # 후보: ${imagenAll.map(shortName).join(", ")}`);
} else {
  console.log("# image: 가용 imagen 모델 없음 — Google AI Studio 콘솔에서 권한 확인 필요");
}

if (veoCandidate) {
  const veoAll = models.filter((m) => (m.name ?? "").includes("veo"));
  console.log(`video = "${shortName(veoCandidate)}"  # 후보: ${veoAll.map(shortName).join(", ")}`);
} else {
  console.log("# video: 가용 veo 모델 없음 — Google AI Studio 콘솔에서 권한 확인 필요");
}

// After
const imagenCandidate = pickFirst(models, "imagen", "predict") ?? pickFirst(models, "imagen");

if (imagenCandidate) {
  const imagenAll = models.filter((m) => (m.name ?? "").includes("imagen"));
  console.log(`image = "${shortName(imagenCandidate)}"  # 후보: ${imagenAll.map(shortName).join(", ")}`);
} else {
  console.log("# image: 가용 imagen 모델 없음 — Google AI Studio 콘솔에서 권한 확인 필요");
}
```

### Task 2.6: STATUS.md + ROADMAP.md 정리

**Files:**
- Modify: `docs/STATUS.md` (R-E2 제거 / R-E4-R-F4 narrow / 변경 이력)
- Modify: `docs/ROADMAP.md` (Tier 3 영상 모니터링 항목 제거)

- [ ] **Step 1: `docs/STATUS.md` R-E 그룹 정리**

R-E2 (polling-loop wall-clock budget) 항목 전체 제거 — video.ts 삭제로 dead.

R-E4 (통합 테스트 부재) — 텍스트 좁힘:

```markdown
// Before
- **R-E4** retry helper 통합 테스트 부재 — `image.ts`/`video.ts`/`videoJob.ts`/`aiImage.ts` 의 6 wrap 호출처가 retry 가 실제 fire 됨을 검증하는 테스트 없음 ...

// After
- **R-E4** retry helper 통합 테스트 부재 — `image.ts`/`aiImage.ts` 의 wrap 호출처가 retry 가 실제 fire 됨을 검증하는 테스트 없음 (helper 자체는 11 케이스). pure pass-through 라 회귀 위험 낮음. 추후 site 별 smoke test 1개씩 추가 검토.
```

R-F4 (Google 모델 auto-discovery) — 텍스트 좁힘 (image 만 언급):

```markdown
// Before
- **R-F4** Google 모델 auto-discovery — ... discoverImageModel() / discoverVideoModel() ... image.ts/video.ts/videoJob.ts/aiImage.ts 가 ...

// After
- **R-F4** Google 모델 auto-discovery — ... discoverImageModel() ... image.ts/aiImage.ts 가 await discoverImageModel() 사용 ... (video 제거)
```

`최근 변경 이력` 섹션 맨 위에 신규 entry 추가 (Commit 2 SHA 는 commit 후 채움):

```markdown
- 2026-04-28 chore(remove video): Veo dead code 파일 삭제 (Commit 2/2) — creative/video.ts / creative/video.test.ts / server/jobs/videoJob.ts / server/routes/aiVideo.ts 삭제. modelDiscovery.ts 의 discoverVideoModel + override + cache 제거. listModels.ts 의 video 후보 출력 제거. STATUS R-E2 제거, R-E4/R-F4 narrow.
```

- [ ] **Step 2: `docs/ROADMAP.md` — Tier 3 의 "영상 생성 실패율 모니터링" 항목 제거**

```markdown
// Before (Tier 2 또는 Tier 3 어딘가)
- 영상 생성 실패율 모니터링 및 알림

// After (라인 제거)
```

grep 으로 위치 확인:

```bash
grep -n "영상 생성 실패\|영상 모니터" docs/ROADMAP.md
```

발견된 라인 제거.

### Task 2.7: 전체 테스트 + grep + commit

- [ ] **Step 1: TypeScript clean**

```bash
npx tsc --noEmit -p packages/core/tsconfig.json 2>&1 | grep -v "facebook-nodejs\|TS7016" | head
npx tsc --noEmit -p packages/cli/tsconfig.json 2>&1 | grep -v "facebook-nodejs\|TS7016" | head
npx tsc --noEmit -p packages/server/tsconfig.json 2>&1 | grep -v "facebook-nodejs\|TS7016" | head
```

Expected: 0 errors after filter.

- [ ] **Step 2: 전체 테스트**

```bash
npm test 2>&1 | tail -3
```

Expected: ~444 passing + 1 useReports flake. (Commit 1 후 ~447 - 12 video.test 삭제 - 3 modelDiscovery video 케이스 = ~432, but 일부 fixture/assertion 갱신으로 net ~444).

- [ ] **Step 3: grep verification**

```bash
grep -rn "videoLocalPath\|generateVideo\|videoJob\|fetchVeoVideoData\|discoverVideoModel\|aiVideo" packages/ --include="*.ts" --include="*.tsx" | wc -l
```

Expected: 0 hits.

```bash
grep -rn "tracks\.video\|TaskProgress.*video\|GenerateProgress.*video\|assets\.video\|videoBytes\|veo\b" packages/ --include="*.ts" --include="*.tsx" | wc -l
```

Expected: 0 hits.

- [ ] **Step 4: 명시적 add**

```bash
git add packages/core/src/creative/modelDiscovery.ts \
  packages/core/src/creative/modelDiscovery.test.ts \
  packages/cli/src/entries/listModels.ts \
  vitest.setup.ts \
  docs/STATUS.md \
  docs/ROADMAP.md
```

git rm 로 처리한 4 삭제 파일은 이미 stage 됨 (Task 2.1 Step 1).

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
chore(remove video): delete Veo dead code + STATUS/ROADMAP cleanup (Commit 2/2)

Commit 1 후 dead 된 video 관련 파일 삭제 + 부수 정리.

삭제 (4 파일):
- packages/core/src/creative/video.ts
- packages/core/src/creative/video.test.ts
- packages/server/src/jobs/videoJob.ts
- packages/server/src/routes/aiVideo.ts

modelDiscovery.ts 정리:
- discoverVideoModel() 함수 + cachedVideoModel + videoOverride 변수 제거
- setModelOverrideForTesting signature 의 video 매개변수 제거
- clearModelDiscoveryCache 의 video 캐시 reset 제거

modelDiscovery.test.ts 정리:
- veo 전용 케이스 3개 제거 (predictLongRunning best / 가용 veo 없음 / 동시 호출의 video 부분)
- 동시성 케이스를 image-only 4 호출로 축소

vitest.setup.ts: setModelOverrideForTesting 의 video 키 제거

listModels.ts: veo 후보 추천 출력 + [video] 라벨 제거

문서:
- docs/STATUS.md: R-E2 (polling wall-clock budget) 제거 — video.ts 삭제로 dead. R-E4/R-F4 narrow (image 만 언급).
- docs/ROADMAP.md: Tier 3 의 "영상 생성 실패율 모니터링" 항목 제거.

테스트: ~444 passing + 1 useReports flake.

Spec: docs/superpowers/specs/2026-04-28-remove-video-track-design.md

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Final verification**

```bash
git log --oneline -5
npm test 2>&1 | tail -3
ls packages/core/src/creative/video.ts 2>&1     # Expected: not found
ls packages/server/src/jobs/videoJob.ts 2>&1    # Expected: not found
ls packages/server/src/routes/aiVideo.ts 2>&1   # Expected: not found
```

### Task 2.8: code-reviewer 검토 (Commit 2)

- [ ] **Step 1: superpowers:code-reviewer 호출**

`Agent` 도구로 `superpowers:code-reviewer`. 컨텍스트:

```
WHAT_WAS_IMPLEMENTED: spec §3 (Veo 코드 삭제) + spec §4.15-§4.20 (modelDiscovery / vitest.setup / listModels / 삭제 파일들) + STATUS/ROADMAP 정리
PLAN_OR_REQUIREMENTS: 본 plan Tasks 2.1-2.7
BASE_SHA: <Commit 1 SHA>
HEAD_SHA: <Commit 2 SHA>

검증 포인트:
- 4 파일 삭제 정확 (video.ts / video.test.ts / videoJob.ts / aiVideo.ts)
- modelDiscovery.ts 의 video 관련 변수/함수/signature 모두 제거 — image 처리 동작 보존
- modelDiscovery.test.ts 의 video 케이스 3개 제거 + 동시성 케이스 image-only 축소
- vitest.setup.ts video 키 제거
- listModels.ts video 추천 + 라벨 제거 — image 부분 동작 보존
- STATUS.md R-E2 제거 / R-E4-R-F4 narrow / 신규 변경 이력
- ROADMAP.md Tier 3 영상 모니터링 항목 제거
- TypeScript 0 errors after filter
- grep verification (videoLocalPath / generateVideo / videoJob / discoverVideoModel / aiVideo / tracks.video / videoBytes / veo) 모두 0 hits
- 테스트 통과 + delta 합리
```

- [ ] **Step 2: 발견 이슈 처리**

---

## 완료 조건 (Definition of Done)

- [ ] 2 commits land (Commit 1 + Commit 2 logical units; meta-platform-expert 또는 code-reviewer 의 fixup commits 가능)
- [ ] `npm test` ~444 passing + 1 useReports 알려진 flake
- [ ] TypeScript clean (filter facebook-nodejs)
- [ ] grep 검증:
  - `grep -rn "videoLocalPath\|generateVideo\|videoJob\|fetchVeoVideoData\|discoverVideoModel\|aiVideo" packages/ --include="*.ts" --include="*.tsx" | wc -l` → 0 hits
  - `grep -rn "tracks\.video\|TaskProgress.*video\|GenerateProgress.*video\|assets\.video\|videoBytes\|veo\b" packages/ --include="*.ts" --include="*.tsx" | wc -l` → 0 hits
- [ ] 4 파일 삭제: `creative/video.ts`, `creative/video.test.ts`, `server/jobs/videoJob.ts`, `server/routes/aiVideo.ts`
- [ ] 수동 검증:
  - `data/creatives/` cleanup 후 `npm run app` → Generate → image + copy 만 생성 (~30초-1분)
  - Review 화면 → 영상 line / video meta 표시 안 됨
  - Launch → Meta DCO image-only 광고 정상 게재 (placement 별 verify R-G1)
- [ ] meta-platform-expert 검토 통과 (Commit 1)
- [ ] code-reviewer 검토 통과 (Commit 1, 2)
- [ ] STATUS.md R-G1 (Reels placement coverage) 등록 / R-E2 제거 / R-E4-R-F4 narrow
- [ ] ROADMAP.md Tier 3 "영상 생성 실패율 모니터링" 항목 제거

---

## 작업 시간 견적

| 단계 | 시간 |
|---|---|
| Task 0 (pre-flight) | 0.1h |
| Tasks 1.1-1.10 (Commit 1 코드 변경 — 16 파일 + 17 fixture + 5 assertions) | 2.5h |
| Task 1.11-1.12 (테스트 + STATUS + commit) | 0.4h |
| Tasks 1.13-1.14 (meta-platform-expert + code-reviewer + 수정) | 1.5h |
| Tasks 2.1-2.6 (Commit 2 — 4 파일 삭제 + cleanup) | 0.7h |
| Task 2.7 (테스트 + commit) | 0.2h |
| Task 2.8 (code-reviewer Commit 2) | 0.4h |
| 수동 검증 (Generate + Review + Launch) | 0.5h |
| 안정화 | 0.2h |
| **합계** | **~6.5h** |

---

## Self-Review

### Spec coverage 매핑

| Spec section | Plan task | 검증 |
|---|---|---|
| §1 배경 | Plan header | ✅ |
| §2.1 결정 5개 | Tasks 1.1-1.10 + 2.1-2.5 | ✅ |
| §2.2 영향 받는 파일 | Tasks 1.1-1.10 + 2.1-2.5 | ✅ |
| §2.3 범위 밖 | Plan 본문 미포함 (의도) | ✅ |
| §3.1 Aggressive 결정 | Task 1.1 (필드 제거) + Task 2.1 (파일 삭제) | ✅ |
| §3.2 Meta DCO image-only | Task 1.13 (meta-platform-expert verify) + R-G1 등록 | ✅ |
| §3.3 commit 분할 | Plan Commit 1 (Task 1) + Commit 2 (Task 2) | ✅ |
| §4.1 Creative | Task 1.1 Step 1 | ✅ |
| §4.2 VariantGroup | Task 1.1 Step 2 | ✅ |
| §4.3 AssetFeedSpec | Task 1.1 Step 3 | ✅ |
| §4.4 launcher.ts | Task 1.2 | ✅ |
| §4.5 actions.ts:runGenerate | Task 1.3 Step 1-5 | ✅ |
| §4.6 actions.ts:runLaunch | Task 1.3 Step 6 | ✅ |
| §4.7 buildOverallProgress | Task 1.3 Step 2 + Task 1.8 | ✅ |
| §4.8 pipeline.ts | Task 1.4 Step 1 | ✅ |
| §4.9 entries/generate.ts | Task 1.4 Step 2 | ✅ |
| §4.10 entries/launch.ts | Task 1.4 Step 3 | ✅ |
| §4.11 AppTypes.ts | Task 1.5 Step 1-2 | ✅ |
| §4.12 GenerateScreen | Task 1.5 Step 3-4 | ✅ |
| §4.13 ReviewScreen | Task 1.5 Step 5-7 | ✅ |
| §4.14 LaunchScreen 무변경 | Plan 명시 | ✅ |
| §4.15 modelDiscovery | Task 2.2 | ✅ |
| §4.16 vitest.setup | Task 2.4 | ✅ |
| §4.17 listModels | Task 2.5 | ✅ |
| §4.18 PipelineScreen | Task 1.5 Step 8 | ✅ |
| §4.19 server/index.ts | Task 1.6 | ✅ |
| §4.20 삭제 파일 | Task 2.1 (+ aiVideo.ts 추가) | ✅ |
| §5.1 17 fixture | Task 1.7-1.8 | ✅ |
| §5.2 assetFeedSpec.test | Task 1.9 | ✅ |
| §5.3 삭제 테스트 | Task 2.1 (video.test) + Task 2.3 (modelDiscovery 케이스) | ✅ |
| §5.4 갱신 테스트 | Task 1.7-1.8 | ✅ |
| §5.5 테스트 수 delta | Plan 작업 시간 견적에 명시 | ✅ |
| §5.6 통합 검증 | DoD 의 "수동 검증" 항목 | ✅ |
| §5.7 회귀 위험 | Plan 본문 분산 | ✅ |
| §6 영속 데이터 | Plan 본문 (사용자 직접 정리 권장) | ✅ |
| §7 리스크/롤백 | Plan 본문 미포함 (spec 위임) | ✅ |
| §8 작업 순서 | Plan Commit 1, 2 | ✅ |
| §9 시간 견적 | Plan 본문 | ✅ |
| §10 DoD | Plan DoD 섹션 | ✅ |
| §11 Open Questions | Plan 본문 미포함 (spec 위임) | ✅ |

### Placeholder scan

- "TBD", "TODO", "implement later": 0건 ✅
- "Add appropriate error handling" / "Similar to Task N": 0건 ✅
- 모든 step 코드 본체 명시 ✅
- 모든 grep 명령 + Expected output 명시 ✅

### Type consistency

- `Creative.videoLocalPath` 제거 — Task 1.1 + 17 fixture 갱신 (Task 1.7-1.10) 일관 ✅
- `VariantGroup.assets.video` 제거 — Task 1.1 + actions.ts/launch.ts (Task 1.3, 1.4) 일관 ✅
- `AssetFeedSpec.videos` / `AssetFeedSpecInput.videoId` 제거 — Task 1.1 + launcher.ts (Task 1.2) + assetFeedSpec.test (Task 1.9) 일관 ✅
- `TaskProgress.video` / `GenerateProgress.tracks.video` 제거 — Task 1.5 + actions.ts (Task 1.3) + GenerateScreen/PipelineScreen (Task 1.5) + actions.test (Task 1.8) 일관 ✅
- `setModelOverrideForTesting` signature `{ image?: string | null; video?: string | null }` → `{ image?: string | null }` — Task 2.2 + Task 2.3 (test) + Task 2.4 (vitest.setup) 일관 ✅

이슈 없음.

### Spec 정정 사항 (plan 작성 시 발견)

- Spec §2.2 의 "삭제 대상" 에 `aiVideo.ts` 미포함 (server/index.ts 의 createAiVideoRouter import 출처). plan Task 2.1 에서 추가 — 4 파일 삭제. spec 정정 필요시 별 commit.
- Spec §6 의 "기존 데이터" — `data/creatives/<id>.json` 의 `videoLocalPath` 필드 외에 `data/creatives/*-video.mp4` 영상 파일 자체도 사용자가 정리 권장. plan DoD 의 "수동 검증" 항목에 명시.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-28-remove-video-track.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — Commit 1 (Tasks 1.1-1.12) implementer + meta-platform-expert + code-reviewer, Commit 2 (Tasks 2.1-2.7) implementer + code-reviewer.

**2. Inline Execution** — CLAUDE.md 가 Inline 사용 금지 — *해당 없음*.

CLAUDE.md 정책상 **Subagent-Driven 만 허용**. 진행 시 `superpowers:subagent-driven-development` 스킬 호출.
