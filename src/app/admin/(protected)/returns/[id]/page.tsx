import { requireAdmin } from "../../../../../lib/auth/server.ts";
import { M5ReturnDetail } from "../../../../../components/admin/M5Returns.tsx";
export const dynamic = "force-dynamic";
export default async function ReturnPage({ params }: { params: Promise<{ id: string }> }) { const admin = await requireAdmin(), { id } = await params; return <main id="main" className="overview m5-page"><M5ReturnDetail id={id} owner={admin.role === "owner"} /></main>; }
