import { Router } from "express";
import { startVideoJob, getJob } from "../jobs/videoJob.js";
import type { Product } from "../../src/types.js";
import type { AppDb } from "../db.js";

export function createAiVideoRouter(db: AppDb, serverBaseUrl: string) {
  const router = Router();

  router.post("/ai/video", async (req, res) => {
    try {
      const { product } = req.body as { product: Product };
      const licenseId = (req as any).licenseId;
      const jobId = await startVideoJob(product, licenseId, serverBaseUrl, db);
      res.json({ jobId, status: "pending" });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  router.get("/ai/video/status/:jobId", (req, res) => {
    const job = getJob(req.params.jobId);
    if (!job) { res.status(404).json({ error: "Job not found" }); return; }

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
