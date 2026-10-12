import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { integrationConfig, readEnvironment } from "../../config/env.ts";
import type { Database } from "./database.types.ts";

export async function requestSupabase() {
  const config = integrationConfig("supabase", readEnvironment());
  const jar = await cookies();
  return createServerClient<Database>(config.NEXT_PUBLIC_SUPABASE_URL, config.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll(values) {
        // Server Components cannot set cookies; Proxy handles their refresh.
        try { values.forEach(({ name, value, options }) => jar.set(name, value, options)); } catch { /* read-only render */ }
      },
    },
    global: { fetch: (url, options) => fetch(url, { ...options, cache: "no-store" }) },
  });
}
