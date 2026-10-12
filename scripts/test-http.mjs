import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const port = Number(process.env.HTTP_TEST_PORT ?? "3108");
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("HTTP_TEST_PORT must be an integer from 1024 to 65535.");
const origin = `http://127.0.0.1:${port}`;
const fixtureAuthDirectory = await mkdtemp(join(tmpdir(), "clothing-store-http-auth-"));
const sessionName = "clothing_fixture_session";
let server;
let serverExited = false;

async function assertFreePort() {
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", (error) => reject(new Error(`HTTP test port ${port} unavailable (${error.code ?? "unknown"}).`)));
    probe.listen({ port, host: "127.0.0.1", exclusive: true }, () => probe.close(resolve));
  });
}

async function waitForServer() {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (serverExited) throw new Error("Managed production Next.js server exited before readiness; run npm run build first.");
    try {
      const response = await fetch(`${origin}/admin/login`, { redirect: "manual", signal: AbortSignal.timeout(2_000) });
      if (response.ok) { await response.body?.cancel(); return; }
      await response.body?.cancel();
    } catch { /* Wait only for our local managed server. */ }
    await delay(200);
  }
  throw new Error("Managed production Next.js server did not become ready within 45 seconds.");
}

async function request(path, options = {}) {
  const target = new URL(path, origin);
  assert.equal(target.origin, origin, "HTTP tests may only contact the managed local server");
  return fetch(target, { ...options, redirect: "manual", signal: AbortSignal.timeout(10_000) });
}

async function post(action, body = "", cookie, extraHeaders = {}) {
  return request(`/api/v1/auth/${action}`, {
    method: "POST", body,
    headers: { Origin: origin, "Content-Type": "application/x-www-form-urlencoded", ...(cookie ? { Cookie: cookie } : {}), ...extraHeaders },
  });
}

function noStore(response) { assert.match(response.headers.get("cache-control") ?? "", /no-store/); }
function noIndex(response) { assert.match(response.headers.get("x-robots-tag") ?? "", /noindex/); }
function redirected(response, destination, status = 303) {
  assert.equal(response.status, status);
  const target = new URL(response.headers.get("location"), origin);
  assert.equal(target.origin, origin);
  assert.equal(target.pathname, destination);
  return target;
}

async function session(cookie, expectedStatus, role) {
  const response = await request("/api/v1/admin/session", { headers: cookie ? { Cookie: cookie } : {} });
  assert.equal(response.status, expectedStatus);
  noStore(response); noIndex(response);
  const result = await response.json();
  if (role) assert.equal(result.data?.role, role);
  else assert.equal(result.error?.code, expectedStatus === 401 ? "UNAUTHENTICATED" : "FORBIDDEN");
}

async function login(persona) {
  const response = await post("fixture", new URLSearchParams({ persona }).toString());
  redirected(response, "/admin"); noStore(response);
  const header = response.headers.getSetCookie().find((value) => value.startsWith(`${sessionName}=`));
  assert.ok(header, "Fixture login should set the session cookie");
  assert.match(header, /;\s*HttpOnly(?:;|$)/i);
  assert.match(header, /;\s*SameSite=Lax(?:;|$)/i);
  assert.match(header, /;\s*Path=\/(?:;|$)/i);
  assert.match(header, /;\s*Max-Age=28800(?:;|$)/i);
  return header.split(";", 1)[0];
}

async function logout(cookie) {
  const response = await post("logout", "", cookie);
  redirected(response, "/admin/login"); noStore(response);
  const header = response.headers.getSetCookie().find((value) => value.startsWith(`${sessionName}=`));
  assert.match(header ?? "", /;\s*Max-Age=0(?:;|$)/i);
  await session(cookie, 401); // Replay the old cookie to prove server-side revocation.
}

