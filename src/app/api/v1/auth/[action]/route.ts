import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { readEnvironment } from "../../../../../config/env.ts";
import { requestSupabase } from "../../../../../lib/supabase/server.ts";
import { storeSupabase, storeSupabaseReady } from "../../../../../lib/supabase/store.ts";
import { fixtureAuthStore, fixtureSessionCookie, fixtureSessionSeconds } from "../../../../../lib/auth/fixture.ts";
import { safeStoreAuthDestination } from "../../../../../lib/auth/policy.ts";
import { requireAdmin } from "../../../../../lib/auth/server.ts";
import { sameOrigin, allowAuthAttempt, readAuthForm, AuthFormError } from "../../../../../lib/http/security.ts";

export const dynamic = "force-dynamic";
const loginSchema = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(200) });
const adminActions = ["login", "fixture", "logout", "forgot-password", "reset-password"];
const storeActions = ["store-login", "store-signup", "store-logout", "store-forgot-password", "store-fixture", "store-reset-password"];

function go(path: string) {
  const response = NextResponse.redirect(new URL(path, readEnvironment().APP_URL), 303);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function fixtureCookie(response: NextResponse, token: string, maxAge: number) {
  const secure = readEnvironment().APP_URL.startsWith("https:");
  response.cookies.set(fixtureSessionCookie, token, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge });
  return response;
}

async function clearFixtureSession() {
  if (readEnvironment().APP_MODE === "fixture") fixtureAuthStore().signOut((await cookies()).get(fixtureSessionCookie)?.value);
}

async function storeClient() {
  if (storeSupabaseReady()) return storeSupabase();
  if (readEnvironment().APP_MODE === "fixture") return null;
  return requestSupabase();
}

async function storeAuth(action: string, form: URLSearchParams) {
  const env = readEnvironment();
  if (action === "store-logout") {
    const supabase = await storeClient();
    if (supabase) await supabase.auth.signOut();
    else if (env.APP_MODE === "fixture") await clearFixtureSession();
    return fixtureCookie(go("/account?tab=login"), "", 0);
  }
  if (action === "store-fixture") {
    if (storeSupabaseReady() || env.APP_MODE !== "fixture") return new Response(null, { status: 404 });
    if (form.get("persona") !== "customer") return go("/account?tab=login&error=invalid");
    await clearFixtureSession();
    const token = fixtureAuthStore().signIn("customer");
    return fixtureCookie(go(safeStoreAuthDestination(form.get("next"))), token, fixtureSessionSeconds);
  }
  const supabase = await storeClient();
  if (!supabase) return go("/account?tab=login&error=fixture");
  try {
    if (action === "store-login") {
      const parsed = loginSchema.safeParse({ email: form.get("email"), password: form.get("password") });
      if (!parsed.success) return go("/account?tab=login&error=invalid");
      const result = await supabase.auth.signInWithPassword(parsed.data);
      if (result.error) return go("/account?tab=login&error=credentials");
      return go(safeStoreAuthDestination(form.get("next")));
    }
    if (action === "store-signup") {
      const firstName = z.string().trim().min(1).max(80).safeParse(form.get("firstName"));
      const lastName = z.string().trim().min(1).max(80).safeParse(form.get("lastName"));
      const email = z.string().email().max(254).safeParse(form.get("email"));
      const password = z.string().min(8).max(200).safeParse(form.get("password"));
      if (!firstName.success || !lastName.success || !email.success || !password.success) return go("/account?tab=signup&error=invalid");
      if (form.get("confirmPassword") !== password.data) return go("/account?tab=signup&error=mismatch");
      const result = await supabase.auth.signUp({
        email: email.data,
        password: password.data,
        options: {
          emailRedirectTo: `${env.APP_URL}/auth/callback?next=/account`,
          data: { first_name: firstName.data, last_name: lastName.data, marketing_opt_in: form.get("marketing") === "on" },
        },
      });
      if (result.error) return go("/account?tab=signup&error=signup");
      if (result.data.session) return go(safeStoreAuthDestination(form.get("next")));
      return go("/account?tab=login&confirm=1");
    }
    if (action === "store-forgot-password") {
      const email = z.string().email().max(254).safeParse(form.get("email"));
      if (email.success) await supabase.auth.resetPasswordForEmail(email.data, { redirectTo: `${env.APP_URL}/auth/callback?next=/account/reset-password` });
      return go("/account/forgot-password?sent=1");
    }
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return go("/account?tab=login&error=recovery");
    const password = z.string().min(8).max(200).safeParse(form.get("password"));
    if (!password.success || password.data !== form.get("confirmPassword")) return go("/account/reset-password?error=invalid");
    const result = await supabase.auth.updateUser({ password: password.data });
    if (result.error) return go("/account/reset-password?error=invalid");
    await supabase.auth.signOut();
    return go("/account?tab=login&reset=1");
  } catch {
    if (action === "store-signup") return go("/account?tab=signup&error=unavailable");
    if (action === "store-forgot-password") return go("/account/forgot-password?error=unavailable");
    if (action === "store-reset-password") return go("/account/reset-password?error=unavailable");
    return go("/account?tab=login&error=unavailable");
  }
}

