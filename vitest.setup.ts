import { beforeEach, afterEach } from "vitest";
import { setConfigForTesting, resetConfigForTesting } from "./packages/core/src/config/index.js";
import { makeTestConfig } from "./packages/core/src/config/testing.js";

beforeEach(() => {
  setConfigForTesting(makeTestConfig());
});

afterEach(() => {
  resetConfigForTesting();
});
