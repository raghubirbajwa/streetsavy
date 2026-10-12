import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { readEnvironment, integrationConfig } from "./config/env.ts";
import type { Database } from "./lib/supabase/database.types.ts";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const env = readEnvironment();
  if (env.APP_MODE !== "fixture") {
    const config = integrationConfig("supabase", env);
    const supabase = createServerClient<Database>(config.NEXT_PUBLIC_SUPABASE_URL, config.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
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

export const config = { matcher: ["/admin/:path*", "/api/v1/admin/:path*", "/api/v1/auth/:path*", "/auth/:path*"] };
