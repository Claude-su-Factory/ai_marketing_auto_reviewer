import type { AppDb } from "./db.js";
import { randomUUID } from "crypto";

const RECHARGE_THRESHOLD = 5.0;

export interface LicenseWithBalance {
  id: string;
  key: string;
  customer_email: string;
  status: string;
  stripe_customer_id: string | null;
  stripe_payment_method_id: string | null;
  balance_usd: number;
  recharge_amount: number;
  recharge_tier: string;
}

export function createBillingService(db: AppDb) {
  return {
    getLicense(licenseId: string): LicenseWithBalance | null {
      return db.prepare("SELECT * FROM licenses WHERE id = ?").get(licenseId) as LicenseWithBalance | null;
    },

    checkBalance(licenseId: string, required: number): boolean {
      const license = db.prepare("SELECT balance_usd FROM licenses WHERE id = ?").get(licenseId) as any;
      return license ? license.balance_usd >= required : false;
    },

    deductAndRecord(licenseId: string, usageType: string, aiCost: number, charged: number): string {
      const eventId = randomUUID();
      db.transaction(() => {
        db.prepare("UPDATE licenses SET balance_usd = balance_usd - ? WHERE id = ?").run(charged, licenseId);
        db.prepare(
          "INSERT INTO usage_events (id, license_id, type, ai_cost_usd, charged_usd, status, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).run(eventId, licenseId, usageType, aiCost, charged, "pending", "{}");
      })();
      return eventId;
    },

    confirmUsage(eventId: string): void {
      db.prepare("UPDATE usage_events SET status = 'completed' WHERE id = ?").run(eventId);
    },

    refund(eventId: string, licenseId: string, amount: number): void {
      db.transaction(() => {
        db.prepare("UPDATE licenses SET balance_usd = balance_usd + ? WHERE id = ?").run(amount, licenseId);
        db.prepare("UPDATE usage_events SET status = 'refunded' WHERE id = ?").run(eventId);
      })();
    },

    needsRecharge(licenseId: string): boolean {
      const license = db.prepare("SELECT balance_usd, recharge_amount FROM licenses WHERE id = ?").get(licenseId) as any;
      return license ? license.balance_usd < RECHARGE_THRESHOLD && license.recharge_amount > 0 : false;
    },

    addBalance(licenseId: string, amount: number): void {
      db.prepare("UPDATE licenses SET balance_usd = balance_usd + ? WHERE id = ?").run(amount, licenseId);
    },

    suspendLicense(licenseId: string): void {
      db.prepare("UPDATE licenses SET status = 'suspended' WHERE id = ?").run(licenseId);
    },

    activateLicense(licenseId: string): void {
      db.prepare("UPDATE licenses SET status = 'active' WHERE id = ?").run(licenseId);
    },

    setPaymentMethod(licenseId: string, paymentMethodId: string): void {
      db.prepare("UPDATE licenses SET stripe_payment_method_id = ? WHERE id = ?").run(paymentMethodId, licenseId);
    },

    cleanupOrphanedEvents(): number {
      const orphaned = db.prepare(
        "SELECT id, license_id, charged_usd FROM usage_events WHERE status = 'pending'"
      ).all() as Array<{ id: string; license_id: string; charged_usd: number }>;

      for (const event of orphaned) {
        db.transaction(() => {
          db.prepare("UPDATE licenses SET balance_usd = balance_usd + ? WHERE id = ?").run(event.charged_usd, event.license_id);
          db.prepare("UPDATE usage_events SET status = 'refunded' WHERE id = ?").run(event.id);
        })();
      }
      return orphaned.length;
    },
  };
}

export type BillingService = ReturnType<typeof createBillingService>;
