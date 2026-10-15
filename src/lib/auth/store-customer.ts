import "server-only";
import { cookies } from "next/headers";
import { readEnvironment } from "../../config/env.ts";
import { storeSupabase, storeSupabaseReady } from "../supabase/store.ts";
import { requestSupabase } from "../supabase/server.ts";
import { fixtureAuthStore, fixtureSessionCookie } from "./fixture.ts";

export type StoreCustomer = { id: string; email?: string; firstName?: string; lastName?: string };

function clean(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function metaName(metadata: unknown, key: "first_name" | "last_name"): string | undefined {
  if (!metadata || typeof metadata !== "object" || !(key in metadata)) return undefined;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" ? clean(value) : undefined;
}

function names(profile: { first_name: string; last_name: string } | null, metadata: unknown): Pick<StoreCustomer, "firstName" | "lastName"> {
  const firstName = clean(profile?.first_name) || metaName(metadata, "first_name");
  const lastName = clean(profile?.last_name) || metaName(metadata, "last_name");
  return { ...(firstName ? { firstName } : {}), ...(lastName ? { lastName } : {}) };
}

function named(id: string, email: string | undefined, pair: Pick<StoreCustomer, "firstName" | "lastName">): StoreCustomer {
  return { id, ...(email ? { email } : {}), ...pair };
}

/** Signed-in shopper. Uses Supabase whenever the public store keys are set. */
export async function getStoreCustomer(): Promise<StoreCustomer | null> {
  if (storeSupabaseReady()) {
    const supabase = await storeSupabase();
    if (!supabase) return null;
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    const { data: profile } = await supabase
      .from("customer_profiles")
      .select("first_name, last_name")
      .eq("user_id", data.user.id)
      .maybeSingle();
    return named(data.user.id, data.user.email, names(profile, data.user.user_metadata));
  }
  if (readEnvironment().APP_MODE === "fixture") {
    const user = fixtureAuthStore().user((await cookies()).get(fixtureSessionCookie)?.value);
    if (!user) return null;
    return named(user.id, user.email, {});
  }
  const supabase = await requestSupabase();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  const { data: profile } = await supabase
    .from("customer_profiles")
    .select("first_name, last_name")
    .eq("user_id", data.user.id)
    .maybeSingle();
  return named(data.user.id, data.user.email, names(profile, data.user.user_metadata));
}

/** First letter of the given name, or of the email when no name was saved. */
export function accountInitial(customer: StoreCustomer): string | null {
  const source = (customer.firstName ?? customer.email ?? "").trim();
  const letter = source.charAt(0).toUpperCase();
  return /^[A-Z0-9]$/.test(letter) ? letter : null;
}
