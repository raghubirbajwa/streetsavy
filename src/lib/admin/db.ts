import "server-only";
import { PGlite } from "@electric-sql/pglite";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { readEnvironment } from "../../config/env.ts";
import { createFixtureSeedSql } from "../../data/fixtures/seed-sql.ts";
import { fixtureAuthStore, fixtureIdentities } from "../auth/fixture.ts";
import { privilegedSupabase } from "../supabase/privileged.ts";

const statuses: Record<string, number> = { INVALID_REFERENCE:422, SAVE_DRAFT_FIRST:422, ACTIVE_WAREHOUSE_EXISTS:409, INVALID_FIELDS:422, MEDIA_COVER_CONFLICT:422, MEDIA_COLOR_INVALID:422, MEDIA_POSTER_REQUIRED:422, MEDIA_STATE_CONFLICT:409, MEDIA_BUSY:409, MEDIA_IN_USE:409, UPLOAD_EXPIRED:403, FORBIDDEN: 403, NOT_FOUND: 404, VERSION_CONFLICT: 409, STOCK_CONFLICT: 409, IDEMPOTENCY_CONFLICT: 409, SKU_OR_SLUG_CONFLICT: 409, INVALID_PAYLOAD: 422, PUBLISH_INCOMPLETE: 422, MEDIA_NOT_READY: 422, INTEGRATION_UNCONFIGURED: 503 };
Object.assign(statuses,{SESSION_REQUIRED:401,CART_EMPTY:409,QUOTE_STALE:409,CHECKOUT_IN_PROGRESS:409,PRICE_UNAVAILABLE:409,PACKAGING_UNSUPPORTED:422,TAX_UNCONFIGURED:503,UNSERVICEABLE_PIN:422,PAYMENT_MISMATCH:409,RECONCILIATION_REQUIRED:409,OPERATION_BUSY:409,LEASE_LOST:409});
Object.assign(statuses,{DISPATCH_INELIGIBLE:409,SHIPMENT_EXISTS:409,SHIPMENT_UNKNOWN:409,SHIPMENT_STATE_CONFLICT:409,ALREADY_COLLECTED:409,RETURN_INELIGIBLE:409,RETURN_QUANTITY_CONFLICT:409,RETURN_STATE_CONFLICT:409,REFUND_BALANCE_EXCEEDED:409,REFUND_MISMATCH:409,CANCELLATION_TOO_LATE:409});
export class AdminDatabaseError extends Error {
  readonly code: string;
  readonly status: number;
  readonly fieldErrors?: Record<string, string[]>;
  readonly currentVersion?: number;
  constructor(code: string, details?: { fieldErrors?: Record<string, string[]>; currentVersion?: number }) {
    const safeCode = Object.hasOwn(statuses, code) ? code : "DATABASE_UNAVAILABLE";
    super(safeCode);
    this.name = "AdminDatabaseError"; this.code = safeCode; this.status = statuses[safeCode] ?? 503;
    if (details?.fieldErrors) this.fieldErrors = details.fieldErrors;
    if (details?.currentVersion !== undefined) this.currentVersion = details.currentVersion;
  }
}
export function adminDatabaseError(error: unknown): AdminDatabaseError {
  if (error instanceof AdminDatabaseError) return error;
  const source = error as { message?: unknown; code?: unknown; detail?: unknown; details?: unknown } | null;
  const code = typeof source?.message === "string" && Object.hasOwn(statuses,source.message) ? source.message : source?.code === "23505" ? "SKU_OR_SLUG_CONFLICT" : typeof source?.code === "string" && /^(22|23502|23503|23514)/.test(source.code) ? "INVALID_PAYLOAD" : typeof source?.message === "string" ? source.message : "DATABASE_UNAVAILABLE";
  const details: { fieldErrors?: Record<string, string[]>; currentVersion?: number } = {};
  if (Object.hasOwn(statuses, code)) {
    try {
      const parsed: unknown = JSON.parse(String(source?.detail ?? source?.details ?? "{}"));
      if (parsed && typeof parsed === "object") {
        if ("currentVersion" in parsed && typeof parsed.currentVersion === "number" && Number.isSafeInteger(parsed.currentVersion) && parsed.currentVersion > 0) details.currentVersion = parsed.currentVersion;
        if ("fieldErrors" in parsed && parsed.fieldErrors && typeof parsed.fieldErrors === "object" && !Array.isArray(parsed.fieldErrors)) {
          const fields = Object.entries(parsed.fieldErrors).filter(([key, value]) => /^[A-Za-z][A-Za-z0-9_.]{0,80}$/.test(key) && Array.isArray(value) && value.length <= 30 && value.every((entry) => typeof entry === "string" && entry.length <= 300));
          details.fieldErrors = Object.fromEntries(fields) as Record<string, string[]>;
        }
      }
    } catch { /* Never surface raw database/provider details. */ }
  }
  return new AdminDatabaseError(code, details);
}

