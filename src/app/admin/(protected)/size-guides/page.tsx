import { requireAdmin } from "../../../../lib/auth/server.ts";
import { getCatalogAdmin } from "../../../../lib/admin/catalog.ts";
import SizeGuides from "../../../../components/admin/SizeGuides.tsx";
export default async function SizeGuidesPage(){const actor=await requireAdmin();const snapshot=await getCatalogAdmin(actor);return <main id="main" className="overview"><p className="eyebrow">CATALOG / SIZING</p><h1>Measured with care.</h1><p className="intro">Enter actual garment or body measurements in centimetres. Demo measurements must be replaced before live publication.</p><SizeGuides initial={snapshot.sizeGuides} /></main>;}
