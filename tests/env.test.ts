import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { parseEnv } from "node:util";
import { test } from "node:test";
import {
  EnvironmentError, integrationConfig, publicEnvironment, readEnvironment,
} from "../src/config/env.ts";
import type { Integration } from "../src/config/env.ts";

const fixture = { APP_MODE: "fixture", APP_URL: "http://localhost:3000" };
const testing = { APP_MODE: "test", APP_URL: "http://localhost:3000" };
const live = { APP_MODE: "live", APP_URL: "https://store.example.com" };
const features: Integration[] = [
  "supabase", "r2", "razorpay", "razorpayWebhook", "shiprocket",
  "shiprocketWebhook", "jobs", "notifications",
];
// Deliberately fake test values, never used in a provider request.
const configured = {
  NEXT_PUBLIC_SUPABASE_URL: "https://project.example.com",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture",
  SUPABASE_SECRET_KEY: "test-only-private-supabase-value",
  R2_ACCOUNT_ID: "test-account",
  R2_ACCESS_KEY_ID: "test-access",
  R2_SECRET_ACCESS_KEY: "test-only-private-r2-value",
  R2_STAGING_BUCKET: "staging-media",
  R2_PUBLIC_BUCKET: "public-media",
  R2_PRIVATE_BUCKET: "private-documents",
  R2_PUBLIC_BASE_URL: "https://media.example.com",
  RAZORPAY_KEY_ID: "rzp_test_placeholder",
  RAZORPAY_KEY_SECRET: "test-only-private-payment-value",
  RAZORPAY_WEBHOOK_SECRET: "test-only-webhook-value",
  SHIPROCKET_API_EMAIL: "shipping@example.com",
  SHIPROCKET_API_PASSWORD: "test-only-private-shipping-value",
  SHIPROCKET_WEBHOOK_TOKEN: "test-only-shipping-token",
  JOBS_SECRET: "test-only-job-token-with-at-least-32-characters",
  TRANSACTIONAL_EMAIL_PROVIDER: "test-provider-name",
  TRANSACTIONAL_EMAIL_API_KEY: "test-only-private-email-value",
  TRANSACTIONAL_EMAIL_FROM: "store@example.com",
};

function failure(run: () => unknown, code: EnvironmentError["code"], variable?: string) {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof EnvironmentError);
    assert.equal(error.code, code);
    if (variable) assert.ok(error.variables.includes(variable));
    return true;
  });
}

test("shipped example and local environment run in fixture mode without credentials", () => {
  for (const filename of [".env.example", ".env.local"]) {
    const source = parseEnv(readFileSync(new URL(`../${filename}`, import.meta.url), "utf8"));
    assert.deepEqual(publicEnvironment(readEnvironment(source)), {
      mode: "fixture", appUrl: "http://localhost:3000",
    });
    for (const [key, value] of Object.entries(source)) {
      if (key !== "APP_MODE" && key !== "APP_URL") assert.equal(value, "");
    }
  }
});

test("mode is explicit and independent of NODE_ENV", () => {
  failure(() => readEnvironment({ APP_URL: fixture.APP_URL }), "ENV_INVALID", "APP_MODE");
  for (const APP_MODE of ["", "production", "typo", null]) {
    failure(() => readEnvironment({ ...fixture, APP_MODE }), "ENV_INVALID", "APP_MODE");
  }
  assert.equal(readEnvironment({ ...fixture, NODE_ENV: "production" }).APP_MODE, "fixture");
  assert.equal(readEnvironment({ ...testing, NODE_ENV: "production" }).APP_MODE, "test");
});

test("all real integrations are disabled in fixture mode even with populated credentials", () => {
  const env = readEnvironment({ ...fixture, ...configured });
  for (const feature of features) failure(() => integrationConfig(feature, env), "INTEGRATION_DISABLED");
});

test("test mode cannot enable shipping API or webhook through credentials", () => {
  const env = readEnvironment({ ...testing, ...configured });
  for (const feature of ["shiprocket", "shiprocketWebhook"] as const) {
    failure(() => integrationConfig(feature, env), "INTEGRATION_DISABLED");
  }
  assert.equal(integrationConfig("razorpay", env).RAZORPAY_KEY_ID, configured.RAZORPAY_KEY_ID);
});

test("missing live configuration blocks each feature instead of supplying fixtures", () => {
  for (const feature of features) {
    failure(() => integrationConfig(feature, readEnvironment(live)), "INTEGRATION_UNCONFIGURED");
  }
});

