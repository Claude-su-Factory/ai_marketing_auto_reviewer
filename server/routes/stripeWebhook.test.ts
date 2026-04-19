import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import Stripe from "stripe";
import { createDb, type AppDb } from "../db.js";
import { createBillingService } from "../billing.js";
import { createStripeWebhookRouter } from "./stripeWebhook.js";
import { unlinkSync, existsSync } from "fs";
import { randomUUID } from "crypto";

const WEBHOOK_SECRET = "whsec_test_secret";

let db: AppDb;
let app: express.Express;
let licenseId: string;
let stripe: Stripe;
let testDbPath: string;

beforeEach(() => {
  testDbPath = `server/test-webhook-${randomUUID()}.db`;
  db = createDb(testDbPath);
  const billing = createBillingService(db);
  licenseId = randomUUID();
  db.prepare(
    "INSERT INTO licenses (id, key, customer_email, status, balance_usd) VALUES (?, ?, ?, ?, ?)"
  ).run(licenseId, "AD-AI-TEST-DEDUP", "test@test.com", "pending", 0);

  stripe = new Stripe("sk_test_dummy", { apiVersion: "2024-12-18.acacia" as any });
  app = express();
  // Task 0에서 라우터 자체에 express.raw가 적용되었으므로 여기서는 별도 설정 불필요.
  app.use(createStripeWebhookRouter(stripe, WEBHOOK_SECRET, billing, db));
});

afterEach(() => {
  db.close();
  if (existsSync(testDbPath)) unlinkSync(testDbPath);
});

function buildSignedRequest(event: any): { body: Buffer; signature: string } {
  const payload = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: WEBHOOK_SECRET,
  });
  return { body: Buffer.from(payload), signature };
}

async function postWebhook(body: Buffer, signature: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = (server.address() as any).port;
      fetch(`http://127.0.0.1:${port}/stripe/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "stripe-signature": signature },
        body: new Uint8Array(body),
      })
        .then(async (r) => {
          const b = await r.json();
          server.close();
          resolve({ status: r.status, body: b });
        })
        .catch((e) => { server.close(); reject(e); });
    });
  });
}

describe("Stripe webhook dedup", () => {
  it("processes checkout.session.completed once and adds balance", async () => {
    const event = {
      id: "evt_test_once",
      type: "checkout.session.completed",
      data: { object: { metadata: { licenseId }, amount_total: 2000, payment_intent: null } },
    };
    const { body, signature } = buildSignedRequest(event);

    const res = await postWebhook(body, signature);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });

    const license = db.prepare("SELECT balance_usd, status FROM licenses WHERE id = ?").get(licenseId) as any;
    expect(license.balance_usd).toBeCloseTo(20);
    expect(license.status).toBe("active");
  });

  it("ignores the second call with the same event.id (no double credit)", async () => {
    const event = {
      id: "evt_test_dup",
      type: "checkout.session.completed",
      data: { object: { metadata: { licenseId }, amount_total: 2000, payment_intent: null } },
    };
    const { body, signature } = buildSignedRequest(event);

    const first = await postWebhook(body, signature);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ received: true });

    const second = await postWebhook(body, signature);
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ received: true, duplicate: true });

    const license = db.prepare("SELECT balance_usd FROM licenses WHERE id = ?").get(licenseId) as any;
    expect(license.balance_usd).toBeCloseTo(20); // $20 만 적립되어야 함 (이중 적립 없음)

    const rows = db.prepare("SELECT COUNT(*) as c FROM stripe_events WHERE event_id = ?").get("evt_test_dup") as any;
    expect(rows.c).toBe(1);
  });

  it("rejects invalid signature with 400", async () => {
    const event = { id: "evt_bad_sig", type: "checkout.session.completed", data: { object: {} } };
    const payload = Buffer.from(JSON.stringify(event));
    const res = await postWebhook(payload, "t=0,v1=deadbeef");
    expect(res.status).toBe(400);
  });
});
