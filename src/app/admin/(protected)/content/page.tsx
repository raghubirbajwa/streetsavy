import { requireAdmin } from "../../../../lib/auth/server.ts";
import { readHomeContent } from "../../../../lib/admin/content.ts";
import ContentEditor from "./editor.tsx";
export const dynamic = "force-dynamic";
export default async function ContentPage() { const actor = await requireAdmin(); return <main id="main" className="overview"><header className="page-heading"><p className="eyebrow">Brand content</p><h1>Homepage</h1><p>Save a private draft, preview the copy, and publish approved references.</p></header><ContentEditor initial={await readHomeContent(actor)} /></main>; }
