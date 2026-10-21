import "server-only";
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { EnvironmentError, readEnvironment } from "../../config/env.ts";
import { allowAuthAttempt, sameOrigin } from "../http/security.ts";
import { fixtureAuthStore, fixtureSessionCookie, fixtureSessionSeconds } from "./fixture.ts";
import { safeStoreAuthDestination } from "./policy.ts";

const name = z.string().trim().min(1).max(80).refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "Remove control characters.");
const email = z.string().trim().email().max(254).transform((value) => value.toLowerCase());
const nextPath = z.string().max(200).optional();

export const storeOtpRequestSchema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("login"), email, next: nextPath }).strict(),
  z.object({
    intent: z.literal("signup"),
    email,
    firstName: name,
    lastName: name,
    marketing: z.boolean().optional(),
    next: nextPath,
  }).strict(),
]);
export const storeOtpVerifySchema = z.object({
  email,
  token: z.string().regex(/^\d{6}$/),
  firstName: name.optional(),
  lastName: name.optional(),
  marketing: z.boolean().optional(),
  next: nextPath,
}).strict();

type Challenge = {
  hash: string;
  email: string;
  firstName?: string;
  lastName?: string;
  marketing?: boolean;
  next?: string;
  expires: number;
  attempts: number;
};

const challenges = new Map<string, Challenge>();
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const challengeCookie = "clothing_fixture_store_otp";
const genericMessage = "If delivery is available, a verification code will arrive. Check your email.";

const failures: Record<string, [number, string]> = {
  FORBIDDEN: [403, "This request must come from this site."],
  RATE_LIMIT: [429, "Too many attempts. Try again shortly."],
  OTP_INVALID: [400, "The code is invalid or expired. Request a new code."],
  NOT_FOUND: [404, "This action is unavailable."],
  INVALID_PAYLOAD: [422, "Check the supplied details."],
  UNAVAILABLE: [503, "Account sign-in is unavailable right now. Try again shortly."],
  INTEGRATION_UNCONFIGURED: [503, "Account sign-in is not configured yet."],
};

function fixtureMode() {
  const env = readEnvironment();
  return env.APP_MODE === "fixture" && !env.NEXT_PUBLIC_SUPABASE_URL && !env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
}

function cookie(request: Request, name: string) {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return undefined;
}

function setCookie(name: string, value: string, options: { maxAge: number; secure: boolean }) {
  const parts = [`${name}=${value}`, "Path=/", `Max-Age=${options.maxAge}`, "HttpOnly", "SameSite=Lax"];
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

function jsonWithCookies(data: unknown, cookies: string[]) {
  const headers = new Headers({ "Content-Type": "application/json" });
  for (const value of cookies) headers.append("Set-Cookie", value);
  return new Response(JSON.stringify({ data }), { headers });
}

async function readBody(request: Request, maxBytes = 4096): Promise<unknown> {
  const type = request.headers.get("content-type") ?? "";
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(type)) throw new Error("INVALID_PAYLOAD");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("INVALID_PAYLOAD");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error("INVALID_PAYLOAD");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("INVALID_PAYLOAD");
  }
}

function metadata(input: { firstName?: string | undefined; lastName?: string | undefined; marketing?: boolean | undefined }) {
  return {
    ...(input.firstName ? { first_name: input.firstName } : {}),
    ...(input.lastName ? { last_name: input.lastName } : {}),
    ...(input.marketing !== undefined ? { marketing_opt_in: input.marketing } : {}),
  };
}

export async function storeOtpResponse(work: () => Promise<unknown>) {
  const requestId = randomUUID();
  const headers: Record<string, string> = {
    "Cache-Control": "private, no-store, max-age=0",
    "X-Robots-Tag": "noindex, nofollow",
    "X-Request-Id": requestId,
  };
  try {
    const result = await work();
    if (result instanceof Response) {
      for (const [key, value] of Object.entries(headers)) result.headers.set(key, value);
      return result;
    }
    return Response.json({ data: result, meta: { requestId } }, { headers });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({
        error: { code: "INVALID_FIELDS", message: "Check the supplied details.", fieldErrors: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) },
        requestId,
      }, { status: 422, headers });
    }
    const code = error instanceof EnvironmentError ? "INTEGRATION_UNCONFIGURED"
      : error instanceof Error && Object.hasOwn(failures, error.message) ? error.message
      : "UNAVAILABLE";
    const [status, message] = failures[code] ?? [503, "Account sign-in is unavailable right now. Try again shortly."];
    const extra = code === "RATE_LIMIT" ? { "Retry-After": "60" } : {};
    return Response.json({ error: { code, message }, requestId }, { status, headers: { ...headers, ...extra } });
  }
}

