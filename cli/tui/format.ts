export function formatWon(value: number): string {
  return `${value.toLocaleString("ko-KR")}원`;
}

export function formatPct(ratio: number): string {
  return `${(ratio * 100).toFixed(2)}%`;
}

export function formatAgo(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 60_000) return "just now";
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  return `${Math.floor(diffMs / 86_400_000)}d ago`;
}

export function truncate(s: string, max: number): string {
  if ([...s].length <= max) return s;
  return `${[...s].slice(0, max).join("").trimEnd()}…`;
}
