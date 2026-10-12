import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { readEnvironment } from "../../config/env.ts";
import type { Identity, Membership } from "./policy.ts";

export const fixtureIdentities = {
  owner: { id: "00000000-0000-4000-8000-000000000001", email: "owner@example.test" },
  staff: { id: "00000000-0000-4000-8000-000000000002", email: "staff@example.test" },
  customer: { id: "00000000-0000-4000-8000-000000000003", email: "customer@example.test" },
} as const;

const storeSchema = z.object({
  sessions: z.record(z.object({ userId: z.string().uuid(), expiresAt: z.number() })),
  memberships: z.record(z.object({ userId: z.string().uuid(), role: z.enum(["owner", "staff"]), enabled: z.boolean() })),
});
type Store = z.infer<typeof storeSchema>;
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
export const fixtureSessionCookie = "clothing_fixture_session";
export const fixtureSessionSeconds = 8 * 60 * 60;

// Local fixture storage only. Durable commerce/session infrastructure is Supabase.
export function fixtureAuthStore(path = join(process.env.FIXTURE_AUTH_DIR ?? join(process.cwd(), ".fixture"), "auth.json")) {
  const guard = () => {
    if (readEnvironment().APP_MODE !== "fixture") throw new Error("Fixture authentication is disabled.");
  };
  function read(): Store {
    guard();
    if (existsSync(path)) return storeSchema.parse(JSON.parse(readFileSync(path, "utf8")));
    return { sessions: {}, memberships: {
      [fixtureIdentities.owner.id]: { userId: fixtureIdentities.owner.id, role: "owner", enabled: true },
      [fixtureIdentities.staff.id]: { userId: fixtureIdentities.staff.id, role: "staff", enabled: true },
    } };
  }
  function save(store: Store) {
    guard();
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${randomBytes(8).toString("hex")}.tmp`;
    writeFileSync(temporary, JSON.stringify(store), { mode: 0o600 });
    renameSync(temporary, path);
  }
  return {
    signIn(persona: keyof typeof fixtureIdentities): string {
      const store = read();
      for (const [key, session] of Object.entries(store.sessions)) {
        if (session.expiresAt <= Date.now()) delete store.sessions[key];
      }
      const token = randomBytes(32).toString("base64url");
      store.sessions[hash(token)] = { userId: fixtureIdentities[persona].id, expiresAt: Date.now() + fixtureSessionSeconds * 1000 };
      save(store);
      return token;
    },
    user(token: string | undefined): Identity | null {
      const store = read();
      if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
      const session = store.sessions[hash(token)];
      if (!session || session.expiresAt <= Date.now()) return null;
      return Object.values(fixtureIdentities).find((user) => user.id === session.userId) ?? null;
    },
    membership(userId: string): Membership | null { return read().memberships[userId] ?? null; },
    signOut(token: string | undefined) {
      const store = read();
      if (token) delete store.sessions[hash(token)];
      save(store);
    },
    // Trusted fixture-test/bootstrap tool only; no HTTP endpoint exposes this.
    setEnabled(userId: string, enabled: boolean) {
      const store = read();
      if (store.memberships[userId]) store.memberships[userId].enabled = enabled;
      save(store);
    },
  };
}
