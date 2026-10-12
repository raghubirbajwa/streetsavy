import Link from "next/link";
import { redirect } from "next/navigation";
import { readEnvironment } from "../../../config/env.ts";
import { requireAdmin } from "../../../lib/auth/server.ts";
export const dynamic = "force-dynamic";
export default async function Reset({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const query = await searchParams;
  if (readEnvironment().APP_MODE === "fixture") return <main id="main" className="auth-panel"><h1>Fixture recovery</h1><p>Demo identities do not use passwords or send email.</p><Link href="/admin/login">Return to sign-in</Link></main>;
  try { await requireAdmin(); } catch { redirect("/admin/login?error=recovery"); }
  return <main id="main" className="auth-panel"><h1>Choose a new password.</h1>{query.error && <p role="alert" className="notice error">Use matching passwords of at least 12 characters.</p>}<form action="/api/v1/auth/reset-password" method="post"><label htmlFor="password">New password</label><input id="password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={200} required /><label htmlFor="confirmPassword">Confirm new password</label><input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" minLength={12} maxLength={200} required /><button type="submit">Update password</button></form></main>;
}
