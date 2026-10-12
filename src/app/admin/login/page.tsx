import Link from "next/link";
import { readEnvironment } from "../../../config/env.ts";
export const dynamic = "force-dynamic";
export default async function Login({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const mode = readEnvironment().APP_MODE;
  const query = await searchParams;
  return <main id="main" className="auth-panel"><p className="eyebrow">YOUR BRAND / ADMIN</p><h1>Sign in to your workspace.</h1>
    {query.error && <p className="notice error" role="alert">Sign-in could not be completed. Check your details or try again.</p>}
    {query.reset && <p className="notice" role="status">Password updated. Sign in with your new password.</p>}
    {mode === "fixture" ? <><p className="notice"><strong>Fixture preview</strong><br />These demo identities only access local sample data. No Supabase account or external service is used.</p>
      <form action="/api/v1/auth/fixture" method="post"><label htmlFor="persona">Preview identity</label><select id="persona" name="persona"><option value="owner">Demo owner</option><option value="staff">Demo staff</option><option value="customer">Demo customer — no admin access</option></select><button type="submit">Enter fixture workspace</button></form></>
      : <form action="/api/v1/auth/login" method="post"><label htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="username" required maxLength={254} /><label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="current-password" required maxLength={200} /><button type="submit">Sign in</button></form>}
    <div className="auth-links"><Link href="/admin/forgot-password">Forgot password?</Link><Link href="/">Back to project</Link></div><p className="muted small">Admin access is assigned by the store owner. There is no public admin registration.</p>
  </main>;
}
