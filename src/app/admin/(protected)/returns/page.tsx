import { requireAdmin } from "../../../../lib/auth/server.ts";
import { M5ReturnList } from "../../../../components/admin/M5Returns.tsx";
export const dynamic = "force-dynamic";
export default async function ReturnsPage() { await requireAdmin(); return <main id="main" className="overview m5-page"><M5ReturnList /></main>; }
