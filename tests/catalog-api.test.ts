import test from "node:test";
import assert from "node:assert/strict";
import { fixtureCatalogSnapshot as catalog } from "../src/lib/catalog/fixture.ts";
import { fixtureProductId } from "../src/data/fixtures/catalog.ts";
import { publicProductListing, publicProductDetail, publicCollectionDetail, productCardSchema, productDetailSchema } from "../src/lib/catalog/public-api.ts";
import { catalogResponse, CatalogNotFound } from "../src/lib/http/catalog.ts";

test("public listing projects matching price/colour/availability without private inventory", () => {
  const { data } = publicProductListing(catalog, new URLSearchParams("category=shirts&color=stone&minPrice=170000&inStock=true"));
  assert.equal(data.total, 1); assert.equal(data.pageSize, 12); assert.equal(data.totalPages, 1);
  const card = data.items[0]!;
  assert.equal(card.id, fixtureProductId(12)); assert.equal(card.fromPricePaise, 179900); assert.equal(card.hasPriceRange, false);
  assert.equal(card.availability, "in_stock"); assert.equal(card.category.slug, "shirts");
  assert.deepEqual(card.colors.map((color) => color.colorKey), ["stone"]);
  const product = catalog.products.find((row) => row.id === card.id)!;
  assert.deepEqual(card.matchingVariantIds, product.variants.filter((variant) => variant.colorKey === "stone" && variant.available).map((variant) => variant.id));
  assert.deepEqual(Object.keys(card).sort(), ["id", "slug", "title", "category", "cover", "colors", "fromPricePaise", "hasPriceRange", "availability", "matchingVariantIds"].sort());
  assert.equal(productCardSchema.safeParse({ ...card, stockOnHand: 99 }).success, false);
  assert.ok(!JSON.stringify(card).includes("sku"));
});

test("public listing preserves page bounds and price correction notices", () => {
  const { data, notices } = publicProductListing(catalog, new URLSearchParams("minPrice=200000&maxPrice=50000&page=999"));
  assert.equal(data.page, data.totalPages); assert.ok(data.items.length <= 12);
  assert.ok(notices.some((notice) => notice.includes("reversed")));
  assert.ok(notices.some((notice) => notice.includes("page")));
  const sold = publicProductListing(catalog, new URLSearchParams("q=Panelled%20Street")).data.items[0]!;
  assert.equal(sold.availability, "sold_out");
  const ranged = publicProductListing(catalog, new URLSearchParams("q=Contrast%20Stitch")).data.items[0]!;
  assert.equal(ranged.fromPricePaise, 169900); assert.equal(ranged.hasPriceRange, true);
});

test("public detail enriches the validated product and missing products stay absent", () => {
  const product = publicProductDetail(catalog, "everyday-oversized-tee")!;
  assert.equal(product.title, "Everyday Oversized Tee"); assert.equal(product.category.slug, "oversized-tees"); assert.equal(product.guide, null);
  assert.ok(product.variants.length); assert.ok(product.media.length);
  assert.equal(productDetailSchema.safeParse({ ...product, unpublishedChanges: {} }).success, false);
  assert.equal(publicProductDetail(catalog, "draft-missing"), null);
  assert.equal(publicProductDetail(catalog, "../private"), null);
  const collection = catalog.collections.find((row) => row.slug === "new-arrivals")!;
  assert.deepEqual(publicCollectionDetail(catalog, collection).products.map((row) => row.id), collection.productIds);
});

test("public catalog transport gives real missing/error statuses with safe messages", async () => {
  const missing = await catalogResponse(async () => { throw new CatalogNotFound("private-id"); });
  assert.equal(missing.status, 404); assert.match(missing.headers.get("cache-control") ?? "", /no-store/);
  assert.equal((await missing.json()).error.code, "NOT_FOUND");
  const failed = await catalogResponse(async () => { throw new Error("database secret"); });
  assert.equal(failed.status, 503); assert.ok(!(await failed.text()).includes("database secret"));
  const ok = await catalogResponse(async () => ({ data: { items: [] }, notices: ["Corrected range"] }));
  const response = await ok.json();
  assert.deepEqual(response.meta.notices, ["Corrected range"]); assert.ok(response.meta.requestId);
});
