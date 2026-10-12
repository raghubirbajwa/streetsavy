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
