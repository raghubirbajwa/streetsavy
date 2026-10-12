import Link from "next/link";
import { requireAdmin } from "../../../lib/auth/server.ts";
import { readEnvironment } from "../../../config/env.ts";
import { M5Overview } from "../../../components/admin/M5Overview.tsx";
import "../../../components/admin/M5.css";
import { getCatalogAdmin } from "../../../lib/admin/catalog.ts";
export default async function Overview() {
  const admin = await requireAdmin();
  const fixture = readEnvironment().APP_MODE === "fixture";
  const catalog = await getCatalogAdmin(admin);
  return <main id="main" className="overview m5-page"><p className="eyebrow">WORKSPACE / OVERVIEW</p><h1>From order to doorstep.</h1><p className="intro">Review orders, dispatch ready parcels and resolve returns. Keep payment and inventory decisions tied to their saved records.</p>
    <M5Overview lowStockCount={catalog.products.flatMap(product=>product.variants).filter(variant=>variant.enabled && variant.inventory.available<=5).length} />
    <section className="panel"><h2>Start with a product.</h2><p>Add its variants, measurements, packaging and imagery. Preview privately, then publish when it is ready.</p><div className="form-actions"><Link className="button" href="/admin/products/new">Create product</Link><Link className="button secondary" href="/admin/content">Edit homepage</Link>{admin.role === "owner" && <Link href="/admin/settings">Review store settings</Link>}</div></section>
    <section className="review-note"><p className="eyebrow">REVIEW POINT / M5</p><h2>Dispatch, returns and refunds.</h2><p>Use <Link href="/admin/orders">Orders</Link> for separate booking, tracking number, label and pickup steps. Record physical returns before restock, and review uncertain results in <Link href="/admin/operations">Operations</Link>.</p><p className="muted">{fixture ? "Fixture preview: edits persist locally. Payments are simulated; no money, shipment or email is sent." : "Hosted payment verification and launch readiness require their recorded checks."}</p></section>
  </main>;
}
