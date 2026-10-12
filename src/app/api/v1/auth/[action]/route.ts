import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { readEnvironment } from "../../../../../config/env.ts";
import { requestSupabase } from "../../../../../lib/supabase/server.ts";
import { fixtureAuthStore, fixtureSessionCookie, fixtureSessionSeconds } from "../../../../../lib/auth/fixture.ts";
import { requireAdmin } from "../../../../../lib/auth/server.ts";
import { sameOrigin, allowAuthAttempt, readAuthForm, AuthFormError } from "../../../../../lib/http/security.ts";

export const dynamic = "force-dynamic";
const loginSchema = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(200) });
function go(path: string) {
  const response = NextResponse.redirect(new URL(path, readEnvironment().APP_URL), 303);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function POST(request: Request, context: { params: Promise<{ action: string }> }) {
  if (!sameOrigin(request)) return new Response("Request origin denied.", { status: 403 });
  const { action } = await context.params;
  if (!["login", "fixture", "logout", "forgot-password", "reset-password"].includes(action)) return new Response(null, { status: 404 });
  // One bounded process-wide bucket per action; do not trust arbitrary forwarded IP headers.
  if (!allowAuthAttempt(action)) return new Response("Too many attempts. Try again shortly.", { status: 429, headers: { "Retry-After": "60" } });
  let form: URLSearchParams;
  try { form = await readAuthForm(request); } catch (error) {
    const failure = error instanceof AuthFormError ? error : new AuthFormError(400);
    return new Response(failure.message, { status: failure.status, headers: { "Cache-Control": "private, no-store" } });
  }
  const env = readEnvironment();
  if (action === "fixture") {
    if (env.APP_MODE !== "fixture") return new Response(null, { status: 404 });
    const persona = z.enum(["owner", "staff", "customer"]).safeParse(form.get("persona"));
    if (!persona.success) return go("/admin/login?error=invalid");
    const store = fixtureAuthStore();
    store.signOut((await cookies()).get(fixtureSessionCookie)?.value);
    const token = store.signIn(persona.data);
    const response = go("/admin");
    response.cookies.set(fixtureSessionCookie, token, { httpOnly: true, sameSite: "lax", secure: env.APP_URL.startsWith("https:"), path: "/", maxAge: fixtureSessionSeconds });
    return response;
  }
  if (action === "logout") {
    if (env.APP_MODE === "fixture") fixtureAuthStore().signOut((await cookies()).get(fixtureSessionCookie)?.value);
    else await (await requestSupabase()).auth.signOut();
    const response = go("/admin/login");
    response.cookies.set(fixtureSessionCookie, "", { httpOnly: true, sameSite: "lax", secure: env.APP_URL.startsWith("https:"), path: "/", maxAge: 0 });
    return response;
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
