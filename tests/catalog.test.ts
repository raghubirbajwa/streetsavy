import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createFixtureCatalogSeed, fixtureCatalogSeedSchema, fixtureCollectionMemberships, fixtureId, fixtureProductId, longTitleDevelopmentProduct } from "../src/data/fixtures/catalog.ts";
import { createFixtureSeedSql } from "../src/data/fixtures/seed-sql.ts";
import { fixtureCatalogRepository, fixtureCatalogSnapshot } from "../src/lib/catalog/fixture.ts";
import { projectPublicCatalog } from "../src/lib/catalog/projection.ts";
import { createCatalogRepository } from "../src/lib/catalog/repository.ts";
import { catalogSnapshotSchema, moneyPaiseSchema, sizeGuideValuesSchema } from "../src/lib/validation/catalog.ts";

test("sixteen complete demo products have deterministic UUIDs, variants and explicit stock", () => {
  const seed = createFixtureCatalogSeed();
  assert.deepEqual(seed, createFixtureCatalogSeed());
  assert.equal(seed.products.length, 16);
  assert.equal(seed.categories.length, 5);
  assert.equal(seed.collections.length, 11);
  assert.equal(seed.product_variants.length, 110);
  assert.equal(seed.inventory.length, 110);
  assert.equal(new Set(seed.products.map((product) => product.id)).size, 16);
  assert.match(fixtureProductId(1), /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(fixtureProductId(1), fixtureId("product:01"));
  assert.equal(fixtureProductId(1), "221c4ac8-2cbb-52bb-8e96-b248989920df");
  assert.equal(fixtureProductId(16), "19ae2acd-9204-57aa-b0e1-9257e35c55f0");
  for (const product of seed.products) {
    assert.equal(product.is_demo, true);
    assert.equal(product.status, "published");
    const variants = seed.product_variants.filter((variant) => variant.product_id === product.id);
    assert.equal(variants.length, product.featured_rank >= 13 ? 2 : 8);
    variants.forEach((variant) => {
      assert.equal(variant.compare_at_paise, null);
      assert.equal(variant.tax_category_key, null);
      assert.ok(Number.isSafeInteger(variant.price_paise));
      assert.ok(variant.unit_weight_g > 0);
      const stock = seed.inventory.find((row) => row.variant_id === variant.id)!;
      assert.equal(stock.reserved, 0);
      assert.ok(Number.isInteger(stock.on_hand) && stock.on_hand >= 0);
    });
  }
});

test("fixture edge cases are present without changing the sixteen approved titles", () => {
  const first = fixtureCatalogSnapshot.products.find((product) => product.id === fixtureProductId(1))!;
  assert.equal(first.variants.find((variant) => variant.colorKey === "black" && variant.size === "S")?.available, false);
  assert.ok(first.variants.some((variant) => variant.available));
  const soldOut = fixtureCatalogSnapshot.products.find((product) => product.id === fixtureProductId(7))!;
  assert.ok(soldOut.variants.every((variant) => !variant.available));
  const range = fixtureCatalogSnapshot.products.find((product) => product.id === fixtureProductId(12))!;
  assert.deepEqual([...new Set(range.variants.map((variant) => variant.pricePaise))].sort(), [169900, 179900]);
  assert.ok(range.variants.filter((variant) => variant.colorKey === "stone").every((variant) => variant.pricePaise === 179900));
  assert.equal(fixtureCatalogSnapshot.products.find((product) => product.id === fixtureProductId(15))!.media.length, 1);
  assert.ok(fixtureCatalogSnapshot.products.filter((product) => product.id !== fixtureProductId(15)).every((product) => product.media.length === 2));
  assert.ok(longTitleDevelopmentProduct.title.length > 100);
  assert.equal(first.title, "Everyday Oversized Tee");
});

test("all collection memberships contain real UUIDs in the specified featured order", () => {
  fixtureCollectionMemberships.forEach(([slug, , numbers]) => {
    const collection = fixtureCatalogSnapshot.collections.find((row) => row.slug === slug)!;
    assert.deepEqual(collection.productIds, numbers.map(fixtureProductId));
  });
});

test("projection excludes drafts, archived products, inactive categories, disabled variants and private media", () => {
  const seed = createFixtureCatalogSeed();
  seed.products[0]!.status = "draft";
  seed.products[1]!.status = "archived";
  seed.categories.find((category) => category.slug === "hoodies")!.active = false;
  const disabledVariant = seed.product_variants.find((variant) => variant.product_id === fixtureProductId(3))!;
  disabledVariant.enabled = false;
  const privateMedia = seed.media_assets.find((media) => media.id === seed.product_media.find((link) => link.product_id === fixtureProductId(3))!.media_id)!;
  privateMedia.status = "ready";
  privateMedia.public_key = null;
  const result = projectPublicCatalog(seed);
  const excluded = [1, 2, 5, 6, 7].map(fixtureProductId);
  assert.ok(result.products.every((product) => !excluded.includes(product.id)));
  assert.ok(result.collections.every((collection) => collection.productIds.every((id) => !excluded.includes(id))));
  const visible = result.products.find((product) => product.id === fixtureProductId(3))!;
  assert.ok(visible.variants.every((variant) => variant.id !== disabledVariant.id));
  assert.ok(visible.media.every((media) => media.id !== privateMedia.id));
  const text = JSON.stringify(result);
  for (const field of ["on_hand", "reserved", "stage_key", "stageKey", "sku", "tax_category_key", "unit_weight_g", "source_details", "uploaded_by", "last_error", "version"]) {
    assert.ok(!text.includes(`"${field}"`), field);
  }
});

test("availability subtracts reservations, and missing inventory is unavailable", () => {
  const seed = createFixtureCatalogSeed();
  const variant = seed.product_variants[1]!;
  const stock = seed.inventory.find((row) => row.variant_id === variant.id)!;
  stock.reserved = stock.on_hand;
  const getAvailable = () => projectPublicCatalog(seed).products.flatMap((product) => product.variants).find((row) => row.id === variant.id)!.available;
  assert.equal(getAvailable(), false);
  stock.reserved -= 1;
  assert.equal(getAvailable(), true);
  seed.inventory = seed.inventory.filter((row) => row.variant_id !== variant.id);
  assert.equal(getAvailable(), false);
});

test("strict DTO validation catches private fields and unsafe amounts", () => {
  const copy = structuredClone(fixtureCatalogSnapshot);
  copy.products[0]!.publishedAt = "2026-09-01T00:00:00+00:00";
  assert.equal(catalogSnapshotSchema.parse(copy).products[0]!.publishedAt, "2026-09-01T00:00:00.000Z");
  const variant = copy.products[0]!.variants[0]!;
  assert.equal(catalogSnapshotSchema.safeParse({ ...copy, privateOrders: [] }).success, false);
  (variant as unknown as Record<string, unknown>).onHand = 100;
  assert.equal(catalogSnapshotSchema.safeParse(copy).success, false);
  for (const invalid of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, "100"]) assert.equal(moneyPaiseSchema.safeParse(invalid).success, false);
  const badSeed = createFixtureCatalogSeed();
  badSeed.inventory[0]!.reserved = badSeed.inventory[0]!.on_hand + 1;
  assert.equal(fixtureCatalogSeedSchema.safeParse(badSeed).success, false);
});

