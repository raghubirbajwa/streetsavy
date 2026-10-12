import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { catalogSlugSchema, catalogUuidSchema, clothingSizeSchema, moneyPaiseSchema, sizeGuideValuesSchema } from "../../lib/validation/catalog.ts";

/** Fixed namespace and named keys make every record reproducible across machines. */
const seedNamespace = "72fe6375-dc54-5f6a-8d80-cd9c36b6b60c";
export const fixtureTimestamp = "2026-09-01T00:00:00.000Z";
export function fixtureId(key: string): string {
  const bytes = createHash("sha1").update(Buffer.from(seedNamespace.replaceAll("-", ""), "hex")).update(key).digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const timestamp = z.string().datetime({ offset: true });
const positiveInteger = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const nonnegativeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const base = { created_at: timestamp, updated_at: timestamp };
const versioned = { ...base, version: positiveInteger };
const categoryRow = z.object({ id: catalogUuidSchema, slug: catalogSlugSchema, name: z.string().min(1), sort_order: nonnegativeInteger, active: z.boolean(), ...base }).strict();
const productRow = z.object({
  id: catalogUuidSchema, slug: catalogSlugSchema, title: z.string().min(1), description: z.string(), category_id: catalogUuidSchema,
  tags: z.array(z.string()), status: z.enum(["draft", "published", "archived"]), fit: z.string().min(1), material: z.string().nullable(), care: z.array(z.string()),
  size_guide_id: catalogUuidSchema.nullable(), featured_rank: nonnegativeInteger, published_at: timestamp.nullable(), is_demo: z.boolean(), ...versioned,
}).strict().refine((product) => product.status !== "published" || product.published_at !== null, { message: "Published products need a timestamp", path: ["published_at"] });
const variantRow = z.object({
  id: catalogUuidSchema, product_id: catalogUuidSchema, sku: z.string().min(1), color_key: catalogSlugSchema, color_label: z.string().min(1),
  color_hex: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable(), size: clothingSizeSchema, price_paise: moneyPaiseSchema, compare_at_paise: moneyPaiseSchema.nullable(),
  tax_category_key: z.string().nullable(), unit_weight_g: positiveInteger, enabled: z.boolean(), ...versioned,
}).strict().refine((variant) => variant.compare_at_paise === null || variant.compare_at_paise > variant.price_paise, { message: "Compare-at must exceed price", path: ["compare_at_paise"] });
const inventoryRow = z.object({ variant_id: catalogUuidSchema, on_hand: nonnegativeInteger, reserved: nonnegativeInteger, ...versioned }).strict()
  .refine((inventory) => inventory.reserved <= inventory.on_hand, { message: "Reserved stock exceeds on-hand", path: ["reserved"] });
const collectionRow = z.object({ id: catalogUuidSchema, slug: catalogSlugSchema, title: z.string().min(1), description: z.string(), cover_media_id: catalogUuidSchema.nullable(), active: z.boolean(), sort_order: nonnegativeInteger, ...versioned }).strict();
const membershipRow = z.object({ collection_id: catalogUuidSchema, product_id: catalogUuidSchema, sort_order: nonnegativeInteger }).strict();
const mediaRow = z.object({
  id: catalogUuidSchema, stage_key: z.string().min(1), public_key: z.string().min(1).nullable(), type: z.enum(["image", "video"]),
  status: z.enum(["uploading", "validating", "ready", "publishing", "published", "rejected", "deleting"]), content_type: z.string().min(1), size_bytes: positiveInteger,
  width: positiveInteger, height: positiveInteger, duration_seconds: z.number().positive().nullable(), poster_media_id: catalogUuidSchema.nullable(),
  checksum: z.string().min(1), alt: z.string().min(1), focal_x: z.number().min(0).max(1), focal_y: z.number().min(0).max(1),
  source_details: z.record(z.string()), license_details: z.record(z.string()), uploaded_by: catalogUuidSchema.nullable(), last_error: z.string().nullable(), ...versioned,
}).strict();
const productMediaRow = z.object({ product_id: catalogUuidSchema, media_id: catalogUuidSchema, color_key: catalogSlugSchema.nullable(), sort_order: nonnegativeInteger, is_cover: z.boolean() }).strict();
const sizeGuideRow = z.object({ id: catalogUuidSchema, title: z.string().min(1), measurement_type: z.enum(["garment", "body"]), instructions: z.string().min(1), values_cm: sizeGuideValuesSchema, is_demo: z.boolean(), ...versioned }).strict();

export const fixtureCatalogSeedSchema = z.object({
  categories: z.array(categoryRow), products: z.array(productRow), product_variants: z.array(variantRow), inventory: z.array(inventoryRow),
  collections: z.array(collectionRow), collection_products: z.array(membershipRow), media_assets: z.array(mediaRow), product_media: z.array(productMediaRow), size_guides: z.array(sizeGuideRow),
}).strict().superRefine((seed, ctx) => {
  const checkUnique = (values: readonly string[], path: string) => {
    if (new Set(values).size !== values.length) ctx.addIssue({ code: "custom", path: [path], message: "Duplicate fixture key" });
  };
  for (const key of ["categories", "products", "product_variants", "collections", "media_assets", "size_guides"] as const) checkUnique(seed[key].map((row) => row.id), key);
  for (const key of ["categories", "products", "collections"] as const) checkUnique(seed[key].map((row) => row.slug), key);
  checkUnique(seed.product_variants.map((row) => row.sku), "product_variants");
  checkUnique(seed.product_variants.map((row) => `${row.product_id}:${row.color_key}:${row.size}`), "product_variants");
  checkUnique(seed.inventory.map((row) => row.variant_id), "inventory");
  checkUnique(seed.collection_products.map((row) => `${row.collection_id}:${row.product_id}`), "collection_products");
  checkUnique(seed.product_media.map((row) => `${row.product_id}:${row.media_id}`), "product_media");
  const categories = new Set(seed.categories.map((row) => row.id));
  const products = new Set(seed.products.map((row) => row.id));
  const variants = new Set(seed.product_variants.map((row) => row.id));
  const collections = new Set(seed.collections.map((row) => row.id));
  const media = new Set(seed.media_assets.map((row) => row.id));
  const guides = new Set(seed.size_guides.map((row) => row.id));
  const foreignKey = (ok: boolean, path: string) => { if (!ok) ctx.addIssue({ code: "custom", path: [path], message: "Unresolved fixture reference" }); };
  seed.products.forEach((row) => { foreignKey(categories.has(row.category_id), "products"); foreignKey(row.size_guide_id === null || guides.has(row.size_guide_id), "products"); });
  seed.product_variants.forEach((row) => foreignKey(products.has(row.product_id), "product_variants"));
  seed.inventory.forEach((row) => foreignKey(variants.has(row.variant_id), "inventory"));
  seed.collection_products.forEach((row) => foreignKey(collections.has(row.collection_id) && products.has(row.product_id), "collection_products"));
  seed.product_media.forEach((row) => {
    foreignKey(products.has(row.product_id) && media.has(row.media_id), "product_media");
    foreignKey(row.color_key === null || seed.product_variants.some((variant) => variant.product_id === row.product_id && variant.color_key === row.color_key), "product_media");
  });
});
export type FixtureCatalogSeed = z.infer<typeof fixtureCatalogSeedSchema>;

const timestamps = { created_at: fixtureTimestamp, updated_at: fixtureTimestamp };
const version = { ...timestamps, version: 1 };
const categoryDefinitions = [
  ["oversized-tees", "Oversized Tees"], ["hoodies", "Hoodies"], ["cargos", "Cargos"], ["shirts", "Shirts"], ["accessories", "Accessories"],
] as const;
const colors = {
  black: ["Black", "#202020"], "off-white": ["Off-white", "#F1EFE6"], "washed-black": ["Washed Black", "#494949"],
  stone: ["Stone", "#C3BAA7"], olive: ["Olive", "#747951"], grey: ["Grey", "#969696"],
  "blue-check": ["Blue Check", null], "brown-check": ["Brown Check", null],
} as const;
type ColorKey = keyof typeof colors;
type ProductDefinition = { title: string; price: number; category: typeof categoryDefinitions[number][0]; colors: readonly [ColorKey, ColorKey]; description: string; stock: readonly [readonly number[], readonly number[]]; weight: number; fit: string };
const definitions: readonly ProductDefinition[] = [
  { title: "Everyday Oversized Tee", price: 89900, category: "oversized-tees", colors: ["black", "off-white"], description: "An easy oversized shape for everyday outfits.", stock: [[0, 8, 9, 6], [5, 8, 9, 6]], weight: 250, fit: "oversized" },
  { title: "Washed Studio Tee", price: 109900, category: "oversized-tees", colors: ["washed-black", "stone"], description: "A relaxed tee with a washed-look finish.", stock: [[4, 7, 8, 5], [4, 6, 7, 4]], weight: 250, fit: "relaxed" },
  { title: "Linework Graphic Tee", price: 99900, category: "oversized-tees", colors: ["black", "off-white"], description: "A graphic-led tee with a relaxed silhouette.", stock: [[6, 8, 8, 5], [5, 7, 8, 4]], weight: 250, fit: "relaxed" },
  { title: "Boxy Pocket Tee", price: 94900, category: "oversized-tees", colors: ["olive", "stone"], description: "A boxy shape with a simple pocket detail.", stock: [[4, 6, 7, 4], [5, 6, 7, 4]], weight: 250, fit: "boxy" },
  { title: "Core Pullover Hoodie", price: 189900, category: "hoodies", colors: ["black", "grey"], description: "A relaxed layer with a clean everyday look.", stock: [[4, 6, 6, 3], [3, 5, 6, 3]], weight: 700, fit: "relaxed" },
  { title: "Washed Zip Hoodie", price: 219900, category: "hoodies", colors: ["washed-black", "stone"], description: "An easy zip layer for a laid-back outfit.", stock: [[3, 5, 5, 3], [3, 4, 5, 2]], weight: 700, fit: "relaxed" },
  { title: "Panelled Street Hoodie", price: 239900, category: "hoodies", colors: ["grey", "black"], description: "Panel details give this relaxed layer definition.", stock: [[0, 0, 0, 0], [0, 0, 0, 0]], weight: 700, fit: "relaxed" },
  { title: "Straight Utility Cargo", price: 199900, category: "cargos", colors: ["olive", "black"], description: "A straight silhouette with utility-inspired pockets.", stock: [[4, 6, 7, 4], [5, 7, 7, 4]], weight: 600, fit: "straight" },
  { title: "Wide-Leg Cargo", price: 219900, category: "cargos", colors: ["stone", "black"], description: "A wider shape for relaxed everyday styling.", stock: [[3, 6, 6, 3], [4, 6, 7, 4]], weight: 600, fit: "wide-leg" },
  { title: "Everyday Drawstring Cargo", price: 179900, category: "cargos", colors: ["grey", "olive"], description: "An easy shape with a drawstring waist detail.", stock: [[4, 7, 6, 4], [3, 6, 7, 4]], weight: 600, fit: "relaxed" },
  { title: "Boxy Everyday Shirt", price: 149900, category: "shirts", colors: ["off-white", "black"], description: "A boxy shirt to wear on its own or as a layer.", stock: [[4, 6, 7, 4], [4, 6, 6, 3]], weight: 350, fit: "boxy" },
  { title: "Contrast Stitch Shirt", price: 169900, category: "shirts", colors: ["black", "stone"], description: "Contrasting stitch details on a relaxed silhouette.", stock: [[3, 5, 6, 3], [4, 5, 6, 3]], weight: 350, fit: "relaxed" },
  { title: "Relaxed Check Shirt", price: 159900, category: "shirts", colors: ["blue-check", "brown-check"], description: "A relaxed check shirt for simple layered outfits.", stock: [[4, 6, 6, 3], [3, 5, 6, 3]], weight: 350, fit: "relaxed" },
  { title: "Everyday Cap", price: 69900, category: "accessories", colors: ["black", "stone"], description: "A simple cap to finish the look.", stock: [[12], [10]], weight: 150, fit: "one-size" },
  { title: "Studio Tote", price: 79900, category: "accessories", colors: ["off-white", "black"], description: "A graphic everyday carry option.", stock: [[10], [8]], weight: 200, fit: "one-size" },
  { title: "Ribbed Crew Socks", price: 34900, category: "accessories", colors: ["off-white", "black"], description: "A crew-length pair for everyday styling.", stock: [[15], [15]], weight: 80, fit: "one-size" },
];
export const fixtureCollectionMemberships = [
  ["all", "All Clothing", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]],
  ["new-arrivals", "New Arrivals", [12, 9, 6, 3, 13, 15, 4, 7]],
  ["men", "Men", [1, 2, 5, 8, 11, 12, 14, 16]], ["women", "Women", [3, 4, 6, 9, 10, 13, 15, 16]],
  ["accessories", "Accessories", [14, 15, 16]], ["oversized-tees", "Oversized Tees", [1, 2, 3, 4]],
  ["hoodies", "Hoodies", [5, 6, 7]], ["cargos", "Cargos", [8, 9, 10]], ["shirts", "Shirts", [11, 12, 13]],
  ["everyday-uniform", "The Everyday Uniform", [1, 5, 8, 11, 14, 16]], ["featured", "Featured", [2, 5, 8, 11, 14, 16]],
] as const;
export const fixtureProductId = (number: number) => fixtureId(`product:${String(number).padStart(2, "0")}`);

