export function generateKey(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const part = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `AD-AI-${part()}-${part()}`;
}

export function getFlag(args: string[], flag: string): string | undefined {
  const arg = args.find((a) => a.startsWith(`--${flag}=`));
  return arg?.split("=")[1];
}
