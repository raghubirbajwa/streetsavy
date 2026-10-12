import assert from "node:assert/strict";
import test from "node:test";
import type { PublicProduct } from "../src/lib/validation/catalog.ts";
import { initialSelection, selectColor, selectedVariant, productMedia } from "../src/lib/store/purchase.ts";
import { decodeWishlist, encodeWishlist } from "../src/lib/store/wishlist.ts";

const product: PublicProduct = {
  id: "10000000-0000-4000-8000-000000000001", slug: "test-tee", title: "Test tee", description: "", categoryId: "20000000-0000-4000-8000-000000000001", tags: [], fit: "relaxed", material: null, care: [], sizeGuideId: null, featuredRank: 0, publishedAt: "2026-09-01T00:00:00.000Z", isDemo: true,
  variants: [
    { id: "30000000-0000-4000-8000-000000000001", colorKey: "black", colorLabel: "Black", colorHex: "#151515", size: "S", pricePaise: 89900, compareAtPaise: null, available: true },
    { id: "30000000-0000-4000-8000-000000000002", colorKey: "black", colorLabel: "Black", colorHex: "#151515", size: "M", pricePaise: 89900, compareAtPaise: null, available: false },
    { id: "30000000-0000-4000-8000-000000000003", colorKey: "blue", colorLabel: "Blue", colorHex: "#336699", size: "S", pricePaise: 99900, compareAtPaise: null, available: false },
    { id: "30000000-0000-4000-8000-000000000004", colorKey: "blue", colorLabel: "Blue", colorHex: "#336699", size: "M", pricePaise: 99900, compareAtPaise: null, available: true },
    { id: "30000000-0000-4000-8000-000000000005", colorKey: "white", colorLabel: "White", colorHex: "#eeeeee", size: "S", pricePaise: 99900, compareAtPaise: null, available: true },
  ], media: [],
};
test("size stays explicit, including one-size accessories; only a belonging variant URL preselects", () => {
  assert.deepEqual(initialSelection(product), { colorKey: "black", size: null });
  assert.deepEqual(initialSelection(product, "foreign-variant"), { colorKey: "black", size: null });
  const soldOut = initialSelection(product, product.variants[1]!.id);
  assert.deepEqual(soldOut, { colorKey: "black", size: "M" });
  assert.equal(selectedVariant(product, soldOut)?.available, false);
  const accessory = { ...product, variants: [{ ...product.variants[0]!, size: "ONE_SIZE" as const }] };
  assert.equal(initialSelection(accessory).size, null);
});
test("colour change preserves only an available matching size and never substitutes another size", () => {
  assert.deepEqual(selectColor(product, { colorKey: "black", size: "S" }, "white"), { colorKey: "white", size: "S" });
  assert.deepEqual(selectColor(product, { colorKey: "black", size: "S" }, "blue"), { colorKey: "blue", size: null });
  assert.deepEqual(selectColor(product, { colorKey: "blue", size: "M" }, "white"), { colorKey: "white", size: null });
  assert.equal(selectedVariant(product, { colorKey: "blue", size: null }), null);
});
test("gallery selects the colour cover and shared media without borrowing another colour's images", () => {
  const media = (id: string, colorKey: string | null, isCover: boolean, sortOrder: number): PublicProduct["media"][number] => ({ id, publicKey: `${id}.png`, type: "image", contentType: "image/png", width: 600, height: 800, alt: id, colorKey, sortOrder, isCover });
  const example = { ...product, media: [media("shared", null, true, 0), media("blue", "blue", true, 2), media("black", "black", true, 1), media("detail", null, false, 0)] };
  assert.deepEqual(productMedia(example, "blue").map((item) => item.id), ["blue", "shared", "detail"]);
});
test("wishlist parser bounds, validates and deduplicates storage without accepting corrupt versions", () => {
  const first = product.id, second = "10000000-0000-4000-8000-000000000002";
  assert.deepEqual(decodeWishlist(encodeWishlist([first, first, second])), [first, second]);
  assert.deepEqual(decodeWishlist(JSON.stringify({ version: 1, productIds: [first, 3, null, "<script>", second] })), [first, second]);
  for (const raw of [null, "broken-json", "[]", JSON.stringify({ version: 2, productIds: [first] }), "x".repeat(20001)]) assert.deepEqual(decodeWishlist(raw), []);
  const ids = Array.from({ length: 130 }, (_, index) => `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`);
  assert.equal(decodeWishlist(JSON.stringify({ version: 1, productIds: ids })).length, 100);
});
