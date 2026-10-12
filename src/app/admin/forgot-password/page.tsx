import Link from "next/link";
import { readEnvironment } from "../../../config/env.ts";
export const dynamic = "force-dynamic";
export default async function Forgot({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const fixture = readEnvironment().APP_MODE === "fixture";
  const query = await searchParams;
  return <main id="main" className="auth-panel"><p className="eyebrow">YOUR BRAND / RECOVERY</p><h1>Reset your password.</h1>
    {fixture ? <p className="notice">Fixture identities have no password. Return to sign-in to choose a demo identity. No recovery email is sent.</p> : <>
      {query.sent ? <p className="notice" role="status">If this email can receive recovery instructions, follow the link sent to your inbox.</p> : <form action="/api/v1/auth/forgot-password" method="post"><label htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="email" required maxLength={254} /><button type="submit">Send recovery instructions</button></form>}
    </>}<Link href="/admin/login">Back to sign-in</Link></main>;
}
