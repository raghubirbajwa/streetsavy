import "server-only";
import { createClient } from "@supabase/supabase-js";
import { integrationConfig,readEnvironment } from "../../config/env.ts";
import type { Database } from "../supabase/database.types.ts";
export async function readPublicContent(name: "public_home_content"|"public_store_settings") {
  if(readEnvironment().APP_MODE === "fixture") {
    const { adminRpc } = await import("../admin/db.ts");
    return adminRpc(name,{});
  }
  const config = integrationConfig("supabase");
  const client = createClient<Database>(config.NEXT_PUBLIC_SUPABASE_URL,config.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(url,options)=>fetch(url,{...options,cache:"no-store"})}});
  const {data,error} = await client.rpc(name);
  if(error) throw new Error("Content unavailable.");
  return data;
}
