import "server-only";
import { Buffer } from "node:buffer";
import { z } from "zod";

// Blank optional values are unconfigured. Preserve nonblank secrets exactly.
const optional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
    schema.optional(),
  );

const text = z.string().min(1);
const httpUrl = z.string().url().refine((value) => {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol)
      && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
});
const origin = httpUrl.refine((value) => {
  try { return new URL(value).pathname === "/"; } catch { return false; }
});

// A shape check to prevent accidental privileged-key exposure, not JWT auth.
const publishableKey = text.refine((value) => {
  if (value.startsWith("sb_publishable_") && value.length > 15) return true;
  const parts = value.split(".");
  if (parts.length !== 3 || !parts[1]) return false;
  try {
    const payload: unknown = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    return typeof payload === "object" && payload !== null
      && "role" in payload && payload.role === "anon";
  } catch {
    return false;
  }
});

const schema = z.object({
  APP_MODE: z.enum(["fixture", "test", "live"]),
  APP_URL: origin,
  NEXT_PUBLIC_SUPABASE_URL: optional(origin),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: optional(publishableKey),
  SUPABASE_SECRET_KEY: optional(text),
  R2_ACCOUNT_ID: optional(text),
  R2_ACCESS_KEY_ID: optional(text),
  R2_SECRET_ACCESS_KEY: optional(text),
  R2_STAGING_BUCKET: optional(text),
  R2_PUBLIC_BUCKET: optional(text),
  R2_PRIVATE_BUCKET: optional(text),
  R2_PUBLIC_BASE_URL: optional(httpUrl),
  RAZORPAY_KEY_ID: optional(z.string().regex(/^rzp_(test|live)_[A-Za-z0-9]+$/)),
  RAZORPAY_KEY_SECRET: optional(text),
  RAZORPAY_WEBHOOK_SECRET: optional(text),
  SHIPROCKET_API_EMAIL: optional(z.string().email()),
  SHIPROCKET_API_PASSWORD: optional(text),
  SHIPROCKET_WEBHOOK_TOKEN: optional(text),
  JOBS_SECRET: optional(z.string().min(32)),
  TRANSACTIONAL_EMAIL_PROVIDER: optional(text),
  TRANSACTIONAL_EMAIL_API_KEY: optional(text),
  TRANSACTIONAL_EMAIL_FROM: optional(z.string().email()),
}).superRefine((env, ctx) => {
  const invalid = (key: string) => ctx.addIssue({
    code: z.ZodIssueCode.custom, path: [key], message: "Invalid configuration",
  });
  if (env.APP_MODE === "live") {
    for (const key of ["APP_URL", "NEXT_PUBLIC_SUPABASE_URL", "R2_PUBLIC_BASE_URL"] as const) {
      if (env[key] && !env[key].startsWith("https://")) invalid(key);
    }
  }
  if (env.R2_PUBLIC_BUCKET && [env.R2_STAGING_BUCKET, env.R2_PRIVATE_BUCKET].includes(env.R2_PUBLIC_BUCKET)) {
    invalid("R2_PUBLIC_BUCKET");
  }
  if (env.APP_MODE !== "fixture" && env.RAZORPAY_KEY_ID
    && !env.RAZORPAY_KEY_ID.startsWith(`rzp_${env.APP_MODE}_`)) {
    invalid("RAZORPAY_KEY_ID");
  }
});

export type Environment = Readonly<z.infer<typeof schema>>;
export type AppMode = Environment["APP_MODE"];

export class EnvironmentError extends Error {
  readonly code: "ENV_INVALID" | "INTEGRATION_UNCONFIGURED" | "INTEGRATION_DISABLED";
  readonly variables: readonly string[];

  constructor(code: EnvironmentError["code"], variables: readonly string[]) {
    // Never retain raw values, source objects or Zod errors in this exception.
    super(`${code}: ${variables.join(", ")}`);
    this.name = "EnvironmentError";
    this.code = code;
    this.variables = Object.freeze([...variables]);
  }
}

/** Vercel does not ship `.env.local`; derive a stable origin when APP_URL is unset. */
function withDeploymentDefaults(source: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const env = { ...source };
  const appUrl = env.APP_URL;
  if ((typeof appUrl !== "string" || appUrl.trim() === "") && env.VERCEL === "1") {
    const host = [env.VERCEL_PROJECT_PRODUCTION_URL, env.VERCEL_URL].find(
      (value): value is string => typeof value === "string" && value.trim().length > 0,
    );
    if (host) {
      const normalized = host.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
      env.APP_URL = `https://${normalized}`;
    }
  }
  return env;
}

/** Call at server startup or feature entry; never serialize this whole object. */
export function readEnvironment(source: Readonly<Record<string, unknown>> = process.env): Environment {
  const parsed = schema.safeParse(withDeploymentDefaults(source));
  if (!parsed.success) {
    throw new EnvironmentError("ENV_INVALID", [...new Set(
      parsed.error.issues.map((issue) => issue.path.join(".")),
    )]);
  }
  return Object.freeze(parsed.data);
}

const required = {
  supabase: ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY"],
  r2: ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_STAGING_BUCKET", "R2_PUBLIC_BUCKET", "R2_PRIVATE_BUCKET", "R2_PUBLIC_BASE_URL"],
  razorpay: ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"],
  razorpayWebhook: ["RAZORPAY_WEBHOOK_SECRET"],
  shiprocket: ["SHIPROCKET_API_EMAIL", "SHIPROCKET_API_PASSWORD"],
  shiprocketWebhook: ["SHIPROCKET_WEBHOOK_TOKEN"],
  jobs: ["JOBS_SECRET"],
  notifications: ["TRANSACTIONAL_EMAIL_PROVIDER", "TRANSACTIONAL_EMAIL_API_KEY", "TRANSACTIONAL_EMAIL_FROM"],
} as const satisfies Record<string, readonly (keyof Environment)[]>;

export type Integration = keyof typeof required;
type IntegrationConfig<K extends Integration> = {
  readonly [Key in (typeof required)[K][number]]: NonNullable<Environment[Key]>;
};

/** Guard future real adapters before construction. This makes no external calls. */
export function integrationConfig<K extends Integration>(
  integration: K,
  env: Environment = readEnvironment(),
): IntegrationConfig<K> {
  if (env.APP_MODE === "fixture"
    || (env.APP_MODE === "test" && (integration === "shiprocket" || integration === "shiprocketWebhook"))) {
    throw new EnvironmentError("INTEGRATION_DISABLED", ["APP_MODE"]);
  }
  const keys = required[integration];
  const missing = keys.filter((key) => !env[key]);
  if (missing.length) throw new EnvironmentError("INTEGRATION_UNCONFIGURED", missing);
  return Object.freeze(Object.fromEntries(keys.map((key) => [key, env[key]]))) as IntegrationConfig<K>;
}

/** The only general-purpose projection intended for client serialization. */
export function publicEnvironment(env: Environment) {
  return Object.freeze({ mode: env.APP_MODE, appUrl: env.APP_URL });
}
