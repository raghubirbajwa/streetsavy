import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { readEnvironment, integrationConfig } from "./config/env.ts";
import type { Database } from "./lib/supabase/database.types.ts";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const env = readEnvironment();
  const fixtureUrl = env.APP_MODE === "fixture" ? env.NEXT_PUBLIC_SUPABASE_URL : undefined;
  const fixtureKey = env.APP_MODE === "fixture" ? env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY : undefined;
  const live = env.APP_MODE === "fixture" ? null : integrationConfig("supabase", env);
  const url = live?.NEXT_PUBLIC_SUPABASE_URL ?? fixtureUrl;
  const key = live?.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? fixtureKey;
  if (url && key) {
    const supabase = createServerClient<Database>(url, key, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(values) {
          values.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    });
    await supabase.auth.getClaims();
  }
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

export const config = { matcher: [
  "/admin/:path*",
  "/api/v1/admin/:path*",
  "/api/v1/auth/:path*",
  "/auth/:path*",
  "/account",
  "/account/:path*",
  "/api/v1/cart",
  "/api/v1/cart/:path*",
  "/api/v1/checkout/:path*",
  "/orders/:path*",
] };
