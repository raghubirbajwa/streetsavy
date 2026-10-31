import "server-only";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { readEnvironment } from "../../config/env.ts";
import type { Database } from "../supabase/database.types.ts";

type LiveOtp = {
  hash: string;
  email: string;
  supabaseToken: string;
  expires: number;
  attempts: number;
  orderNumber?: string;
};

const live = new Map<string, LiveOtp>();
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

function mapAuthError(error: { status?: number | undefined; code?: string | undefined }): never {
  if (error.status === 429 || error.code === "over_email_send_rate_limit") throw new Error("RATE_LIMIT");
  throw new Error("UNAVAILABLE");
}

function storeAuthAdmin() {
  const env = readEnvironment();
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SECRET_KEY) return null;
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (url, options) => fetch(url, { ...options, cache: "no-store" }) },
  });
}

function otpFrom(value: { properties?: { email_otp?: string } | null } | null) {
  const token = value?.properties?.email_otp;
  if (!token || !/^\d{6,10}$/.test(token)) throw new Error("UNAVAILABLE");
  return token;
}

async function brandedHtml(token: string) {
  const html = readFileSync(join(process.cwd(), "docs/supabase/email-otp-template.html"), "utf8");
  if (!html.includes("{{ .Token }}")) throw new Error("UNAVAILABLE");
  return html.replaceAll("{{ .Token }}", token);
}

async function sendBranded(email: string, token: string) {
  const env = readEnvironment();
  if (env.TRANSACTIONAL_EMAIL_PROVIDER !== "resend" || !env.TRANSACTIONAL_EMAIL_API_KEY || !env.TRANSACTIONAL_EMAIL_FROM) {
    throw new Error("UNAVAILABLE");
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.TRANSACTIONAL_EMAIL_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: `StreetSavy <${env.TRANSACTIONAL_EMAIL_FROM}>`,
      to: [email],
      subject: "Your StreetSavy verification code",
      html: await brandedHtml(token),
    }),
    signal: AbortSignal.timeout(10000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("UNAVAILABLE");
}

async function supabaseOtp(admin: NonNullable<ReturnType<typeof storeAuthAdmin>>, email: string, metadata: Record<string, unknown>) {
  const first = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (!first.error) return otpFrom(first.data);
  const created = await admin.auth.admin.createUser({ email, email_confirm: false, user_metadata: metadata });
  if (created.error && created.error.status !== 422) mapAuthError(created.error);
  const second = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (second.error) mapAuthError(second.error);
  return otpFrom(second.data);
}

/** Always emails a 6-digit code. Hosted Auth may still mint a longer token behind the scenes. */
export async function issueStoreOtpEmail(
  email: string,
  metadata: Record<string, unknown> = {},
  extra: { orderNumber?: string } = {},
) {
  const admin = storeAuthAdmin();
  const env = readEnvironment();
  if (!admin || env.TRANSACTIONAL_EMAIL_PROVIDER !== "resend" || !env.TRANSACTIONAL_EMAIL_API_KEY || !env.TRANSACTIONAL_EMAIL_FROM) {
    throw new Error("UNAVAILABLE");
  }
  for (const [key, row] of live) if (row.expires < Date.now()) live.delete(key);
  const id = randomBytes(32).toString("base64url");
  const token = String(randomInt(100000, 1_000_000));
  const record: LiveOtp = {
    hash: digest(token),
    email,
    supabaseToken: await supabaseOtp(admin, email, metadata),
    expires: Date.now() + 600_000,
    attempts: 0,
  };
  if (extra.orderNumber) record.orderNumber = extra.orderNumber;
  live.set(digest(id), record);
  try {
    await sendBranded(email, token);
  } catch (error) {
    live.delete(digest(id));
    throw error;
  }
  return { id };
}

export function takeStoreOtp(id: string | undefined, email: string, token: string, orderNumber?: string) {
  const key = digest(id ?? "");
  const row = live.get(key);
  if (!row || row.expires < Date.now() || ++row.attempts > 5) throw new Error("OTP_INVALID");
  if (row.email !== email || (orderNumber !== undefined && row.orderNumber !== orderNumber)) throw new Error("OTP_INVALID");
  if (!timingSafeEqual(Buffer.from(row.hash, "hex"), Buffer.from(digest(token), "hex"))) throw new Error("OTP_INVALID");
  live.delete(key);
  return row.supabaseToken;
}
