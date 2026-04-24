export const PRICING: Record<string, { aiCost: number; charged: number }> = {
  copy_gen:        { aiCost: 0.003, charged: 0.01 },
  image_gen:       { aiCost: 0.02,  charged: 0.05 },
  video_gen:       { aiCost: 0.50,  charged: 1.50 },
  parse:           { aiCost: 0.001, charged: 0.005 },
  analyze:         { aiCost: 0.01,  charged: 0.03 },
  campaign_launch: { aiCost: 0,     charged: 0.10 },
};
