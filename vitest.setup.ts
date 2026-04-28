import { beforeEach, afterEach } from "vitest";
import { setConfigForTesting, resetConfigForTesting } from "./packages/core/src/config/index.js";
import { makeTestConfig } from "./packages/core/src/config/testing.js";
import { setPromptsForTesting, setPromptsPathForTesting } from "./packages/core/src/learning/prompts.js";
import { setModelOverrideForTesting, clearModelDiscoveryCache } from "./packages/core/src/creative/modelDiscovery.js";

beforeEach(() => {
  setConfigForTesting(makeTestConfig());
  setPromptsForTesting(null);
  setPromptsPathForTesting(null);
  // 자동 모델 디스커버리는 네트워크 호출이라 테스트에서 차단 — 스텁 ID 주입
  setModelOverrideForTesting({ image: "test-imagen" });
});

afterEach(() => {
  resetConfigForTesting();
  clearModelDiscoveryCache();
});