// Asset bytes are generated by scripts/build-fixture-placeholders.py. These are
// neutral development placeholders, never product photography or launch assets.
import { fixtureImageMetadata } from "./image-metadata.ts";

export function createFixtureCatalogSeed(): FixtureCatalogSeed {
  const seed: FixtureCatalogSeed = {
    categories: categoryDefinitions.map(([slug, name], sort_order) => ({ id: fixtureId(`category:${slug}`), slug, name, sort_order, active: true, ...timestamps })),
    products: [], product_variants: [], inventory: [], collections: [], collection_products: [], media_assets: [], product_media: [], size_guides: [],
  };
  definitions.forEach((definition, index) => {
    const number = index + 1;
    const product_id = fixtureProductId(number);
    seed.products.push({
      id: product_id, slug: definition.title.toLowerCase().replaceAll(" ", "-"), title: definition.title, description: definition.description,
      category_id: fixtureId(`category:${definition.category}`), tags: [], status: "published", fit: definition.fit, material: null, care: [], size_guide_id: null,
      featured_rank: index, published_at: fixtureTimestamp, is_demo: true, ...version,
    });
    const sizes = definition.category === "accessories" ? ["ONE_SIZE"] as const : ["S", "M", "L", "XL"] as const;
    definition.colors.forEach((color_key, colorIndex) => sizes.forEach((size, sizeIndex) => {
      const id = fixtureId(`variant:${number}:${color_key}:${size}`);
      const on_hand = definition.stock[colorIndex]?.[sizeIndex];
      if (on_hand === undefined) throw new Error("Missing explicit fixture stock");
      seed.product_variants.push({
        id, product_id, sku: `DEMO-${String(number).padStart(2, "0")}-${color_key.toUpperCase()}-${size}`, color_key,
        color_label: colors[color_key][0], color_hex: colors[color_key][1], size,
        price_paise: number === 12 && color_key === "stone" ? 179900 : definition.price,
        compare_at_paise: null, tax_category_key: null, unit_weight_g: definition.weight, enabled: true, ...version,
      });
      seed.inventory.push({ variant_id: id, on_hand, reserved: 0, ...version });
    }));
    const views = number === 15 ? ["front"] : ["front", "alternate"];
    views.forEach((view, sort_order) => {
      const media_id = fixtureId(`media:${number}:${view}`);
      const public_key = `fixtures/catalog/p${String(number).padStart(2, "0")}-${view}.png`;
      const metadata = fixtureImageMetadata[view as keyof typeof fixtureImageMetadata];
      seed.media_assets.push({
        id: media_id, stage_key: `fixture-only/${public_key}`, public_key, type: "image", status: "published", content_type: "image/png",
        size_bytes: metadata.sizeBytes, width: 600, height: 800, duration_seconds: null, poster_media_id: null, checksum: metadata.sha256,
        alt: `Neutral demo placeholder for ${definition.title}; approved product photography required.`, focal_x: 0.5, focal_y: 0.5,
        source_details: { creator: "Project fixture generator", source: "scripts/build-fixture-placeholders.py", usage: "Development preview only", replacement_status: "Required before launch" },
        license_details: { license: "Original project-generated placeholder", attribution: "No external asset" },
        uploaded_by: null, last_error: null, ...version,
      });
      seed.product_media.push({ product_id, media_id, color_key: null, sort_order, is_cover: sort_order === 0 });
    });
  });
  fixtureCollectionMemberships.forEach(([slug, title, numbers], sort_order) => {
    const collection_id = fixtureId(`collection:${slug}`);
    seed.collections.push({ id: collection_id, slug, title, description: "Demo merchandising collection for fixture preview.", cover_media_id: null, active: true, sort_order, ...version });
    numbers.forEach((number, membershipOrder) => seed.collection_products.push({ collection_id, product_id: fixtureProductId(number), sort_order: membershipOrder }));
  });
  return fixtureCatalogSeedSchema.parse(seed);
}

export const fixtureCatalogSeedRows = createFixtureCatalogSeed();
/** Separate edge fixture; the approved sixteen seed titles remain unchanged. */
export const longTitleDevelopmentProduct = {
  ...fixtureCatalogSeedRows.products[0]!,
  title: "Everyday Oversized Tee — Extended Development Preview Title for Narrow Screens and Two Hundred Percent Zoom",
};
