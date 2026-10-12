import Link from "next/link";
import { notFound } from "next/navigation";
import { publicStoreSettings } from "../../../../lib/catalog/storefront.ts";
const titles = { shipping: "Shipping", returns: "Returns", privacy: "Privacy", terms: "Terms" };
type Policy = keyof typeof titles;
function isPolicy(slug: string): slug is Policy { return Object.hasOwn(titles, slug); }
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) { const { slug } = await params; return { title: isPolicy(slug) ? titles[slug] : "Page not found" }; }
export default async function PolicyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isPolicy(slug)) notFound();
  const settings = await publicStoreSettings();
  const copy = settings?.policies?.[slug];
  return <main id="main" className="store-info"><p className="store-kicker">STORE INFORMATION</p><h1>{titles[slug]}</h1>{copy ? <div className="store-policy-copy">{copy}</div> : <><p>The store’s {titles[slug].toLowerCase()} policy has not been published yet.</p><p>This preview does not accept payments or place real orders. Approved business policies will be available before the store opens.</p></>}<div className="store-info-links"><Link href="/contact">Contact</Link><Link href="/collections">Explore collections</Link></div></main>;
}
