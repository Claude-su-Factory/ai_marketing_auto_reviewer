import "dotenv/config";
import { createDb } from "./db.js";
import { createBillingService } from "./billing.js";
import { createStripeClient, createStripeCustomer, createCheckoutSession } from "./stripe.js";
import { getTierAmount } from "../core/billing/tiers.js";
import { randomUUID } from "crypto";
import { generateKey, getFlag as getFlagUtil } from "./adminUtils.js";

const db = createDb();
const billing = createBillingService(db);
const args = process.argv.slice(2);
const command = args[0];

function getFlag(flag: string): string | undefined {
  return getFlagUtil(args, flag);
}

switch (command) {
  case "create-license": {
    const email = getFlag("email");
    if (!email) { console.error("Usage: npm run admin -- create-license --email=<email> [--tier=basic|standard|pro]"); process.exit(1); }
    const tier = getFlag("tier") ?? "standard";
    const rechargeAmount = getTierAmount(tier);
    const id = randomUUID();
    const key = generateKey();

    if (process.env.STRIPE_SECRET_KEY) {
      const stripe = createStripeClient();
      (async () => {
        const customerId = await createStripeCustomer(stripe, email, key);
        db.prepare(
          "INSERT INTO licenses (id, key, customer_email, status, stripe_customer_id, recharge_amount, recharge_tier) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).run(id, key, email, "pending_payment", customerId, rechargeAmount, tier);

        const now = new Date();
        const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString();
        db.prepare(
          "INSERT INTO billing_cycles (id, license_id, period_start, period_end) VALUES (?, ?, ?, ?)"
        ).run(randomUUID(), id, periodStart, periodEnd);

        const paymentUrl = await createCheckoutSession(stripe, customerId, rechargeAmount, id);
        console.log(`License created: ${key}`);
        console.log(`Email: ${email}`);
        console.log(`Tier: ${tier} ($${rechargeAmount})`);
        console.log(`Status: pending_payment`);
        console.log(`Payment URL: ${paymentUrl}`);
      })().catch((e) => {
        console.error("Stripe error:", e);
        process.exit(1);
      });
    } else {
      db.prepare(
        "INSERT INTO licenses (id, key, customer_email, status, recharge_amount, recharge_tier) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(id, key, email, "active", rechargeAmount, tier);

      const now = new Date();
      const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString();
      db.prepare(
        "INSERT INTO billing_cycles (id, license_id, period_start, period_end) VALUES (?, ?, ?, ?)"
      ).run(randomUUID(), id, periodStart, periodEnd);

      console.log(`License created: ${key}`);
      console.log(`Email: ${email}`);
      console.log(`Tier: ${tier} ($${rechargeAmount})`);
      console.log(`Status: active (no Stripe — STRIPE_SECRET_KEY not set)`);
    }
    break;
  }

  case "balance": {
    const key = getFlag("key");
    if (!key) { console.error("Usage: npm run admin -- balance --key=<key>"); process.exit(1); }
    const license = db.prepare("SELECT balance_usd, recharge_tier, recharge_amount FROM licenses WHERE key = ?").get(key) as any;
    if (!license) { console.error(`License not found: ${key}`); process.exit(1); }
    console.log(`Balance: $${license.balance_usd.toFixed(2)}`);
    console.log(`Tier: ${license.recharge_tier} ($${license.recharge_amount})`);
    break;
  }

  case "add-balance": {
    const key = getFlag("key");
    const amount = getFlag("amount");
    if (!key || !amount) { console.error("Usage: npm run admin -- add-balance --key=<key> --amount=<usd>"); process.exit(1); }
    const license = db.prepare("SELECT id, balance_usd FROM licenses WHERE key = ?").get(key) as any;
    if (!license) { console.error(`License not found: ${key}`); process.exit(1); }
    billing.addBalance(license.id, parseFloat(amount));
    const updated = db.prepare("SELECT balance_usd FROM licenses WHERE id = ?").get(license.id) as any;
    console.log(`Added $${amount} to ${key}`);
    console.log(`New balance: $${updated.balance_usd.toFixed(2)}`);
    break;
  }

  case "list-licenses": {
    const rows = db.prepare("SELECT key, customer_email, status, balance_usd, created_at FROM licenses ORDER BY created_at DESC").all() as any[];
    if (rows.length === 0) { console.log("No licenses found."); break; }
    for (const r of rows) {
      console.log(`${r.key}  ${r.customer_email}  ${r.status}  $${r.balance_usd.toFixed(2)}  ${r.created_at}`);
    }
    break;
  }

  case "suspend-license": {
    const key = getFlag("key");
    if (!key) { console.error("Usage: npm run admin -- suspend-license --key=<key>"); process.exit(1); }
    const result = db.prepare("UPDATE licenses SET status = 'suspended' WHERE key = ?").run(key);
    if (result.changes === 0) { console.error(`License not found: ${key}`); process.exit(1); }
    console.log(`License ${key} suspended`);
    break;
  }

  case "usage": {
    const key = getFlag("key");
    if (!key) { console.error("Usage: npm run admin -- usage --key=<key>"); process.exit(1); }
    const license = db.prepare("SELECT id FROM licenses WHERE key = ?").get(key) as any;
    if (!license) { console.error(`License not found: ${key}`); process.exit(1); }
    const events = db.prepare(
      "SELECT type, COUNT(*) as count, SUM(charged_usd) as total FROM usage_events WHERE license_id = ? AND status = 'completed' GROUP BY type"
    ).all(license.id) as Array<{ type: string; count: number; total: number }>;
    if (events.length === 0) { console.log("No usage recorded."); break; }
    for (const e of events) {
      console.log(`${e.type}: ${e.count} ($${e.total.toFixed(2)})`);
    }
    break;
  }

  default:
    console.log("Commands: create-license, list-licenses, suspend-license, usage, balance, add-balance");
}
