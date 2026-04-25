import { z } from "zod";

const PlatformId = z.enum(["meta", "tiktok", "google"]);

const MetaPlatform = z.object({
  access_token: z.string().min(1),
  ad_account_id: z.string().regex(/^act_\d+$/, 'must be "act_" + digits'),
  page_id: z.string().regex(/^\d+$/),
  instagram_actor_id: z.string().regex(/^\d+$/),
});

const PlatformsSection = z.object({
  enabled: z.array(PlatformId).min(1, "at least one platform must be enabled"),
  meta: MetaPlatform.optional(),
});

const AiSection = z
  .object({
    anthropic: z.object({ api_key: z.string().min(1) }).optional(),
    google: z.object({ api_key: z.string().min(1) }).optional(),
    voyage: z.object({ api_key: z.string().min(1) }).optional(),
  })
  .default({})
  .superRefine((ai, ctx) => {
    if (!ai.anthropic && !ai.google) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ai"],
        message: "[ai.anthropic] 또는 [ai.google] 중 최소 1개의 api_key가 필요합니다",
      });
    }
  });

const BillingSection = z
  .object({
    stripe: z
      .object({
        secret_key: z.string().min(1),
        webhook_secret: z.string().min(1),
      })
      .optional(),
  })
  .optional();

// In Zod v4, .default({}) returns the literal {} without re-running field-level
// defaults. Use z.preprocess to coerce undefined → {} so field defaults apply.
const ServerSection = z.preprocess(
  (v) => v ?? {},
  z.object({
    base_url: z.string().url().default("http://localhost:3000"),
    port: z.coerce.number().int().positive().default(3000),
  })
);

const DefaultsSection = z.preprocess(
  (v) => v ?? {},
  z.object({
    daily_budget_krw: z.coerce.number().int().positive().default(10000),
    duration_days: z.coerce.number().int().positive().default(14),
    target_age_min: z.coerce.number().int().min(13).default(20),
    target_age_max: z.coerce.number().int().max(65).default(45),
    ctr_improvement_threshold: z.coerce.number().positive().default(1.5),
  })
);

export const ConfigSchema = z
  .object({
    platforms: PlatformsSection,
    ai: AiSection,
    billing: BillingSection,
    server: ServerSection,
    defaults: DefaultsSection,
  })
  .superRefine((cfg, ctx) => {
    for (const id of cfg.platforms.enabled) {
      if (id === "meta" && !cfg.platforms.meta) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["platforms", "meta"],
          message: '"meta"가 platforms.enabled에 있지만 [platforms.meta] 섹션이 없습니다',
        });
      }
    }
  });

export type Config = z.infer<typeof ConfigSchema>;
