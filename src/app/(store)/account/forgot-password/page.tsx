import Link from "next/link";
import { readEnvironment } from "../../../../config/env.ts";
import { storeSupabaseReady } from "../../../../lib/supabase/store.ts";
import { AccountScene } from "../../../../components/store/account-scene.tsx";

export const dynamic = "force-dynamic";
export const metadata = { title: "Forgot password", robots: { index: false, follow: false } };

export default async function ForgotPassword({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const query = await searchParams;
  const fixture = !storeSupabaseReady() && readEnvironment().APP_MODE === "fixture";
  return <AccountScene>
    <h1>Reset your password</h1>
    {fixture ? <p className="store-account-note"><strong>Fixture preview</strong>Demo identities have no password. No recovery email is sent.</p> : <>
      {query.sent === "1" ? <p className="store-account-note" role="status">If this email can receive recovery instructions, follow the link sent to your inbox.</p> : <>
        {query.error === "unavailable" && <p className="store-account-note store-account-error" role="alert">Recovery is unavailable right now. Try again shortly.</p>}
        <form className="store-account-form" action="/api/v1/auth/store-forgot-password" method="post">
          <label className="store-account-label" htmlFor="recover-email">Email address</label>
          <input id="recover-email" name="email" type="email" autoComplete="email" placeholder="Email address" required maxLength={254} />
          <button className="store-account-submit" type="submit"><span className="store-account-submit-label">Send recovery link</span><span className="store-account-submit-arrow" aria-hidden="true">→</span></button>
        </form>
      </>}
    </>}
    <p className="store-account-links"><Link href="/account">Back to sign-in</Link></p>
  </AccountScene>;
}
