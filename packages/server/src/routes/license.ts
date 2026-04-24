import { Router } from "express";
import type { AppDb } from "../db.js";
import type { SessionStore } from "../auth.js";

export function createLicenseRouter(db: AppDb, sessions: SessionStore) {
  const router = Router();

  router.post("/license/validate", (req, res) => {
    const { key } = req.body;
    if (!key) { res.status(400).json({ error: "License key required" }); return; }

    const license = db.prepare("SELECT * FROM licenses WHERE key = ?").get(key) as any;
    if (!license || license.status !== "active") {
      res.status(401).json({ error: "Invalid license key" });
      return;
    }

    const { token, expiresAt } = sessions.create(license.id);
    res.json({ sessionToken: token, expiresAt, customerEmail: license.customer_email });
  });

  return router;
}
