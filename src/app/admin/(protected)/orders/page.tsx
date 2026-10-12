import { requireAdmin } from "../../../../lib/auth/server.ts";
import { M5OrderList } from "../../../../components/admin/M5Orders.tsx";
export const dynamic = "force-dynamic";
export default async function OrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin(); const query = await searchParams, params = new URLSearchParams();
  for (const key of ["paymentStatus", "fulfillmentStatus", "attention", "search", "page"]) { const value = query[key]; if (typeof value === "string" && value) params.set(key, value); }
  return <main id="main" className="overview m5-page"><M5OrderList query={params.toString()} /></main>;
}
