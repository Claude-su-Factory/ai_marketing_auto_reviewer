import express from "express";
import { createDb } from "./db.js";
import { createBillingService } from "./billing.js";
import { createStripeClient } from "./stripe.js";
import { createSessionStore } from "./auth.js";
import { createRateLimiter } from "./rateLimit.js";
import { createLicenseRouter } from "./routes/license.js";
import { createAiCopyRouter } from "./routes/aiCopy.js";
import { createAiImageRouter } from "./routes/aiImage.js";
import { createAiParseRouter } from "./routes/aiParse.js";
import { createAiAnalyzeRouter } from "./routes/aiAnalyze.js";
import { createUsageRouter } from "./routes/usage.js";
import { createStripeWebhookRouter } from "./routes/stripeWebhook.js";
import { startScheduler } from "./scheduler.js";
import { getConfig } from "@ad-ai/core/config/index.js";

const PORT = getConfig().server.port;

const db = createDb();
const billing = createBillingService(db);
const sessions = createSessionStore();
const rateLimiter = createRateLimiter(10, 60000);

// Cleanup orphaned pending events from previous crashes
const orphaned = billing.cleanupOrphanedEvents();
if (orphaned > 0) console.log(`[Billing] Cleaned up ${orphaned} orphaned pending events`);

const app = express();

// Stripe webhook must be registered BEFORE express.json() — needs raw body
const stripeCfg = getConfig().billing?.stripe;
if (stripeCfg) {
  const stripe = createStripeClient();
  app.use(createStripeWebhookRouter(stripe, stripeCfg.webhook_secret, billing, db));
}

app.use(express.json({ limit: "10mb" }));

// License route (no auth required)
app.use(createLicenseRouter(db, sessions));

// Auth + rate limit middleware for /ai/* and /usage/*
const authMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authorization header required" });
    return;
  }
  const token = authHeader.slice(7);
  const session = sessions.validate(token);
  if (!session) {
    res.status(401).json({ error: "Invalid or expired session token" });
    return;
  }
  (req as any).licenseId = session.licenseId;
  next();
};

const rateLimitMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const licenseId = (req as any).licenseId;
  const rateResult = rateLimiter.check(licenseId);
  if (!rateResult.allowed) {
    res.status(429).json({ error: "Rate limit exceeded", retryAfter: rateResult.retryAfter });
    return;
  }
  next();
};

// Apply: auth to both, rate limit only to /ai
app.use("/ai", authMiddleware, rateLimitMiddleware);
app.use("/usage", authMiddleware);

// Routes
app.use(createAiCopyRouter(billing));
app.use(createAiImageRouter(billing));
app.use(createAiParseRouter(billing));
app.use(createAiAnalyzeRouter(billing));
app.use(createUsageRouter(db));

app.listen(PORT, () => {
  console.log(`[Usage Server] Running on ${getConfig().server.base_url}`);
  console.log(`[Usage Server] DB: data/licenses.db`);
});

// Scheduler runs opportunistically; server availability must not depend on it.
startScheduler().catch((err) => {
  console.error("[scheduler] failed to start, continuing without it:", err);
});