export async function storeOtpAction(request: Request, action: string) {
  if (!sameOrigin(request)) throw new Error("FORBIDDEN");
  if (!allowAuthAttempt(`store-otp:${action}`)) throw new Error("RATE_LIMIT");
  const env = readEnvironment();
  const input = await readBody(request);
  if (action === "request") {
    const value = storeOtpRequestSchema.parse(input);
    const next = safeStoreAuthDestination(value.next ?? null);
    if (fixtureMode()) {
      for (const [key, row] of challenges) if (row.expires < Date.now()) challenges.delete(key);
      const id = randomBytes(32).toString("base64url");
      const token = String(randomInt(100000, 1_000_000));
      const challenge: Challenge = {
        hash: digest(token),
        email: value.email,
        next,
        expires: Date.now() + 600_000,
        attempts: 0,
      };
      if (value.intent === "signup") {
        challenge.firstName = value.firstName;
        challenge.lastName = value.lastName;
        if (value.marketing !== undefined) challenge.marketing = value.marketing;
      }
      challenges.set(digest(id), challenge);
      return jsonWithCookies(
        { accepted: true, fixtureToken: token, message: "Fixture code only — no email sent." },
        [setCookie(challengeCookie, id, { maxAge: 600, secure: env.APP_URL.startsWith("https:") })],
      );
    }
    const { storeSupabase } = await import("../supabase/store.ts");
    const supabase = await storeSupabase();
    if (!supabase) throw new Error("INTEGRATION_UNCONFIGURED");
    await supabase.auth.signInWithOtp({
      email: value.email,
      options: {
        shouldCreateUser: true,
        data: value.intent === "signup" ? metadata(value) : {},
      },
    });
    return { accepted: true, message: genericMessage };
  }
  if (action !== "verify") throw new Error("NOT_FOUND");
  const value = storeOtpVerifySchema.parse(input);
  if (fixtureMode()) {
    const key = digest(cookie(request, challengeCookie) ?? "");
    const challenge = challenges.get(key);
    if (!challenge || challenge.expires < Date.now() || ++challenge.attempts > 5) throw new Error("OTP_INVALID");
    if (
      challenge.email !== value.email
      || !timingSafeEqual(Buffer.from(challenge.hash, "hex"), Buffer.from(digest(value.token), "hex"))
    ) throw new Error("OTP_INVALID");
    challenges.delete(key);
    const existing = cookie(request, fixtureSessionCookie);
    if (existing) fixtureAuthStore().signOut(existing);
    const session = fixtureAuthStore().signIn("customer");
    return jsonWithCookies(
      { href: safeStoreAuthDestination(value.next ?? challenge.next ?? null) },
      [
        setCookie(fixtureSessionCookie, session, { maxAge: fixtureSessionSeconds, secure: env.APP_URL.startsWith("https:") }),
        setCookie(challengeCookie, "", { maxAge: 0, secure: env.APP_URL.startsWith("https:") }),
      ],
    );
  }
  const { storeSupabase } = await import("../supabase/store.ts");
  const supabase = await storeSupabase();
  if (!supabase) throw new Error("INTEGRATION_UNCONFIGURED");
  const verified = await supabase.auth.verifyOtp({ email: value.email, token: value.token, type: "email" });
  if (verified.error) throw new Error("OTP_INVALID");
  const current = await supabase.auth.getUser();
  if (current.error || !current.data.user?.email_confirmed_at || current.data.user.email?.toLowerCase() !== value.email) {
    throw new Error("OTP_INVALID");
  }
  const data = metadata(value);
  if (Object.keys(data).length) await supabase.auth.updateUser({ data });
  return { href: safeStoreAuthDestination(value.next ?? null) };
}
