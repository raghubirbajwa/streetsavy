import { NextResponse } from "next/server";
import { readEnvironment } from "../../../config/env.ts";
import { requestSupabase } from "../../../lib/supabase/server.ts";
import { storeSupabase, storeSupabaseReady } from "../../../lib/supabase/store.ts";
import { authRecoveryFailure, safeCallbackDestination } from "../../../lib/auth/policy.ts";

export async function GET(request: Request) {
  const env = readEnvironment();
  const url = new URL(request.url);
  const next = url.searchParams.get("next");
  const code = url.searchParams.get("code");
  if (code) {
    const supabase = storeSupabaseReady() ? await storeSupabase() : env.APP_MODE === "fixture" ? null : await requestSupabase();
    if (supabase) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) return NextResponse.redirect(new URL(safeCallbackDestination(next), env.APP_URL));
    }
  }
  return NextResponse.redirect(new URL(authRecoveryFailure(next), env.APP_URL));
}
