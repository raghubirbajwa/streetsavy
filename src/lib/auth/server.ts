import "server-only";
import { cookies } from "next/headers";
import { readEnvironment } from "../../config/env.ts";
import { requestSupabase } from "../supabase/server.ts";
import { fixtureAuthStore, fixtureSessionCookie } from "./fixture.ts";
import { authorizeAdmin } from "./policy.ts";

/** Fresh verified identity AND current membership on every operation. No React cache. */
export async function requireAdmin(ownerOnly = false) {
  if (readEnvironment().APP_MODE === "fixture") {
    const store = fixtureAuthStore();
    const user = store.user((await cookies()).get(fixtureSessionCookie)?.value);
    return authorizeAdmin(user, user ? store.membership(user.id) : null, ownerOnly);
  }
  const supabase = await requestSupabase();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return authorizeAdmin(null, null, ownerOnly);
  const membership = await supabase.from("admin_memberships").select("user_id,role,enabled").eq("user_id", data.user.id).maybeSingle();
  if (membership.error) return authorizeAdmin({ id: data.user.id }, null, ownerOnly);
  return authorizeAdmin({ id: data.user.id, ...(data.user.email ? { email: data.user.email } : {}) }, membership.data ? {
    userId: membership.data.user_id, role: membership.data.role as "owner" | "staff", enabled: membership.data.enabled,
  } : null, ownerOnly);
}
