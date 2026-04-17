import "dotenv/config";
import { createDb } from "./db.js";
import { randomUUID } from "crypto";

const db = createDb();
const args = process.argv.slice(2);
const command = args[0];

function generateKey(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const part = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `AD-AI-${part()}-${part()}`;
}

function getFlag(flag: string): string | undefined {
  const arg = args.find((a) => a.startsWith(`--${flag}=`));
  return arg?.split("=")[1];
}

switch (command) {
  case "create-license": {
    const email = getFlag("email");
    if (!email) { console.error("Usage: npm run admin -- create-license --email=<email>"); process.exit(1); }
    const id = randomUUID();
    const key = generateKey();
    db.prepare("INSERT INTO licenses (id, key, customer_email) VALUES (?, ?, ?)").run(id, key, email);

    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString();
    db.prepare(
      "INSERT INTO billing_cycles (id, license_id, period_start, period_end) VALUES (?, ?, ?, ?)"
    ).run(randomUUID(), id, periodStart, periodEnd);

    console.log(`License created: ${key}`);
    console.log(`Email: ${email}`);
    break;
  }

  case "list-licenses": {
    const rows = db.prepare("SELECT key, customer_email, status, created_at FROM licenses ORDER BY created_at DESC").all() as any[];
    if (rows.length === 0) { console.log("No licenses found."); break; }
    for (const r of rows) {
      console.log(`${r.key}  ${r.customer_email}  ${r.status}  ${r.created_at}`);
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
      "SELECT type, COUNT(*) as count, SUM(charged_usd) as total FROM usage_events WHERE license_id = ? GROUP BY type"
    ).all(license.id) as Array<{ type: string; count: number; total: number }>;
    if (events.length === 0) { console.log("No usage recorded."); break; }
    for (const e of events) {
      console.log(`${e.type}: ${e.count} ($${e.total.toFixed(2)})`);
    }
    break;
  }

  default:
    console.log("Commands: create-license, list-licenses, suspend-license, usage");
}
