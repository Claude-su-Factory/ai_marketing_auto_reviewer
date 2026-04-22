import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
  resolve: {
    alias: {
      sharp: new URL("./tests/mocks/sharpStub.ts", import.meta.url).pathname,
    },
  },
});
