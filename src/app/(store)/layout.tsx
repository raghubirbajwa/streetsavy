import type { Metadata } from "next";
import { StoreProvider } from "../../components/store/store-provider.tsx";
import { StoreHeader } from "../../components/store/store-header.tsx";
import { StoreFooter } from "../../components/store/store-footer.tsx";
import { storefrontData } from "../../lib/catalog/storefront.ts";
import { accountInitial, getStoreCustomer } from "../../lib/auth/store-customer.ts";
import "./store.css";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: { default: "YOUR BRAND — Everyday Streetwear", template: "%s | YOUR BRAND" }, description: "Relaxed fits. Strong details. Explore the everyday edit." };
export default async function StoreLayout({ children }: { children: React.ReactNode }) {
  const [{ home, catalog, mode }, customer] = await Promise.all([storefrontData(), getStoreCustomer()]);
  const defaults = [{label:"New Arrivals",slug:"new-arrivals"},{label:"Men",slug:"men"},{label:"Women",slug:"women"},{label:"Accessories",slug:"accessories"}];
  const navigation = home?.navigation.length ? home.navigation.flatMap((item) => { const c = catalog.collections.find((c) => c.id === item.collectionId); return c ? [{ label: item.label, href: `/collections/${c.slug}` }] : []; }) : defaults.filter((item) => catalog.collections.some((c) => c.slug === item.slug)).map((item) => ({ label:item.label,href:`/collections/${item.slug}` }));
  navigation.push({label:"Collections",href:"/collections"});
  const initial = customer ? accountInitial(customer) : null;
  return <div className="store"><StoreProvider><StoreHeader navigation={navigation} signedIn={customer !== null} {...(initial ? { accountInitial: initial } : {})} />{children}<StoreFooter preview={mode !== "live"} collectionSlugs={catalog.collections.map((c) => c.slug)} /></StoreProvider></div>;
}
