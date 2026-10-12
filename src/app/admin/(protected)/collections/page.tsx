import { requireAdmin } from "../../../../lib/auth/server.ts";
import { readCollections } from "../../../../lib/admin/content.ts";
import CollectionsEditor from "./editor.tsx";
export const dynamic = "force-dynamic";
export default async function CollectionsPage() {
  const actor = await requireAdmin();
  return <main id="main" className="overview"><header className="page-heading"><p className="eyebrow">Merchandising</p><h1>Collections</h1><p>Arrange products, review the draft, then publish the collection.</p></header><CollectionsEditor initial={await readCollections(actor)} /></main>;
}
