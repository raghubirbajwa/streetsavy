import Link from "next/link";
import { storefrontData, publishedMedia } from "../../lib/catalog/storefront.ts";
import { ProductCard } from "../../components/store/product-card.tsx";
import { DisplayMedia } from "../../components/store/display-media.tsx";
import { HeroBannerSlider } from "../../components/store/hero-banner-slider.tsx";
import { heroSlides } from "../../lib/store/hero-slides.ts";

export default async function Home() {
  const { catalog, home } = await storefrontData();
  const media = await publishedMedia([...(home?.lookbook.map((look) => look.mediaId) ?? []), ...catalog.collections.filter((c) => ["oversized-tees", "hoodies", "cargos", "shirts", "accessories"].includes(c.slug)).flatMap((c) => c.coverMediaId ? [c.coverMediaId] : [])]);
  const collection = (slug: string) => catalog.collections.find((c) => c.slug === slug);
  const productsFor = (ids: string[]) => ids.flatMap((id) => { const product = catalog.products.find((p) => p.id === id); return product ? [product] : []; });
  const arrivals = productsFor(collection("new-arrivals")?.productIds ?? []).slice(0, 8);
  const featured = productsFor(home?.featuredProductIds ?? []).slice(0, 8);
  const categories = ["oversized-tees", "hoodies", "cargos", "shirts", "accessories"].flatMap((slug) => { const c = collection(slug); return c ? [c] : []; });
  const slides = heroSlides();
  return <main id="main">
    <section id="store-home-hero" className="store-hero store-hero-slider" aria-label="Campaign gallery">
      <HeroBannerSlider slides={slides} />
    </section>
    <section className="store-container store-section" aria-labelledby="categories-heading"><div className="store-section-heading"><div><p className="store-kicker">BUILD YOUR ROTATION</p><h2 id="categories-heading">Find your fit</h2></div><Link href="/collections" className="store-text-link">All collections <span aria-hidden="true">↗</span></Link></div><div className="store-categories">{categories.map((c, i) => { const cover = media.find((m) => m.id === c.coverMediaId); return <Link href={`/collections/${c.slug}`} key={c.id} className="store-category"><div className="store-category-art">{cover?.type === "image" ? <DisplayMedia media={cover} sizes="(max-width: 767px) 50vw, 20vw" /> : <><span className="store-category-index">0{i+1}</span><span className="store-category-cross" aria-hidden="true" /><span className="store-category-placeholder">IMAGE PENDING</span></>}</div><div><h3>{c.title}</h3><span aria-hidden="true">↗</span></div></Link>; })}</div></section>
    {arrivals.length > 0 && <section className="store-container store-section" aria-labelledby="arrivals-heading"><div className="store-section-heading"><div><p className="store-kicker">NEW ARRIVALS</p><h2 id="arrivals-heading">Just landed</h2></div><Link className="store-text-link" href="/collections/new-arrivals">View all <span aria-hidden="true">↗</span></Link></div><div className="store-product-grid">{arrivals.map((product) => <ProductCard key={product.id} product={product} sizeGuides={catalog.sizeGuides} />)}</div></section>}
    {home?.story.heading && <section className="store-story"><div className="store-container store-story-inner"><div className="store-story-mark" aria-hidden="true">YB<span>THE EVERYDAY EDIT</span></div><div><p className="store-kicker">PIECES THAT WORK TOGETHER</p><h2>{home.story.heading}</h2><p>{home.story.body}</p><Link className="store-cta" href={collection("everyday-uniform") ? "/collections/everyday-uniform" : "/collections"}>Shop the edit<span aria-hidden="true">↗</span></Link></div></div></section>}
    {featured.length > 0 && <section className="store-container store-section" aria-labelledby="featured-heading"><div className="store-section-heading"><div><p className="store-kicker">THE FEATURED EDIT</p><h2 id="featured-heading">In the spotlight</h2></div><Link className="store-text-link" href={collection("featured") ? "/collections/featured" : "/collections"}>Explore featured <span aria-hidden="true">↗</span></Link></div><div className="store-product-grid">{featured.map((product) => <ProductCard key={product.id} product={product} sizeGuides={catalog.sizeGuides} />)}</div></section>}
    {!!home?.lookbook.length && <section className="store-container store-section" aria-labelledby="lookbook-heading"><h2 id="lookbook-heading">Wear it your way</h2><div className="store-lookbook">{home.lookbook.map((look) => { const image = media.find((m) => m.id === look.mediaId); return image ? <article key={look.mediaId}><DisplayMedia media={image} sizes="(max-width: 767px) 100vw, 50vw" /><h3>{look.title}</h3>{productsFor(look.productIds).map((p) => <Link key={p.id} href={`/products/${p.slug}`}>{p.title} ↗</Link>)}</article> : null; })}</div></section>}
  </main>;
}
