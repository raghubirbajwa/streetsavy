import Link from "next/link";
export default function NoAccess() {
  return <main id="main" className="auth-panel"><p className="eyebrow">YOUR BRAND / ACCESS</p><h1>Admin access required.</h1><p>Your identity does not have an active admin membership. Ask the store owner to review your access.</p><form action="/api/v1/auth/logout" method="post"><button type="submit">Sign out</button></form><Link href="/">Back to project</Link></main>;
}
