import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AccessError, authRecoveryFailure, authorizeAdmin, safeAuthDestination, safeCallbackDestination, safeStoreAuthDestination } from "../src/lib/auth/policy.ts";
import { fixtureAuthStore, fixtureIdentities } from "../src/lib/auth/fixture.ts";

test("anonymous/nonadmin/disabled/wrong-user identities cannot become admin", () => {
  const user = { id: "user" };
  const member = { userId: "user", role: "staff" as const, enabled: true };
  assert.throws(() => authorizeAdmin(null, member), (e: unknown) => e instanceof AccessError && e.status === 401);
  for (const membership of [null, { ...member, enabled: false }, { ...member, userId: "another-user" }]) {
    assert.throws(() => authorizeAdmin(user, membership), (e: unknown) => e instanceof AccessError && e.status === 403);
  }
  assert.equal(authorizeAdmin(user, member).role, "staff");
  assert.throws(() => authorizeAdmin(user, member, true), AccessError);
  assert.equal(authorizeAdmin(user, { ...member, role: "owner" }, true).role, "owner");
});

test("redirect destination is restricted to exact supported local paths", () => {
  for (const input of [null, "https://evil.example", "//evil.example", "/admin/reset-password?next=evil", "/admin/../evil", "javascript:alert(1)"]) {
    assert.equal(safeAuthDestination(input), "/admin");
  }
  assert.equal(safeAuthDestination("/admin/reset-password"), "/admin/reset-password");
});

test("store auth redirects stay on allowed storefront paths", () => {
  assert.equal(safeStoreAuthDestination(null), "/account");
  assert.equal(safeStoreAuthDestination(""), "/account");
  assert.equal(safeStoreAuthDestination("/account"), "/account");
  assert.equal(safeStoreAuthDestination("/account/reset-password"), "/account/reset-password");
  assert.equal(safeStoreAuthDestination("/wishlist"), "/wishlist");
  assert.equal(safeStoreAuthDestination("/checkout"), "/checkout");
  assert.equal(safeStoreAuthDestination("/track-order"), "/track-order");
  assert.equal(safeStoreAuthDestination("/orders/00000000-0000-4000-8000-000000000001"), "/orders/00000000-0000-4000-8000-000000000001");
  assert.equal(safeStoreAuthDestination("/"), "/");
  for (const input of ["https://evil.example", "//evil.example", "/\\evil", "/admin", "/admin/reset-password", "/account/../admin", "javascript:alert(1)", "/wishlist/../../admin"]) {
    assert.equal(safeStoreAuthDestination(input), "/account");
  }
  assert.equal(safeCallbackDestination("/admin/reset-password"), "/admin/reset-password");
  assert.equal(safeCallbackDestination("/account/reset-password"), "/account/reset-password");
  assert.equal(safeCallbackDestination("/admin/login"), "/admin");
  assert.equal(safeCallbackDestination("https://evil.example"), "/admin");
  assert.equal(authRecoveryFailure("/account"), "/account?tab=login&error=recovery");
  assert.equal(authRecoveryFailure("/admin/reset-password"), "/admin/login?error=recovery");
});

test("fixture sessions are opaque, hashed, revocable and check current membership", () => {
  const temporary = mkdtempSync(join(tmpdir(), "clothing-auth-"));
  const originalMode = process.env.APP_MODE;
  const originalUrl = process.env.APP_URL;
  process.env.APP_MODE = "fixture";
  process.env.APP_URL = "http://localhost:3000";
  try {
    const file = join(temporary, "auth.json");
    const store = fixtureAuthStore(file);
    const token = store.signIn("owner");
    assert.equal(readFileSync(file, "utf8").includes(token), false);
    assert.equal(store.user("owner"), null);
    assert.equal(store.user(`${token}x`), null);
    assert.equal(authorizeAdmin(store.user(token), store.membership(fixtureIdentities.owner.id)).role, "owner");
    store.setEnabled(fixtureIdentities.owner.id, false);
    assert.throws(() => authorizeAdmin(store.user(token), store.membership(fixtureIdentities.owner.id)), AccessError);
    store.signOut(token);
    assert.equal(store.user(token), null);
    process.env.APP_MODE = "test";
    assert.throws(() => store.signIn("owner"), /disabled/);
  } finally {
    if (originalMode === undefined) delete process.env.APP_MODE; else process.env.APP_MODE = originalMode;
    if (originalUrl === undefined) delete process.env.APP_URL; else process.env.APP_URL = originalUrl;
    rmSync(temporary, { recursive: true, force: true });
  }
});
