import { beforeEach, afterEach } from "vitest";
import { setConfigForTesting, resetConfigForTesting } from "./packages/core/src/config/index.js";
import { makeTestConfig } from "./packages/core/src/config/testing.js";
import { setPromptsForTesting } from "./packages/core/src/learning/prompts.js";

beforeEach(() => {
  setConfigForTesting(makeTestConfig());
  setPromptsForTesting(null);
});

afterEach(() => {
  resetConfigForTesting();
});
