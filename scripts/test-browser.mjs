import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const port = Number(process.env.BROWSER_TEST_PORT ?? "3107");
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("BROWSER_TEST_PORT must be an integer from 1024 to 65535.");
const origin = `http://127.0.0.1:${port}`;
const reviewDirectory = join(projectRoot, "review");
const fixtureAuthDirectory = await mkdtemp(join(tmpdir(), "clothing-store-browser-auth-"));
const unexpectedOrigins = new Set();
const pageErrors = [];
let nextServer;
let serverExited = false;
let browser;

async function assertFreePort() {
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", () => reject(new Error(`Browser test port ${port} is already occupied or unavailable.`)));
    probe.listen({ port, host: "127.0.0.1", exclusive: true }, () => probe.close(resolve));
  });
}

async function waitForServer() {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (serverExited) throw new Error("Managed Next.js test server exited before readiness.");
    try {
      const response = await fetch(`${origin}/admin/login`, { redirect: "manual", signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch { /* Retry only our isolated local server while it compiles. */ }
    await delay(300);
  }
  throw new Error("Managed Next.js test server did not become ready within 90 seconds.");
}

async function newContext(viewport) {
  const context = await browser.newContext({ baseURL: origin, viewport, reducedMotion: "reduce" });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if ((url.protocol === "http:" || url.protocol === "https:") && url.origin !== origin) {
      unexpectedOrigins.add(url.origin); // Never retain query strings or request bodies.
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
  context.on("page", (page) => page.on("pageerror", (error) => pageErrors.push(error.name)));
  return context;
}

async function assertNoOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
  }));
  assert.ok(dimensions.scroll <= dimensions.client + 1, `Horizontal overflow at viewport width ${dimensions.client}`);
}

