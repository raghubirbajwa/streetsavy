import { requireAdmin } from "../../../../lib/auth/server.ts";
import { MediaManager } from "../../../../components/admin/MediaManager.tsx";
export default async function MediaPage() { await requireAdmin(); return <main id="main" className="overview"><p className="eyebrow">CATALOG / MEDIA</p><h1>Your asset library.</h1><MediaManager /></main>; }