test("measurement values must match distinct columns and size rows", () => {
  const valid = { columns: [{ key: "chest", label: "Chest width" }], rows: [{ size: "S", values: { chest: 50 } }] };
  assert.equal(sizeGuideValuesSchema.safeParse(valid).success, true);
  assert.equal(sizeGuideValuesSchema.safeParse({ ...valid, rows: [{ size: "S", values: { length: 60 } }] }).success, false);
  assert.equal(sizeGuideValuesSchema.safeParse({ ...valid, columns: [valid.columns[0], valid.columns[0]] }).success, false);
  assert.equal(sizeGuideValuesSchema.safeParse({ ...valid, rows: [valid.rows[0], valid.rows[0]] }).success, false);
});

test("repository exposes validated independent DTOs and null for unknown routes", async () => {
  assert.equal((await fixtureCatalogRepository.listProducts()).length, 16);
  assert.equal((await fixtureCatalogRepository.getProduct("everyday-oversized-tee"))?.id, fixtureProductId(1));
  assert.equal(await fixtureCatalogRepository.getProduct("draft-missing"), null);
  assert.equal(await fixtureCatalogRepository.getProduct("../private"), null);
  assert.equal(await fixtureCatalogRepository.getCollection("not-a-collection"), null);
  assert.equal((await fixtureCatalogRepository.getCollection("all"))?.productIds.length, 16);
  const first = await fixtureCatalogRepository.listProducts();
  first[0]!.title = "Mutated consumer object";
  assert.equal((await fixtureCatalogRepository.listProducts())[0]!.title, "Everyday Oversized Tee");
  await assert.rejects(createCatalogRepository(async () => ({ ...fixtureCatalogSnapshot, secret: "never ship" })).snapshot());
});

test("guarded seed SQL is deterministic and cannot be generated in live mode", () => {
  const sql = createFixtureSeedSql("fixture");
  assert.equal(sql, createFixtureSeedSql("test"));
  assert.ok(sql.includes("FIXTURE_SEED_REQUIRES_ISOLATED_TEST_DATABASE"));
  assert.ok(sql.includes("FIXTURE_SEED_REQUIRES_EMPTY_CATALOG_AND_ORDERS"));
  assert.ok(sql.includes(fixtureProductId(16)));
  assert.ok(!sql.includes("on conflict"));
  assert.ok(!sql.includes("truncate"));
  assert.throws(() => createFixtureSeedSql("live"), /FIXTURE_SEED_FORBIDDEN_IN_LIVE/);
});

test("every placeholder media reference resolves to deterministic original local bytes", async () => {
  const seed = createFixtureCatalogSeed();
  assert.equal(seed.media_assets.length, 31);
  for (const media of seed.media_assets) {
    const bytes = await readFile(new URL(`../public/${media.public_key}`, import.meta.url));
    assert.equal(bytes.length, media.size_bytes);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), media.checksum);
    assert.equal(bytes.subarray(1, 4).toString(), "PNG");
    assert.equal(bytes.readUInt32BE(16), 600);
    assert.equal(bytes.readUInt32BE(20), 800);
    assert.match(media.alt, /Neutral demo placeholder/);
  }
});
