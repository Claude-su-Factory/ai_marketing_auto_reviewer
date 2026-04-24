import type { AppDb } from "./db.js";

export function markEventProcessed(db: AppDb, eventId: string): boolean {
  const result = db.prepare("INSERT OR IGNORE INTO stripe_events (event_id) VALUES (?)").run(eventId);
  return result.changes === 1;
}
