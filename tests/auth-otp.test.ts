import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { storeOtpAction, storeOtpRequestSchema, storeOtpResponse, storeOtpVerifySchema } from "../src/lib/auth/store-otp.ts";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const keys = ["APP_MODE", "APP_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY", "FIXTURE_AUTH_DIR"] as const;
const previous: Record<string, string | undefined> = {};
let fixtureDir = "";

before(() => {
  for (const key of keys) previous[key] = process.env[key];
  fixtureDir = mkdtempSync(join(tmpdir(), "clothing-store-otp-"));
  process.env.APP_MODE = "fixture";
  process.env.APP_URL = "http://localhost:3000";
  process.env.FIXTURE_AUTH_DIR = fixtureDir;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  delete process.env.SUPABASE_SECRET_KEY;
});

after(() => {
  for (const key of keys) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
  rmSync(fixtureDir, { recursive: true, force: true });
});

function cookieValue(response: Response, name: string) {
  const header = response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`));
  return header?.slice(name.length + 1).split(";")[0];
}

function request(action: string, body: unknown, cookie?: string) {
  return new Request(`http://localhost:3000/api/v1/auth/store-otp/${action}`, {
    method: "POST",
    headers: {
      origin: "http://localhost:3000",
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

test("store OTP schemas require a six-digit code and reject passwords", () => {
  assert.equal(storeOtpRequestSchema.parse({ intent: "login", email: " Shopper@Example.invalid " }).email, "shopper@example.invalid");
  assert.equal(storeOtpRequestSchema.safeParse({ intent: "login", email: "shopper@example.invalid", password: "secret" }).success, false);
  assert.equal(storeOtpRequestSchema.safeParse({ intent: "signup", email: "shopper@example.invalid" }).success, false);
  assert.equal(storeOtpRequestSchema.parse({
    intent: "signup",
    email: "shopper@example.invalid",
    firstName: "Ada",
    lastName: "Lovelace",
  }).intent, "signup");
  assert.equal(storeOtpVerifySchema.safeParse({ email: "shopper@example.invalid", token: "1234" }).success, false);
  assert.equal(storeOtpVerifySchema.safeParse({ email: "shopper@example.invalid", token: "1234567" }).success, false);
  assert.equal(storeOtpVerifySchema.parse({ email: "shopper@example.invalid", token: "123456" }).token, "123456");
});

test("branded OTP template keeps the numeric token and hosted SS26 image", () => {
  const html = readFileSync(join(root, "docs/supabase/email-otp-template.html"), "utf8");
  assert.match(html, /\{\{ \.Token \}\}/);
  assert.match(html, /\/email\/P_Co-SS26-4\.jpg/);
  assert.ok(statSync(join(root, "public/email/P_Co-SS26-4.jpg")).size > 0);
});

test("fixture store OTP request/verify issues a session and rejects a wrong code", async () => {
  const requested = await storeOtpResponse(() => storeOtpAction(request("request", { intent: "login", email: "shopper@example.invalid" }), "request"));
  assert.equal(requested.status, 200);
  const payload = await requested.json() as { data: { accepted: boolean; fixtureToken: string; message: string } };
  assert.equal(payload.data.accepted, true);
  assert.match(payload.data.fixtureToken, /^\d{6}$/);
  assert.match(payload.data.message, /no email sent/i);
  const challenge = cookieValue(requested, "clothing_fixture_store_otp");
  assert.ok(challenge);

  const denied = await storeOtpResponse(() => storeOtpAction(
    request("verify", { email: "shopper@example.invalid", token: payload.data.fixtureToken === "000000" ? "111111" : "000000" }, `clothing_fixture_store_otp=${challenge}`),
    "verify",
  ));
  assert.equal(denied.status, 400);
  const deniedBody = await denied.json() as { error: { code: string } };
  assert.equal(deniedBody.error.code, "OTP_INVALID");

  const verified = await storeOtpResponse(() => storeOtpAction(
    request("verify", { email: "shopper@example.invalid", token: payload.data.fixtureToken, next: "/wishlist" }, `clothing_fixture_store_otp=${challenge}`),
    "verify",
  ));
  assert.equal(verified.status, 200);
  const granted = await verified.json() as { data: { href: string } };
  assert.equal(granted.data.href, "/wishlist");
  assert.ok(cookieValue(verified, "clothing_fixture_session"));
});

test("store OTP JSON errors map rate-limit and unknown actions", async () => {
  const limited = await storeOtpResponse(async () => { throw new Error("RATE_LIMIT"); });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "60");
  const missing = await storeOtpResponse(() => storeOtpAction(request("reset", { intent: "login", email: "shopper@example.invalid" }), "reset"));
  assert.equal(missing.status, 404);
});
