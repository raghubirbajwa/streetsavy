import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin } from "../../../lib/auth/server.ts";
import { AccessError } from "../../../lib/auth/policy.ts";
import { readEnvironment } from "../../../config/env.ts";
import AdminNav from "../../../components/admin/AdminNav.tsx";
export const dynamic = "force-dynamic";
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  let admin;
  try { admin = await requireAdmin(); } catch (error) {
    if (error instanceof AccessError) redirect(error.status === 401 ? "/admin/login" : "/admin/no-access");
    throw error;
  }
  return <div className="workspace"><aside className="sidebar"><Link className="wordmark" href="/admin">YOUR BRAND<span>Admin workspace</span></Link><AdminNav owner={admin.role === "owner"} /><div className="sidebar-bottom"><p className="small">Signed in as <strong>{admin.role}</strong></p><form action="/api/v1/auth/logout" method="post"><button className="secondary" type="submit">Sign out</button></form><Link href="/">Back to project</Link></div></aside><div className="workspace-body"><div className="mode-banner"><span className="mode-dot" />{readEnvironment().APP_MODE.toUpperCase()} MODE <span>Store workspace</span></div>{children}</div></div>;
}
