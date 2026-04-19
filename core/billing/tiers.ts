export const RECHARGE_TIERS: Record<string, number> = {
  basic: 10,
  standard: 20,
  pro: 50,
};

export function getTierAmount(tier: string): number {
  return RECHARGE_TIERS[tier] ?? 20;
}