export async function POST(request: Request, context: { params: Promise<{ action: string }> }) {
  if (!sameOrigin(request)) return new Response("Request origin denied.", { status: 403 });
  const { action } = await context.params;
  if (![...adminActions, ...storeActions].includes(action)) return new Response(null, { status: 404 });
  // One bounded process-wide bucket per action; do not trust arbitrary forwarded IP headers.
  if (!allowAuthAttempt(action)) return new Response("Too many attempts. Try again shortly.", { status: 429, headers: { "Retry-After": "60" } });
  let form: URLSearchParams;
  try { form = await readAuthForm(request); } catch (error) {
    const failure = error instanceof AuthFormError ? error : new AuthFormError(400);
    return new Response(failure.message, { status: failure.status, headers: { "Cache-Control": "private, no-store" } });
  }
  if (storeActions.includes(action)) return storeAuth(action, form);
  const env = readEnvironment();
  if (action === "fixture") {
    if (env.APP_MODE !== "fixture") return new Response(null, { status: 404 });
    const persona = z.enum(["owner", "staff", "customer"]).safeParse(form.get("persona"));
    if (!persona.success) return go("/admin/login?error=invalid");
    const store = fixtureAuthStore();
    store.signOut((await cookies()).get(fixtureSessionCookie)?.value);
    const token = store.signIn(persona.data);
    return fixtureCookie(go("/admin"), token, fixtureSessionSeconds);
  }
  if (action === "logout") {
    if (env.APP_MODE === "fixture") fixtureAuthStore().signOut((await cookies()).get(fixtureSessionCookie)?.value);
    else await (await requestSupabase()).auth.signOut();
    return fixtureCookie(go("/admin/login"), "", 0);
  }
  if (env.APP_MODE === "fixture") return go("/admin/login?error=fixture");
  try {
    const supabase = await requestSupabase();
    if (action === "login") {
      const parsed = loginSchema.safeParse({ email: form.get("email"), password: form.get("password") });
      if (!parsed.success) return go("/admin/login?error=invalid");
      const result = await supabase.auth.signInWithPassword(parsed.data);
      if (result.error) return go("/admin/login?error=credentials");
      return go("/admin"); // Protected page independently rechecks membership.
    }
    if (action === "forgot-password") {
      const email = z.string().email().max(254).safeParse(form.get("email"));
      if (email.success) await supabase.auth.resetPasswordForEmail(email.data, { redirectTo: `${env.APP_URL}/auth/callback?next=/admin/reset-password` });
      return go("/admin/forgot-password?sent=1"); // Same response for known/unknown email.
    }
    await requireAdmin();
    const password = z.string().min(12).max(200).safeParse(form.get("password"));
    if (!password.success || password.data !== form.get("confirmPassword")) return go("/admin/reset-password?error=invalid");
    const result = await supabase.auth.updateUser({ password: password.data });
    if (result.error) return go("/admin/reset-password?error=invalid");
    await supabase.auth.signOut();
    return go("/admin/login?reset=1");
  } catch {
    return go("/admin/login?error=unavailable");
  }
}
