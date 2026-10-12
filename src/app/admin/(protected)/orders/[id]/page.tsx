import { requireAdmin } from "../../../../../lib/auth/server.ts";
import { M5OrderDetail } from "../../../../../components/admin/M5Orders.tsx";
export const dynamic = "force-dynamic";
export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(), { id } = await params;
  return <main id="main" className="overview m5-page"><M5OrderDetail id={id} owner={admin.role === "owner"} /></main>;
}
