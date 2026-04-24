import { randomUUID } from "crypto";

interface Session {
  licenseId: string;
  expiresAt: number;
}

export function createSessionStore(ttlMs = 24 * 60 * 60 * 1000) {
  const sessions = new Map<string, Session>();

  return {
    create(licenseId: string) {
      const token = randomUUID();
      const expiresAt = Date.now() + ttlMs;
      sessions.set(token, { licenseId, expiresAt });
      return { token, expiresAt: new Date(expiresAt).toISOString() };
    },

    validate(token: string): { licenseId: string } | null {
      const session = sessions.get(token);
      if (!session) return null;
      if (Date.now() > session.expiresAt) {
        sessions.delete(token);
        return null;
      }
      return { licenseId: session.licenseId };
    },

    revoke(token: string) {
      sessions.delete(token);
    },
  };
}

export type SessionStore = ReturnType<typeof createSessionStore>;
