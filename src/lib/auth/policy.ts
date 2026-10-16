export type Identity = Readonly<{ id: string; email?: string }>;
export type Membership = Readonly<{ userId: string; role: "owner" | "staff"; enabled: boolean }>;
export type Admin = Identity & { role: "owner" | "staff" };

export class AccessError extends Error {
  readonly status: 401 | 403;
  constructor(status: 401 | 403) {
    super(status === 401 ? "Sign in to continue." : "You do not have access to this workspace.");
    this.name = "AccessError";
    this.status = status;
  }
}

export function authorizeAdmin(user: Identity | null, membership: Membership | null, ownerOnly = false): Admin {
  if (!user) throw new AccessError(401);
  if (!membership || membership.userId !== user.id || !membership.enabled
    || !["owner", "staff"].includes(membership.role)
    || (ownerOnly && membership.role !== "owner")) throw new AccessError(403);
  return { ...user, role: membership.role };
}

export function safeAuthDestination(value: string | null): "/admin" | "/admin/reset-password" {
  return value === "/admin/reset-password" ? value : "/admin";
}

const storeRoots = ["/account", "/wishlist", "/checkout", "/track-order", "/orders", "/collections", "/search", "/contact", "/products"] as const;

/** Pathname only, after URL normalization. Rejects off-site and non-store targets. */
function storePathname(value: string): string | null {
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || value.includes("\0")) return null;
  let url: URL;
  try { url = new URL(value, "http://store.local"); } catch { return null; }
  if (url.origin !== "http://store.local" || url.username || url.password) return null;
  const path = url.pathname;
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("..")) return null;
  if (path === "/") return path;
  const allowed = storeRoots.some((root) => path === root || path.startsWith(`${root}/`));
  return allowed ? path : null;
}

/** Post-login storefront redirect. Unknown values stay on the account page. */
export function safeStoreAuthDestination(value: string | null): string {
  if (!value) return "/account";
  return storePathname(value) ?? "/account";
}

/** Email-link landing. Admin recovery stays on its exact path; store links stay in the store. */
export function safeCallbackDestination(value: string | null): string {
  if (value === "/admin/reset-password") return value;
  if (value) {
    const path = storePathname(value);
    if (path) return path;
  }
  return "/admin";
}

export function authRecoveryFailure(value: string | null): string {
  if (value && storePathname(value)) return "/account?tab=login&error=recovery";
  return "/admin/login?error=recovery";
}