test("configured feature returns only its required fields and preserves secret bytes", () => {
  const env = readEnvironment({ ...live, ...configured, RAZORPAY_KEY_ID: "rzp_live_placeholder", SHIPROCKET_API_PASSWORD: "  test-secret  " });
  for (const feature of features) assert.ok(Object.isFrozen(integrationConfig(feature, env)));
  assert.deepEqual(integrationConfig("shiprocket", env), {
    SHIPROCKET_API_EMAIL: configured.SHIPROCKET_API_EMAIL, SHIPROCKET_API_PASSWORD: "  test-secret  ",
  });
  assert.deepEqual(integrationConfig("razorpayWebhook", env), {
    RAZORPAY_WEBHOOK_SECRET: configured.RAZORPAY_WEBHOOK_SECRET,
  });
});

test("empty or whitespace credentials count as missing", () => {
  for (const value of ["", "  ", "\t\n"]) {
    const env = readEnvironment({ ...testing, RAZORPAY_KEY_ID: "rzp_test_placeholder", RAZORPAY_KEY_SECRET: value });
    failure(() => integrationConfig("razorpay", env), "INTEGRATION_UNCONFIGURED", "RAZORPAY_KEY_SECRET");
  }
});

test("test and live Razorpay keys cannot be interchanged", () => {
  failure(() => readEnvironment({ ...testing, RAZORPAY_KEY_ID: "rzp_live_placeholder" }), "ENV_INVALID", "RAZORPAY_KEY_ID");
  failure(() => readEnvironment({ ...live, RAZORPAY_KEY_ID: "rzp_test_placeholder" }), "ENV_INVALID", "RAZORPAY_KEY_ID");
});

test("public R2 bucket stays separate while staging and private may share", () => {
  for (const key of ["R2_STAGING_BUCKET", "R2_PRIVATE_BUCKET"]) {
    failure(() => readEnvironment({ ...fixture, ...configured, [key]: configured.R2_PUBLIC_BUCKET }), "ENV_INVALID", "R2_PUBLIC_BUCKET");
  }
  assert.doesNotThrow(() => readEnvironment({ ...fixture, ...configured, R2_PRIVATE_BUCKET: configured.R2_STAGING_BUCKET }));
});

test("unsafe or malformed URLs fail without echoing values", () => {
  for (const APP_URL of ["invalid-secret-sentinel", "javascript:alert(1)", "https://name:secret@example.com", "https://example.com?token=secret", "https://example.com/#secret", "https://example.com/path"]) {
    failure(() => readEnvironment({ ...fixture, APP_URL }), "ENV_INVALID", "APP_URL");
  }
  for (const key of ["APP_URL", "NEXT_PUBLIC_SUPABASE_URL", "R2_PUBLIC_BASE_URL"]) {
    failure(() => readEnvironment({ ...live, [key]: "http://example.com" }), "ENV_INVALID", key);
  }
});

test("secret/service-role keys cannot occupy the public Supabase slot", () => {
  const jwt = (role: string) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.test-signature`;
  for (const key of ["sb_secret_test", jwt("service_role"), "not-a-key"]) {
    failure(() => readEnvironment({ ...fixture, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key }), "ENV_INVALID", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  }
  assert.doesNotThrow(() => readEnvironment({ ...fixture, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: jwt("anon") }));
});

test("public projection and validation errors omit supplied private values", () => {
  const env = readEnvironment({ ...fixture, ...configured, UNRELATED_SECRET: "unrelated-value" });
  assert.deepEqual(publicEnvironment(env), { mode: "fixture", appUrl: fixture.APP_URL });
  assert.equal("UNRELATED_SECRET" in env, false);
  try {
    readEnvironment({ ...fixture, APP_MODE: "secret-invalid-mode", APP_URL: "secret-invalid-url", SHIPROCKET_API_EMAIL: "secret-invalid-email", JOBS_SECRET: "secret-short-token" });
    assert.fail("invalid configuration was accepted");
  } catch (error) {
    assert.ok(error instanceof EnvironmentError);
    const printed = `${String(error)} ${error.stack} ${JSON.stringify(error)}`;
    for (const value of ["secret-invalid-mode", "secret-invalid-url", "secret-invalid-email", "secret-short-token"]) {
      assert.equal(printed.includes(value), false);
    }
  }
});

test("invalid emails and short job tokens fail before feature use", () => {
  for (const key of ["SHIPROCKET_API_EMAIL", "TRANSACTIONAL_EMAIL_FROM", "JOBS_SECRET"]) {
    failure(() => readEnvironment({ ...fixture, [key]: "invalid" }), "ENV_INVALID", key);
  }
});

test("server-only marker rejects import without server resolution conditions", () => {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", "await import('./src/config/env.ts')"], {
    cwd: new URL("../", import.meta.url), env, encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cannot be imported from a Client Component module/);
});
