import { requireAdmin } from "../../../../lib/auth/server.ts";
import { M5Operations } from "../../../../components/admin/M5Operations.tsx";
export const dynamic = "force-dynamic";
export default async function OperationsPage() { const admin = await requireAdmin(); return <main id="main" className="overview m5-page"><M5Operations owner={admin.role === "owner"} /></main>; }
