import "dotenv/config";
import express from "express";
import { existsSync, mkdirSync } from "fs";
import { createDb } from "./db.js";
import { createSessionStore } from "./auth.js";
import { createRateLimiter } from "./rateLimit.js";
import { createLicenseRouter } from "./routes/license.js";
import { createAiCopyRouter } from "./routes/aiCopy.js";
import { createAiImageRouter } from "./routes/aiImage.js";
import { createAiVideoRouter } from "./routes/aiVideo.js";
import { createAiParseRouter } from "./routes/aiParse.js";
import { createAiAnalyzeRouter } from "./routes/aiAnalyze.js";
import { createUsageRouter } from "./routes/usage.js";
import { cleanupOldFiles } from "./jobs/videoJob.js";

const PORT = Number(process.env.SERVER_PORT ?? 3000);
const SERVER_URL = `http://localhost:${PORT}`;

const db = createDb();
const sessions = createSessionStore();
const rateLimiter = createRateLimiter(10, 60000);

const app = express();
app.use(express.json({ limit: "10mb" }));

// Static file serving for video downloads
const tmpDir = "server/tmp";
if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
app.use("/files", express.static(tmpDir));

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

  const rateResult = rateLimiter.check(session.licenseId);
  if (!rateResult.allowed) {
    res.status(429).json({ error: "Rate limit exceeded", retryAfter: rateResult.retryAfter });
    return;
  }

  next();
};

app.use("/ai", authMiddleware);
app.use("/usage", authMiddleware);

// Routes
app.use(createAiCopyRouter(db));
app.use(createAiImageRouter(db));
app.use(createAiVideoRouter(db, SERVER_URL));
app.use(createAiParseRouter(db));
app.use(createAiAnalyzeRouter(db));
app.use(createUsageRouter(db));

// Cleanup old video files
setInterval(cleanupOldFiles, 60 * 60 * 1000);
cleanupOldFiles();

app.listen(PORT, () => {
  console.log(`[Usage Server] Running on ${SERVER_URL}`);
  console.log(`[Usage Server] DB: server/data.db`);
});
