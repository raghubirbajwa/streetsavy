import { requireAdmin } from "../../../../../lib/auth/server.ts";
import { AccessError } from "../../../../../lib/auth/policy.ts";

export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const admin = await requireAdmin();
    return Response.json({ data: { id: admin.id, role: admin.role } }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const status = error instanceof AccessError ? error.status : 503;
    return Response.json({ error: { code: status === 401 ? "UNAUTHENTICATED" : status === 403 ? "FORBIDDEN" : "UNAVAILABLE" } }, { status, headers: { "Cache-Control": "private, no-store" } });
  }
}
