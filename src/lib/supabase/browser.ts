"use client";
import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types.ts";

/** Pass only an explicitly validated public URL/key from a Server Component. */
export function browserSupabase(config: { url: string; publishableKey: string }) {
  return createBrowserClient<Database>(config.url, config.publishableKey);
}