async function session(context, status, role) {
  const response = await context.request.get("/api/v1/admin/session", { maxRedirects: 0 });
  assert.equal(response.status(), status);
  assert.match(response.headers()["cache-control"] ?? "", /no-store/);
  const body = await response.json();
  if (role) assert.equal(body.data?.role, role);
  else assert.equal(body.error?.code, status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN");
}

async function signIn(page, persona, destination = "/admin") {
  await page.goto("/admin/login");
  await page.getByLabel("Preview identity").selectOption(persona);
  await Promise.all([
    page.waitForURL((url) => url.pathname === destination),
    page.getByRole("button", { name: "Enter fixture workspace" }).click(),
  ]);
  await page.getByRole("heading", { level: 1 }).waitFor();
}

async function signOut(page, context) {
  await Promise.all([
    page.waitForURL((url) => url.pathname === "/admin/login"),
    page.getByRole("button", { name: "Sign out", exact: true }).click(),
  ]);
  await session(context, 401);
}

try {
  await assertFreePort();
  await mkdir(reviewDirectory, { recursive: true });
  nextServer = spawn(process.execPath, [join(projectRoot, "node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: projectRoot,
    env: { ...process.env, APP_MODE: "fixture", APP_URL: origin, FIXTURE_AUTH_DIR: fixtureAuthDirectory, FIXTURE_DB_DIR: join(fixtureAuthDirectory, "database"), FIXTURE_MEDIA_DIR: join(fixtureAuthDirectory, "media"), NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "ignore", "ignore"],
    detached: process.platform !== "win32",
  });
  nextServer.once("exit", () => { serverExited = true; });
  nextServer.once("error", () => { serverExited = true; });
  await waitForServer();

  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
  });
  const desktop = await newContext({ width: 1440, height: 1000 });
  const page = await desktop.newPage();
  await page.goto("/admin");
  await page.waitForURL((url) => url.pathname === "/admin/login");
  await page.getByRole("heading", { name: "Sign in to your workspace." }).waitFor();
  await session(desktop, 401);
  assert.match(await page.locator('meta[name="robots"]').getAttribute("content") ?? "", /noindex/);
  await assertNoOverflow(page);
  console.log("PASS anonymous admin redirect, noindex and direct API denial");

  await desktop.addCookies([{ name: "clothing_fixture_session", value: "A".repeat(43), url: origin, httpOnly: true, sameSite: "Lax" }]);
  await session(desktop, 401);
  await desktop.clearCookies();
  const crossOrigin = await desktop.request.post("/api/v1/auth/fixture", {
    form: { persona: "owner" }, headers: { Origin: "https://untrusted.example" }, maxRedirects: 0,
  });
  assert.equal(crossOrigin.status(), 403);
  await session(desktop, 401);
  console.log("PASS forged session and cross-origin auth request denied");

  await signIn(page, "owner");
  await session(desktop, 200, "owner");
  const authCookie = (await desktop.cookies()).find((cookie) => cookie.name === "clothing_fixture_session");
  assert.ok(authCookie?.httpOnly);
  assert.equal(authCookie?.sameSite, "Lax");
  assert.equal(await page.evaluate(() => document.cookie.includes("clothing_fixture_session")), false);
  await assertNoOverflow(page);
  await page.screenshot({ path: join(reviewDirectory, "admin-overview-desktop.png"), fullPage: true });
  await signOut(page, desktop);
  console.log("PASS fixture owner sign-in, private cookie, desktop layout and logout");

  await signIn(page, "staff");
  await session(desktop, 200, "staff");
  await signOut(page, desktop);
  await signIn(page, "customer", "/admin/no-access");
  await page.getByRole("heading", { name: "Admin access required." }).waitFor();
  await session(desktop, 403);
  await signOut(page, desktop);
  console.log("PASS fixture staff access and nonadmin no-access/API denial");

  await page.goto("/admin/forgot-password");
  await page.getByText("No recovery email is sent.", { exact: false }).waitFor();
  assert.equal(await page.locator('input[type="email"]').count(), 0);
  await page.goto("/admin/reset-password");
  await page.getByRole("heading", { name: "Fixture recovery" }).waitFor();
  assert.equal(await page.locator('input[type="password"]').count(), 0);
  for (const action of ["forgot-password", "reset-password"]) {
    const response = await desktop.request.post(`/api/v1/auth/${action}`, {
      form: {}, headers: { Origin: origin }, maxRedirects: 0,
    });
    assert.equal(response.status(), 303);
    assert.equal(new URL(response.headers().location, origin).pathname, "/admin/login");
    assert.equal(new URL(response.headers().location, origin).searchParams.get("error"), "fixture");
  }
  console.log("PASS fixture recovery pages and requests stay local");

  const mobile = await newContext({ width: 390, height: 844 });
  const mobilePage = await mobile.newPage();
  await mobilePage.goto("/admin/login");
  await mobilePage.getByRole("heading", { name: "Sign in to your workspace." }).waitFor();
  await assertNoOverflow(mobilePage);
  await mobilePage.screenshot({ path: join(reviewDirectory, "admin-login-mobile.png"), fullPage: true });
  await mobilePage.setViewportSize({ width: 320, height: 800 });
  await assertNoOverflow(mobilePage);
  await signIn(mobilePage, "owner");
  await assertNoOverflow(mobilePage);
  await mobilePage.setViewportSize({ width: 390, height: 844 });
  await assertNoOverflow(mobilePage);
  await signOut(mobilePage, mobile);
  console.log("PASS 390px and 320px login/admin layouts have no horizontal overflow");

  assert.equal(unexpectedOrigins.size, 0, `Unexpected external browser origins: ${[...unexpectedOrigins].join(", ")}`);
  assert.equal(pageErrors.length, 0, `Browser JavaScript errors: ${pageErrors.join(", ")}`);
  console.log("PASS M1 browser checks; no external browser requests or page errors");
  console.log("Screenshots: review/admin-login-mobile.png and review/admin-overview-desktop.png");
} finally {
  await browser?.close();
  if (nextServer && !serverExited) {
    const signal = (name) => {
      try {
        if (process.platform === "win32") nextServer.kill(name);
        else process.kill(-nextServer.pid, name);
      } catch { /* The child may already have exited during cleanup. */ }
    };
    signal("SIGTERM");
    for (let attempts = 0; attempts < 20 && !serverExited; attempts += 1) await delay(100);
    if (!serverExited) signal("SIGKILL");
  }
  await rm(fixtureAuthDirectory, { recursive: true, force: true });
}
