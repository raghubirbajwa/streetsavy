import "server-only";
import { createClient } from "@supabase/supabase-js";
import { integrationConfig, readEnvironment } from "../../config/env.ts";
import type { Database } from "../supabase/database.types.ts";
import { createCatalogRepository } from "./repository.ts";
import type { CatalogRepository } from "./repository.ts";

export async function catalogRepository(): Promise<CatalogRepository> {
  const env = readEnvironment();
  if (env.APP_MODE === "fixture") {
    const { adminRpc } = await import("../admin/db.ts");
    return createCatalogRepository(() => adminRpc("public_catalog", {}));
  }
  const config = integrationConfig("supabase", env);
  // Public key only; catalog reads cannot accidentally use the RLS-bypassing key.
  const client = createClient<Database>(config.NEXT_PUBLIC_SUPABASE_URL, config.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (url, options) => fetch(url, { ...options, cache: "no-store" }) },
  });
  return createCatalogRepository(async () => {
    const { data, error } = await client.rpc("public_catalog");
    if (error) throw new Error("Catalog is temporarily unavailable.");
    return data; // Repository validates the strict public DTO before returning it.
  });
}
