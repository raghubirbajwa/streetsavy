import Link from "next/link";
import type { CatalogSnapshot, PublicCollection } from "../../lib/validation/catalog.ts";
import { catalogFacets, catalogHref, queryCatalog, resetCatalogFilters } from "../../lib/catalog/query.ts";
import type { CatalogQuery } from "../../lib/catalog/query.ts";
import { CatalogControls } from "./catalog-controls.tsx";
import { ProductCard } from "./product-card.tsx";
import styles from "./catalog.module.css";

export function CatalogListing({ catalog, query, collection }: { catalog: CatalogSnapshot; query: CatalogQuery; collection?: PublicCollection }) {
  const search = !collection;
  const path = collection ? `/collections/${collection.slug}` : "/search";
  const results = queryCatalog(catalog, query, collection);
  const current = { ...query, page: results.page };
  const blankSearch = search && !query.q;
  const pages = [...new Set([1, results.page - 1, results.page, results.page + 1, results.pageCount])].filter((page) => page > 0 && page <= results.pageCount).sort((a, b) => a - b);
  return <main id="main" className={`store-container ${styles.results}`}>
    <div className={styles.intro}>
      <nav className={styles.breadcrumb} aria-label="Breadcrumb"><Link href="/">Home</Link><span aria-hidden="true">/</span>{collection ? <><Link href="/collections">Collections</Link><span aria-hidden="true">/</span><span aria-current="page">{collection.title}</span></> : <span aria-current="page">Search</span>}</nav>
      <h1>{collection?.title ?? "Find your next piece"}</h1>
      <p>{collection?.description || (search ? "Search by name, colour or style. Make it yours with a few simple filters." : "Explore the collection and find your everyday fit.")}</p>
    </div>
    <CatalogControls query={current} facets={catalogFacets(catalog)} path={path} total={blankSearch ? 0 : results.total} search={search} />
    {results.notices.map((notice) => <p className={styles.notice} key={notice} role="status">{notice}</p>)}
    {blankSearch ? <section className={styles.empty}><h2>What are you looking for?</h2><p>Enter a name, colour or style above to explore the catalog.</p><div className={styles.emptyLinks}><Link href="/collections/new-arrivals">See new arrivals</Link><Link href="/collections">Browse collections</Link></div></section>
      : results.total === 0 ? <section className={styles.empty}><h2>No items match these filters.</h2>{query.q && <p>No matches for “{query.q}”. Try a different search or adjust your filters.</p>}<div className={styles.emptyLinks}><Link href={catalogHref(path, resetCatalogFilters(current))}>Reset filters</Link><Link href="/collections">Browse collections</Link></div></section>
        : <><div className="store-product-grid" aria-label={collection ? `${collection.title} products` : "Search results"}>{results.rows.map(({ product, matchingVariants }) => <ProductCard key={product.id} product={product} matchingVariants={matchingVariants} sizeGuides={catalog.sizeGuides} />)}</div>
          {results.pageCount > 1 && <nav className={styles.pagination} aria-label="Product pages">
            {results.page > 1 && <Link href={catalogHref(path, current, results.page - 1)} aria-label="Previous page">← Previous</Link>}
            {pages.map((page, index) => <span key={page} style={{ display: "contents" }}>{index > 0 && page - pages[index - 1]! > 1 && <span aria-hidden="true">…</span>}<Link href={catalogHref(path, current, page)} aria-label={`Page ${page}`} aria-current={page === results.page ? "page" : undefined}>{page}</Link></span>)}
            {results.page < results.pageCount && <Link href={catalogHref(path, current, results.page + 1)} aria-label="Next page">Next →</Link>}
          </nav>}
        </>}
  </main>;
}