/** This bootstrap is exclusively local fixture infrastructure, never a hosted Supabase seed. */
export async function createFixtureAdminDatabase(directory?: string): Promise<PGlite> {
  if (readEnvironment().APP_MODE !== "fixture") throw new AdminDatabaseError("FORBIDDEN");
  if (directory) await mkdir(directory, { recursive: true, mode: 0o700 });
  const db = await PGlite.create(directory);
  try {
    const initialized = (await db.query<{ exists: boolean }>("select exists(select 1 from pg_namespace where nspname='fixture_internal') as exists")).rows[0]?.exists;
    if (!initialized) await db.exec(`
      create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
      create schema auth; create table auth.users(id uuid primary key,email text);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to anon,authenticated,service_role; grant execute on function auth.uid() to anon,authenticated,service_role;
      create schema fixture_internal; create table fixture_internal.migrations(name text primary key);
    `);
    for (const name of (await readdir(join(process.cwd(), "supabase/migrations"))).filter((name) => /^\d+_[a-z0-9_-]+\.sql$/.test(name)).sort()) {
      const done = await db.query("select 1 from fixture_internal.migrations where name=$1", [name]);
      if (done.rows.length) continue;
      const sql = (await readFile(join(process.cwd(), "supabase/migrations", name), "utf8")).replace(/^\s*(?:begin|commit);\s*$/gm, "");
      await db.transaction(async (tx) => {
        await tx.exec(sql);
        await tx.query("insert into fixture_internal.migrations(name) values($1)", [name]);
      });
    }
    const seeded = await db.query("select 1 from fixture_internal.migrations where name='fixture-seed-v1'");
    if (!seeded.rows.length) {
      await db.transaction(async (tx) => {
        await tx.exec("set local app.environment='fixture'");
        await tx.exec(createFixtureSeedSql("fixture").replace(/^\s*(?:begin|commit);\s*$/gm, ""));
        for (const [persona, identity] of Object.entries(fixtureIdentities)) {
          await tx.query("insert into auth.users(id,email) values($1,$2)", [identity.id,identity.email]);
          if (persona !== "customer") await tx.query("insert into public.admin_memberships(user_id,role) values($1,$2)", [identity.id,persona]);
        }
        await tx.query("insert into fixture_internal.migrations(name) values('fixture-seed-v1')");
      });
    }
    return db;
  } catch (error) { await db.close(); throw error; }
}

type FixtureCache = { db?: Promise<PGlite>; serial: Promise<unknown> };
const globalCache = globalThis as typeof globalThis & { clothingFixtureAdmin?: FixtureCache };
const cache = () => globalCache.clothingFixtureAdmin ??= { serial: Promise.resolve() };

/** Parameterized named RPC call, shared by local fixture and hosted server adapters. */
export async function executeFixtureRpc<T = unknown>(db: PGlite, name: string, args: Record<string, unknown>): Promise<T> {
  if (readEnvironment().APP_MODE !== "fixture") throw new AdminDatabaseError("FORBIDDEN");
  if (!/^[a-z][a-z0-9_]{0,80}$/.test(name) || Object.keys(args).some((key) => !/^p_[a-z0-9_]{1,80}$/.test(key))) throw new AdminDatabaseError("INVALID_PAYLOAD");
  const keys = Object.keys(args);
  return db.transaction(async (tx) => {
    await tx.exec("set local role service_role");
    const signature = `public.${name}(${keys.map((key, index) => `${key} => $${index + 1}`).join(",")})`;
    const returnsSet = (await tx.query<{value:boolean}>("select coalesce(bool_or(p.proretset),false) value from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1",[name])).rows[0]!.value;
    // PGlite otherwise serializes composite values as PostgreSQL record strings.
    // Match PostgREST's object/array transport while preserving scalar JSON RPCs.
    const query = returnsSet ? `select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) as data from ${signature} r` : `select to_jsonb(${signature}) as data`;
    const result = await tx.query<{ data: T }>(query, keys.map((key) => args[key]));
    return result.rows[0]!.data;
  });
}

export async function adminRpc<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
  if (!/^[a-z][a-z0-9_]{0,80}$/.test(name) || Object.keys(args).some((key) => !/^p_[a-z0-9_]{1,80}$/.test(key))) throw new AdminDatabaseError("INVALID_PAYLOAD");
  try {
    if (readEnvironment().APP_MODE === "fixture") {
      const state = cache();
      state.db ??= createFixtureAdminDatabase(process.env.FIXTURE_DB_DIR ?? join(process.cwd(), ".fixture", "database")).catch((error: unknown) => { delete state.db; throw error; });
      // Serialize connection use, including refresh of fixture auth revocations.
      const call = state.serial.then(async () => {
        const db = await state.db!;
        const auth = fixtureAuthStore();
        for (const identity of Object.values(fixtureIdentities)) {
          const membership = auth.membership(identity.id);
          if (membership) await db.query("update public.admin_memberships set role=$2,enabled=$3 where user_id=$1", [identity.id,membership.role,membership.enabled]);
          else await db.query("update public.admin_memberships set enabled=false where user_id=$1", [identity.id]);
        }
        return executeFixtureRpc<T>(db,name,args);
      });
      state.serial = call.catch(() => undefined);
      return await call;
    }
    // The name/argument set is chosen by trusted service code, never a browser RPC proxy.
    const client = privilegedSupabase();
    const rpc = client.rpc.bind(client) as unknown as (name: string,args: Record<string,unknown>) => Promise<{ data: T; error: unknown }>;
    const { data,error } = await rpc(name,args);
    if (error) throw error;
    return data;
  } catch (error) { throw adminDatabaseError(error); }
}
