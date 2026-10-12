import { notFound } from "next/navigation";
import { requireAdmin } from "../../../../../lib/auth/server.ts";
import { getCatalogAdmin } from "../../../../../lib/admin/catalog.ts";
import ProductEditor from "../../../../../components/admin/ProductEditor.tsx";
export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAdmin(); const { id } = await params; const snapshot = await getCatalogAdmin(actor);
  const product = snapshot.products.find(p => p.id === id) ?? null;
  if (id !== "new" && !product) notFound();
  return <main id="main" className="overview"><ProductEditor initial={product} snapshot={snapshot} /></main>;
}
