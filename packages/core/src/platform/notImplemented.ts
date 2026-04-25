/**
 * Scaffold 어댑터에서 미구현 메서드를 호출 시 throw하는 표준 헬퍼.
 * 메시지에 platform 이름 + method + README 포인터 포함.
 */
export function notImplemented(platform: string, method: string): never {
  throw new Error(
    `[${platform}] ${method} — scaffold only, not yet implemented. ` +
    `See packages/core/src/platform/${platform}/README.md for integration plan.`,
  );
}
