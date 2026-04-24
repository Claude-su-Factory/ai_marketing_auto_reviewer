import { Router } from "express";
import { startVideoJob, getJob } from "../jobs/videoJob.js";
import type { Product } from "@ad-ai/core/types.js";
import type { BillingService } from "../billing.js";
import { PRICING } from "@ad-ai/core/billing/pricing.js";

export function createAiVideoRouter(billing: BillingService, serverBaseUrl: string) {
  const router = Router();

  router.post("/ai/video", async (req, res) => {
    const { product } = req.body as { product: Product };
    const licenseId = (req as any).licenseId;
    const pricing = PRICING.video_gen;

    if (!billing.checkBalance(licenseId, pricing.charged)) {
      res.status(402).json({ error: "잔액 부족", required: pricing.charged });
      return;
    }

    const eventId = billing.deductAndRecord(licenseId, "video_gen", pricing.aiCost, pricing.charged);
    try {
      const jobId = await startVideoJob(product, licenseId, serverBaseUrl, billing, eventId);
      res.json({ jobId, status: "pending" });
    } catch (e) {
      billing.refund(eventId, licenseId, pricing.charged);
      res.status(500).json({ error: "AI 처리 실패. 잔액이 환불되었습니다." });
    }
  });

  router.get("/ai/video/status/:jobId", (req, res) => {
    const job = getJob(req.params.jobId);
    if (!job) { res.status(404).json({ error: "Job not found" }); return; }

    // 소유권 확인 — 다른 고객의 잡 접근 차단
    if (job.licenseId !== (req as any).licenseId) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    if (job.status === "pending") {
      res.json({ status: "pending", progress: job.progress });
    } else if (job.status === "done") {
      res.json({ status: "done", downloadUrl: job.downloadUrl });
    } else {
      res.json({ status: "failed", error: job.error });
    }
  });

  return router;
}
