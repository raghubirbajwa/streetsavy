import "server-only";
import { createClient } from "@supabase/supabase-js";
import { integrationConfig } from "../../config/env.ts";
import type { Database } from "./database.types.ts";

/** Trusted server operations only, AFTER actor authorization. Never use for ordinary catalog/admin reads. */
export function privilegedSupabase() {
  const config = integrationConfig("supabase");
  return createClient<Database>(config.NEXT_PUBLIC_SUPABASE_URL, config.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (url, options) => fetch(url, { ...options, cache: "no-store" }) },
  });
}