try {
  await access(join(projectRoot, ".next/BUILD_ID"));
  await assertFreePort();
  server = spawn(process.execPath, [join(projectRoot, "node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: projectRoot,
    env: { ...process.env, APP_MODE: "fixture", APP_URL: origin, FIXTURE_AUTH_DIR: fixtureAuthDirectory, FIXTURE_DB_DIR: join(fixtureAuthDirectory, "database"), FIXTURE_MEDIA_DIR: join(fixtureAuthDirectory, "media"), NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "ignore", "ignore"], detached: process.platform !== "win32",
  });
  server.once("exit", () => { serverExited = true; });
  server.once("error", () => { serverExited = true; });
  await waitForServer();

  const anonymous = await request("/admin");
  redirected(anonymous, "/admin/login", 307); noStore(anonymous); noIndex(anonymous);
  const loginPage = await request("/admin/login");
  assert.equal(loginPage.status, 200); noStore(loginPage); noIndex(loginPage);
  const loginHtml = await loginPage.text();
  assert.match(loginHtml, /Fixture preview/);
  assert.match(loginHtml, /name="robots" content="[^"]*noindex/);
  await session(undefined, 401);
  await session(`${sessionName}=${"A".repeat(43)}`, 401);
  console.log("PASS anonymous redirect, forged session denial, no-store and noindex");

  const deniedOrigin = await post("fixture", "persona=owner", undefined, { Origin: "https://untrusted.example" });
  assert.equal(deniedOrigin.status, 403);
  const missingOrigin = await request("/api/v1/auth/fixture", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "persona=owner" });
  assert.equal(missingOrigin.status, 403);
  await session(undefined, 401);
  console.log("PASS cross-origin and missing-origin auth requests denied");

  const ownerCookie = await login("owner");
  await session(ownerCookie, 200, "owner");
  const ownerPage = await request("/admin", { headers: { Cookie: ownerCookie } });
  assert.equal(ownerPage.status, 200); noStore(ownerPage); noIndex(ownerPage);
  const ownerHtml = await ownerPage.text();
  assert.match(ownerHtml, /aria-label="Admin navigation"/);
  assert.match(ownerHtml, /href="\/admin\/orders"/);
  assert.match(ownerHtml, /FIXTURE/);
  await logout(ownerCookie);
  console.log("PASS owner access, HttpOnly/SameSite cookie and revoked-cookie logout");

  const staffCookie = await login("staff");
  await session(staffCookie, 200, "staff");
  const authPath = join(fixtureAuthDirectory, "auth.json");
  const store = JSON.parse(await readFile(authPath, "utf8"));
  const staffMembership = Object.values(store.memberships).find((member) => member.role === "staff");
  assert.ok(staffMembership);
  staffMembership.enabled = false;
  await writeFile(authPath, JSON.stringify(store), { mode: 0o600 });
  await session(staffCookie, 403);
  redirected(await request("/admin", { headers: { Cookie: staffCookie } }), "/admin/no-access", 307);
  await logout(staffCookie);
  console.log("PASS staff access and immediate membership revocation on protected requests");

  const customerCookie = await login("customer");
  await session(customerCookie, 403);
  redirected(await request("/admin", { headers: { Cookie: customerCookie } }), "/admin/no-access", 307);
  const noAccess = await request("/admin/no-access", { headers: { Cookie: customerCookie } });
  assert.equal(noAccess.status, 200); noIndex(noAccess);
  assert.match(await noAccess.text(), /Admin access required/);
  await logout(customerCookie);
  console.log("PASS nonadmin protected-route/API denial and no-access page");

  const forgotPage = await request("/admin/forgot-password");
  assert.equal(forgotPage.status, 200); noStore(forgotPage); noIndex(forgotPage);
  const forgotHtml = await forgotPage.text();
  assert.match(forgotHtml, /No recovery email is sent/);
  assert.doesNotMatch(forgotHtml, /<input[^>]*type="email"/);
  const resetPage = await request("/admin/reset-password");
  assert.equal(resetPage.status, 200); noStore(resetPage); noIndex(resetPage);
  const resetHtml = await resetPage.text();
  assert.match(resetHtml, /Demo identities do not use passwords or send email/);
  assert.doesNotMatch(resetHtml, /<input[^>]*type="password"/);
  for (const action of ["login", "forgot-password", "reset-password"]) {
    const response = await post(action);
    const target = redirected(response, "/admin/login");
    assert.equal(target.searchParams.get("error"), "fixture"); noStore(response);
  }
  console.log("PASS fixture password/recovery pages and requests remain inactive");

  for (const body of ["persona=%ZZ", "persona=%C3%28", "persona=owner&persona=staff"]) {
    const response = await post("fixture", body);
    assert.equal(response.status, 400); noStore(response);
  }
  const unsupported = await post("fixture", "{}", undefined, { "Content-Type": "application/json" });
  assert.equal(unsupported.status, 415); noStore(unsupported);
  const oversized = await post("fixture", `persona=${"x".repeat(4_100)}`);
  assert.equal(oversized.status, 413); noStore(oversized);
  const chunked = await request("/api/v1/auth/fixture", {
    method: "POST", duplex: "half", headers: { Origin: origin, "Content-Type": "application/x-www-form-urlencoded" },
    body: new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(`persona=${"x".repeat(3_000)}`));
      controller.enqueue(new TextEncoder().encode("x".repeat(2_000)));
      controller.close();
    } }),
  });
  assert.equal(chunked.status, 413); noStore(chunked);
  await session(undefined, 401);
  console.log("PASS malformed/duplicate forms 400, unsupported encoding 415, declared/chunked oversize 413");
  console.log("PASS M1 HTTP integration checks against a managed local production server in fixture mode");
} finally {
  if (server && !serverExited) {
    const signal = (name) => {
      try {
        if (process.platform === "win32") server.kill(name);
        else process.kill(-server.pid, name);
      } catch { /* The managed child can finish between checks. */ }
    };
    signal("SIGTERM");
    for (let attempts = 0; attempts < 20 && !serverExited; attempts += 1) await delay(100);
    if (!serverExited) signal("SIGKILL");
  }
  await rm(fixtureAuthDirectory, { recursive: true, force: true });
}
