import { describe, it, expect } from "vitest";
import { createMutex } from "./mutex.js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("createMutex", () => {
  it("순차 실행을 강제한다 (동시 호출이 직렬화됨)", async () => {
    const mutex = createMutex();
    const log: string[] = [];
    const a = mutex(async () => {
      log.push("a-start");
      await delay(20);
      log.push("a-end");
    });
    const b = mutex(async () => {
      log.push("b-start");
      await delay(5);
      log.push("b-end");
    });
    await Promise.all([a, b]);
    expect(log).toEqual(["a-start", "a-end", "b-start", "b-end"]);
  });

  it("콜백이 throw 해도 큐를 계속 진행한다", async () => {
    const mutex = createMutex();
    const a = mutex(async () => {
      throw new Error("boom");
    });
    const b = mutex(async () => "ok" as const);
    await expect(a).rejects.toThrow("boom");
    await expect(b).resolves.toBe("ok");
  });

  it("반환값을 그대로 전달한다", async () => {
    const mutex = createMutex();
    const result = await mutex(async () => 42);
    expect(result).toBe(42);
  });
});
