import test from "node:test";
import assert from "node:assert/strict";
import { fixtureCatalogSnapshot as catalog } from "../src/lib/catalog/fixture.ts";
import { fixtureProductId } from "../src/data/fixtures/catalog.ts";
import { catalogHref, parseCatalogQuery, queryCatalog, queryParams, resetCatalogFilters, serializeCatalogQuery } from "../src/lib/catalog/query.ts";

const parse = (value = "") => parseCatalogQuery(new URLSearchParams(value), catalog, { search: true });

test("query parsing allowlists, deduplicates and corrects reversed integer paise bounds", () => {
  const query = parse("category=shirts&category=shirts&category=missing&size=M&size=M&size=wat&color=black&color=nope&minPrice=200000&maxPrice=50000&page=0&sort=wat&q=%20%20Washed%20%20Studio%20");
  assert.deepEqual(query.category, ["shirts"]);
  assert.deepEqual(query.size, ["M"]);
  assert.deepEqual(query.color, ["black"]);
  assert.equal(query.q, "Washed Studio");
  assert.equal(query.minPrice, 50000); assert.equal(query.maxPrice, 200000);
  assert.equal(query.page, 1); assert.equal(query.sort, "featured");
  assert.equal(query.notices.length, 1);
  for (const value of ["-1", "1.5", "1e5", "Infinity", "9007199254740992", ""]) {
    assert.equal(parse(`minPrice=${value}`).minPrice, null);
    assert.equal(parse(`page=${value}`).page, 1);
  }
  assert.equal(parse("minPrice=0").minPrice, 0);
  assert.equal(parseCatalogQuery(new URLSearchParams("q=washed"), catalog).q, "");
});

test("colour, size, price and stock must belong to one matching variant", () => {
  const first = fixtureProductId(1);
  assert.ok(!queryCatalog(catalog, parse("color=black&size=S&inStock=true")).rows.some((row) => row.product.id === first));
  assert.ok(queryCatalog(catalog, parse("color=black&color=off-white&size=S&inStock=true")).rows.some((row) => row.product.id === first));
  const shirt = fixtureProductId(12);
  assert.ok(!queryCatalog(catalog, parse("color=stone&maxPrice=170000")).rows.some((row) => row.product.id === shirt));
  const result = queryCatalog(catalog, parse("category=shirts&color=stone&minPrice=170000"));
  assert.equal(result.total, 1);
  assert.equal(result.rows[0]!.product.id, shirt);
  assert.equal(result.rows[0]!.minPricePaise, 179900);
  assert.equal(result.rows[0]!.maxPricePaise, 179900);
  assert.ok(result.rows[0]!.matchingVariants.every((variant) => variant.colorKey === "stone"));
});

test("OR values combine within category and size groups while groups remain AND", () => {
  const result = queryCatalog(catalog, parse("category=hoodies&category=shirts&size=M&size=L&color=black&inStock=true"));
  assert.ok(result.rows.length > 0);
  for (const row of result.rows) {
    assert.ok(["hoodies", "shirts"].includes(catalog.categories.find((category) => category.id === row.product.categoryId)!.slug));
    assert.ok(row.matchingVariants.every((variant) => ["M", "L"].includes(variant.size) && variant.colorKey === "black" && variant.available));
  }
  assert.ok(!result.rows.some((row) => row.product.id === fixtureProductId(7)));
});

test("matching minimum price controls sorting and stable IDs break equal values", () => {
  const result = queryCatalog(catalog, parse("category=shirts&color=stone&color=off-white&sort=price-asc"));
  assert.deepEqual(result.rows.map((row) => row.minPricePaise), [149900, 179900]);
  const equal = structuredClone(catalog);
  equal.products = equal.products.slice(0, 3).reverse();
  equal.products.forEach((product) => { product.featuredRank = 0; product.variants.forEach((variant) => { variant.pricePaise = 100; }); });
  for (const sort of ["featured", "newest", "price-asc", "price-desc"]) {
    const rows = queryCatalog(equal, parse(`sort=${sort}`)).rows;
    assert.deepEqual(rows.map((row) => row.product.id), equal.products.map((row) => row.id).sort());
  }
  const descending = queryCatalog(catalog, parse("category=shirts&color=stone&color=off-white&sort=price-desc"));
  assert.deepEqual(descending.rows.map((row) => row.minPricePaise), [179900, 149900]);
  equal.products[0]!.publishedAt = "2026-09-20T00:00:00.000Z";
  equal.products[1]!.publishedAt = "2026-09-21T00:00:00.000Z";
  assert.equal(queryCatalog(equal, parse("sort=newest")).rows[0]?.product.id, equal.products[1]!.id);
});

test("featured order follows collection membership and pagination clamps safely", () => {
  const collection = catalog.collections.find((row) => row.slug === "new-arrivals")!;
  assert.deepEqual(queryCatalog(catalog, parse(), collection).rows.map((row) => row.product.id), collection.productIds);
  const first = queryCatalog(catalog, parse());
  const second = queryCatalog(catalog, parse("page=999"));
  assert.equal(first.rows.length, 12); assert.equal(first.total, 16);
  assert.equal(second.rows.length, 4); assert.equal(second.page, 2); assert.equal(second.pageCount, 2);
  assert.ok(second.notices.length);
  assert.equal(new Set([...first.rows, ...second.rows].map((row) => row.product.id)).size, 16);
  const empty = queryCatalog(catalog, parse("minPrice=99999999&page=999"));
  assert.equal(empty.total, 0); assert.equal(empty.page, 1); assert.equal(empty.pageCount, 1);
});

test("search normalizes whitespace/case and navigation retains only safe catalog state", () => {
  assert.equal(queryCatalog(catalog, parse("q=%20wAsHeD%20%20sTuDiO%20")).rows[0]?.product.id, fixtureProductId(2));
  const query = parse("q=washed&size=M&size=L&color=stone&inStock=true&sort=price-desc&page=2&token=secret");
  const serialized = serializeCatalogQuery(query);
  assert.ok(!serialized.includes("secret"));
  assert.deepEqual(parse(serialized), query);
  assert.equal(new URL(catalogHref("/search", query, 1), "https://example.test").searchParams.has("page"), false);
  const reset = resetCatalogFilters(query);
  assert.equal(reset.q, "washed"); assert.equal(reset.sort, "price-desc"); assert.equal(reset.page, 1);
  assert.deepEqual(reset.size, []); assert.equal(reset.inStock, false);
  assert.deepEqual(queryParams({ size: ["M", "L"], q: "washed", page: undefined }).getAll("size"), ["M", "L"]);
});
