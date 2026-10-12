import { NextResponse } from "next/server";
import { readEnvironment } from "../../../config/env.ts";
import { requestSupabase } from "../../../lib/supabase/server.ts";
import { safeAuthDestination } from "../../../lib/auth/policy.ts";

export async function GET(request: Request) {
  const env = readEnvironment();
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (env.APP_MODE !== "fixture" && code) {
    const { error } = await (await requestSupabase()).auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(safeAuthDestination(url.searchParams.get("next")), env.APP_URL));
  }
  return NextResponse.redirect(new URL("/admin/login?error=recovery", env.APP_URL));
}
