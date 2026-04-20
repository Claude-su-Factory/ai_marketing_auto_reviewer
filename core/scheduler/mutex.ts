export type Mutex = <T>(fn: () => Promise<T>) => Promise<T>;

export function createMutex(): Mutex {
  let tail: Promise<unknown> = Promise.resolve();
  return async function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const prev = tail;
    let release!: () => void;
    tail = new Promise<void>((r) => {
      release = r;
    });
    try {
      await prev;
    } catch {
      // 이전 작업 실패는 다음 작업 실행을 막지 않음
    }
    try {
      return await fn();
    } finally {
      release();
    }
  };
}
