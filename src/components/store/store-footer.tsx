import Link from "next/link";

const shopLinks = [
  { slug: "new-arrivals", label: "New Arrivals" },
  { slug: "men", label: "Men" },
  { slug: "women", label: "Women" },
  { slug: "accessories", label: "Accessories" },
];
const supportLinks = [
  { href: "/track-order", label: "Track order" },
  { href: "/size-guide", label: "Size guide" },
  { href: "/contact", label: "Contact" },
  { href: "/about", label: "About" },
];
const policyLinks = [
  { href: "/policies/shipping", label: "Shipping" },
  { href: "/policies/returns", label: "Returns" },
  { href: "/policies/privacy", label: "Privacy" },
  { href: "/policies/terms", label: "Terms" },
];

export function StoreFooter({ preview, collectionSlugs }: { preview: boolean; collectionSlugs: string[] }) {
  return <footer className="store-footer">
    <div className="store-footer-brand">
      <img className="store-footer-wordmark" src="/brand/streetsavy-logo.png" alt="" />
      <div className="store-footer-links">
        <section className="store-footer-about" aria-label="Footer about">
          <p className="store-kicker">THE EVERYDAY EDIT</p>
          <h2>Make room for<br />your everyday.</h2>
          <Link className="store-text-link" href="/collections">Explore clothing <span aria-hidden="true">↗</span></Link>
        </section>
        <nav aria-label="Footer shop">
          <h3>SHOP</h3>
          {shopLinks.filter((item) => collectionSlugs.includes(item.slug)).map((item) => <Link key={item.slug} href={`/collections/${item.slug}`}>{item.label}</Link>)}
          <Link href="/collections">All collections</Link>
        </nav>
        <nav aria-label="Support">
          <h3>SUPPORT</h3>
          {supportLinks.map((item) => <Link key={item.href} href={item.href}>{item.label}</Link>)}
        </nav>
        <nav aria-label="Policies">
          <h3>INFORMATION</h3>
          {policyLinks.map((item) => <Link key={item.href} href={item.href}>{item.label}</Link>)}
        </nav>
      </div>
      <div className="store-footer-bottom"><span>YOUR BRAND · Everyday Streetwear</span><span>{preview ? "Fixture preview · Sample catalog and placeholder imagery" : "India · INR ₹"}</span></div>
    </div>
  </footer>;
}
