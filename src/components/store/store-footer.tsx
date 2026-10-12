import Link from "next/link";
export function StoreFooter({ preview, collectionSlugs }: { preview: boolean; collectionSlugs: string[] }) {
  return <footer className="store-footer"><div className="store-container">
    <div className="store-footer-top"><div><p className="store-kicker">THE EVERYDAY EDIT</p><h2>Make room for<br />your everyday.</h2><Link className="store-text-link" href="/collections">Explore clothing <span aria-hidden="true">↗</span></Link></div>
      <nav aria-label="Footer shop"><h3>SHOP</h3>{[{slug:"new-arrivals",label:"New Arrivals"},{slug:"men",label:"Men"},{slug:"women",label:"Women"},{slug:"accessories",label:"Accessories"}].filter((item) => collectionSlugs.includes(item.slug)).map((item) => <Link key={item.slug} href={`/collections/${item.slug}`}>{item.label}</Link>)}<Link href="/collections">All collections</Link></nav>
      <nav aria-label="Support"><h3>SUPPORT</h3><Link href="/track-order">Track order</Link><Link href="/size-guide">Size guide</Link><Link href="/contact">Contact</Link><Link href="/about">About</Link></nav>
      <nav aria-label="Policies"><h3>INFORMATION</h3><Link href="/policies/shipping">Shipping</Link><Link href="/policies/returns">Returns</Link><Link href="/policies/privacy">Privacy</Link><Link href="/policies/terms">Terms</Link></nav>
    </div>
    <p className="store-footer-wordmark" aria-hidden="true">YOUR BRAND</p>
    <div className="store-footer-bottom"><span>YOUR BRAND · Everyday Streetwear</span><span>{preview ? "Fixture preview · Sample catalog and placeholder imagery" : "India · INR ₹"}</span></div>
  </div></footer>;
}
