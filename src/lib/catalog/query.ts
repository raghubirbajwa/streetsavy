import type { CatalogSnapshot, PublicCollection, PublicProduct } from "../validation/catalog.ts";

export const CATALOG_PAGE_SIZE = 12;
export const catalogSorts = ["featured", "newest", "price-asc", "price-desc"] as const;
export const catalogSizes = ["XS", "S", "M", "L", "XL", "XXL", "ONE_SIZE"] as const;
export type CatalogSort = typeof catalogSorts[number];
export type CatalogQuery = {
  q: string; category: string[]; size: string[]; color: string[];
  minPrice: number | null; maxPrice: number | null; inStock: boolean;
  sort: CatalogSort; page: number; notices: string[];
};
export type CatalogMatch = { product: PublicProduct; matchingVariants: PublicProduct["variants"]; minPricePaise: number; maxPricePaise: number };
export type CatalogResults = { rows: CatalogMatch[]; total: number; page: number; pageCount: number; pageSize: number; notices: string[] };
export type CatalogFacets = { categories: { value: string; label: string }[]; colors: { value: string; label: string }[]; sizes: string[] };

export function queryParams(values: Record<string, string | string[] | undefined>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, item);
  }
  return params;
}

export function catalogFacets(catalog: CatalogSnapshot): CatalogFacets {
  const colors = new Map<string, string>();
  const sizes = new Set<string>();
  for (const product of catalog.products) for (const variant of product.variants) {
    colors.set(variant.colorKey, variant.colorLabel); sizes.add(variant.size);
  }
  return {
    categories: [...catalog.categories].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)).map((row) => ({ value: row.slug, label: row.name })),
    colors: [...colors].sort(([a], [b]) => a.localeCompare(b)).map(([value, label]) => ({ value, label })),
    sizes: catalogSizes.filter((size) => sizes.has(size)),
  };
}

function integer(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  const result = Number(value);
  return Number.isSafeInteger(result) ? result : null;
}

export function parseCatalogQuery(params: URLSearchParams, catalog: CatalogSnapshot, { search = false }: { search?: boolean } = {}): CatalogQuery {
  const facets = catalogFacets(catalog);
  const select = (key: string, allowed: readonly string[]) => [...new Set(params.getAll(key))].filter((value) => allowed.includes(value));
  const notices: string[] = [];
  let minPrice = integer(params.get("minPrice"));
  let maxPrice = integer(params.get("maxPrice"));
  if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) {
    [minPrice, maxPrice] = [maxPrice, minPrice];
    notices.push("Your minimum and maximum prices were reversed. We have corrected the range.");
  }
  const sort = params.get("sort");
  const page = integer(params.get("page"));
  return {
    q: search ? (params.get("q") ?? "").normalize("NFKC").trim().replace(/\s+/g, " ") : "",
    category: select("category", facets.categories.map((row) => row.value)),
    size: select("size", catalogSizes), color: select("color", facets.colors.map((row) => row.value)),
    minPrice, maxPrice, inStock: params.get("inStock") === "true",
    sort: catalogSorts.find((value) => value === sort) ?? "featured", page: page && page > 0 ? page : 1, notices,
  };
}

/** Every variant-level predicate applies to the same enabled public variant. */
export function queryCatalog(catalog: CatalogSnapshot, query: CatalogQuery, collection?: PublicCollection): CatalogResults {
  const membership = collection ? new Map(collection.productIds.map((id, index) => [id, index])) : null;
  const categories = new Map(catalog.categories.map((category) => [category.id, category]));
  const needle = query.q.toLocaleLowerCase("en-IN");
  const matches: CatalogMatch[] = [];
  for (const product of catalog.products) {
    if (membership && !membership.has(product.id)) continue;
    const category = categories.get(product.categoryId);
    if (query.category.length && !query.category.includes(category?.slug ?? "")) continue;
    const searchable = [product.title, product.description, product.fit, ...product.tags, category?.name ?? "", ...product.variants.map((variant) => variant.colorLabel)].join(" ").normalize("NFKC").toLocaleLowerCase("en-IN");
    if (needle && !searchable.includes(needle)) continue;
    const matchingVariants = product.variants.filter((variant) =>
      (!query.size.length || query.size.includes(variant.size)) &&
      (!query.color.length || query.color.includes(variant.colorKey)) &&
      (query.minPrice === null || variant.pricePaise >= query.minPrice) &&
      (query.maxPrice === null || variant.pricePaise <= query.maxPrice) &&
      (!query.inStock || variant.available));
    if (!matchingVariants.length) continue;
    const prices = matchingVariants.map((variant) => variant.pricePaise);
    matches.push({ product, matchingVariants, minPricePaise: Math.min(...prices), maxPricePaise: Math.max(...prices) });
  }
  matches.sort((a, b) => {
    let difference = 0;
    if (query.sort === "price-asc") difference = a.minPricePaise - b.minPricePaise;
    else if (query.sort === "price-desc") difference = b.minPricePaise - a.minPricePaise;
    else if (query.sort === "newest") difference = Date.parse(b.product.publishedAt) - Date.parse(a.product.publishedAt);
    else difference = membership ? membership.get(a.product.id)! - membership.get(b.product.id)! : a.product.featuredRank - b.product.featuredRank;
    return difference || a.product.id.localeCompare(b.product.id);
  });
  const total = matches.length;
  const pageCount = Math.max(1, Math.ceil(total / CATALOG_PAGE_SIZE));
  const page = Math.min(query.page, pageCount);
  return { rows: matches.slice((page - 1) * CATALOG_PAGE_SIZE, page * CATALOG_PAGE_SIZE), total, page, pageCount, pageSize: CATALOG_PAGE_SIZE,
    notices: [...query.notices, ...(page !== query.page ? ["That page is no longer available. Showing the last available page."] : [])] };
}

/** Serialization always starts with an allowlist and is safe for same-route navigation. */
export function serializeCatalogQuery(query: CatalogQuery, page = query.page): string {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  for (const key of ["category", "size", "color"] as const) for (const value of query[key]) params.append(key, value);
  if (query.minPrice !== null) params.set("minPrice", String(query.minPrice));
  if (query.maxPrice !== null) params.set("maxPrice", String(query.maxPrice));
  if (query.inStock) params.set("inStock", "true");
  if (query.sort !== "featured") params.set("sort", query.sort);
  if (page > 1) params.set("page", String(page));
  return params.toString();
}

export function catalogHref(path: string, query: CatalogQuery, page = query.page): string {
  const params = serializeCatalogQuery(query, page);
  return `${path}${params ? `?${params}` : ""}`;
}

export function resetCatalogFilters(query: CatalogQuery): CatalogQuery {
  return { ...query, category: [], size: [], color: [], minPrice: null, maxPrice: null, inStock: false, page: 1, notices: [] };
}
