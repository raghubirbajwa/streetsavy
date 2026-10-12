import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { databaseTypes } from "./generate-db-types.ts";

// Real PostgreSQL SQL/RLS execution in a fresh embedded database. No external connection.
// Single-connection PGlite does not verify cross-process lock contention or Supabase Auth.
const client = await PGlite.create();
try {
  await client.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),
        nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
    $$;
    grant usage on schema auth to anon,authenticated,service_role;
    grant execute on function auth.uid() to anon,authenticated,service_role;
  `);
  for (const name of readdirSync("supabase/migrations").filter((name) => name.endsWith(".sql")).sort()) {
    await client.exec(readFileSync(join("supabase/migrations", name), "utf8"));
    console.log(`PASS migration ${name}`);
  }
  const generated = await databaseTypes(client);
  if (process.argv.includes("--generate-types")) {
    writeFileSync("src/lib/supabase/database.types.ts", generated);
    console.log("Generated database.types.ts from PostgreSQL schema.");
  } else {
    assert.equal(readFileSync("src/lib/supabase/database.types.ts", "utf8"), generated, "Database types are stale: run npm run types:db");
  }
  for (const name of readdirSync("tests/database").filter((name) => name.endsWith(".sql")).sort()) {
    await client.query("begin");
    try {
      await client.exec(readFileSync(join("tests/database", name), "utf8"));
      console.log(`PASS SQL assertions ${name}`);
    } finally { await client.query("rollback"); }
  }
  // Exercise the actual trusted bootstrap SQL with psql directives removed and
  // its one UUID variable substituted by a known test literal.
  const ownerId = "00000000-0000-4000-8000-000000000099";
  const bootstrap = readFileSync("scripts/bootstrap-owner.sql", "utf8").split("\n")
    .filter((line) => !line.startsWith("\\")).join("\n").replace(":'owner_user_id'", `'${ownerId}'`);
  await assert.rejects(client.exec(bootstrap), /Create and verify/);
  await client.query("rollback");
  await client.query("insert into auth.users(id) values ($1)", [ownerId]);
  await client.exec(bootstrap);
  assert.equal((await client.query<{role: string}>("select role from public.admin_memberships where user_id=$1", [ownerId])).rows[0]?.role, "owner");
  await client.query("update public.admin_memberships set enabled=false where user_id=$1", [ownerId]);
  await client.exec(bootstrap);
  assert.equal((await client.query<{enabled: boolean}>("select enabled from public.admin_memberships where user_id=$1", [ownerId])).rows[0]?.enabled, true);
  assert.equal((await client.query<{count: number}>("select count(*)::int as count from public.audit_logs where action='admin.owner.bootstrap'")).rows[0]?.count, 2);
  console.log("PASS trusted owner bootstrap/recovery and audit trail");
  // Fixture seed must satisfy the real schema and match the actual public RPC.
  const { createFixtureSeedSql } = await import("../src/data/fixtures/seed-sql.ts");
  const { fixtureCatalogSnapshot } = await import("../src/lib/catalog/fixture.ts");
  const { catalogSnapshotSchema } = await import("../src/lib/validation/catalog.ts");
  await client.query("set app.environment = 'test'");
  await client.exec(createFixtureSeedSql("test"));
  await client.query("set role anon");
  const snapshot = catalogSnapshotSchema.parse((await client.query<{data: unknown}>("select public.public_catalog() as data")).rows[0]?.data);
  assert.equal(snapshot.products.length, 16);
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), JSON.parse(JSON.stringify(fixtureCatalogSnapshot)));
  await client.query("reset role");
  console.log("PASS fixture seed and public PostgreSQL projection parity (16 products)");
  console.log("PASS database checks; only an isolated local test database was used.");
} finally {
  await client.close();
}
