import Link from "next/link";
import { redirect } from "next/navigation";
import { readEnvironment } from "../../../../config/env.ts";
import { storeSupabaseReady } from "../../../../lib/supabase/store.ts";
import { getStoreCustomer } from "../../../../lib/auth/store-customer.ts";
import { AccountScene } from "../../../../components/store/account-scene.tsx";

export const dynamic = "force-dynamic";
export const metadata = { title: "Choose a new password", robots: { index: false, follow: false } };

export default async function ResetPassword({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const query = await searchParams;
  if (!storeSupabaseReady() && readEnvironment().APP_MODE === "fixture") return <AccountScene><h1>Fixture recovery</h1><p className="store-account-note">Demo identities do not use passwords or send email.</p><p className="store-account-links"><Link href="/account">Return to sign-in</Link></p></AccountScene>;
  const customer = await getStoreCustomer();
  if (!customer) redirect("/account?tab=login&error=recovery");
  return <AccountScene>
    <h1>Choose a new password</h1>
    {query.error === "invalid" && <p className="store-account-note store-account-error" role="alert">Use matching passwords of at least 8 characters.</p>}
    {query.error === "unavailable" && <p className="store-account-note store-account-error" role="alert">Password update is unavailable right now. Try again shortly.</p>}
    <form className="store-account-form" action="/api/v1/auth/store-reset-password" method="post">
      <label className="store-account-label" htmlFor="new-password">New password</label>
      <input id="new-password" name="password" type="password" autoComplete="new-password" placeholder="New password" required minLength={8} maxLength={200} />
      <label className="store-account-label" htmlFor="confirm-password">Confirm new password</label>
      <input id="confirm-password" name="confirmPassword" type="password" autoComplete="new-password" placeholder="Confirm new password" required minLength={8} maxLength={200} />
      <button className="store-account-submit" type="submit"><span className="store-account-submit-label">Update password</span><span className="store-account-submit-arrow" aria-hidden="true">→</span></button>
    </form>
  </AccountScene>;
}
