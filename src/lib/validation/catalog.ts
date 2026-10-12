import { z } from "zod";

export const catalogUuidSchema = z.string().uuid();
export const catalogSlugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const clothingSizeSchema = z.enum(["XS", "S", "M", "L", "XL", "XXL", "ONE_SIZE"]);
export const moneyPaiseSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const position = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const publicKey = z.string().min(1).refine((key) =>
  !key.startsWith("/") && !key.includes("..") && !/[\\\\?#]/.test(key), "Invalid public object key");

export const publicCategorySchema = z.object({
  id: catalogUuidSchema, slug: catalogSlugSchema, name: z.string().min(1), sortOrder: position,
}).strict();

export const publicVariantSchema = z.object({
  id: catalogUuidSchema,
  colorKey: catalogSlugSchema,
  colorLabel: z.string().min(1),
  colorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable(),
  size: clothingSizeSchema,
  pricePaise: moneyPaiseSchema,
  compareAtPaise: moneyPaiseSchema.nullable(),
  available: z.boolean(),
}).strict().refine((variant) => variant.compareAtPaise === null || variant.compareAtPaise > variant.pricePaise,
  { message: "Compare-at amount must exceed price", path: ["compareAtPaise"] });

export const publicMediaSchema = z.object({
  id: catalogUuidSchema,
  publicKey,
  type: z.enum(["image", "video"]),
  contentType: z.enum(["image/jpeg", "image/png", "image/webp", "image/avif", "video/mp4"]),
  width: z.number().int().positive(), height: z.number().int().positive(),
  alt: z.string().min(1), colorKey: catalogSlugSchema.nullable(),
  sortOrder: position, isCover: z.boolean(),
}).strict();

export const sizeGuideValuesSchema = z.object({
  columns: z.array(z.object({ key: catalogSlugSchema, label: z.string().min(1) }).strict()).min(1),
  rows: z.array(z.object({ size: clothingSizeSchema, values: z.record(z.number().positive().finite()) }).strict()).min(1),
}).strict().superRefine((guide, ctx) => {
  const columns = guide.columns.map((column) => column.key);
  if (new Set(columns).size !== columns.length) ctx.addIssue({ code: "custom", path: ["columns"], message: "Duplicate measurement column" });
  if (new Set(guide.rows.map((row) => row.size)).size !== guide.rows.length) ctx.addIssue({ code: "custom", path: ["rows"], message: "Duplicate size row" });
  guide.rows.forEach((row, index) => {
    if (Object.keys(row.values).length !== columns.length || columns.some((key) => !(key in row.values))) {
      ctx.addIssue({ code: "custom", path: ["rows", index, "values"], message: "Values must match the measurement columns" });
    }
  });
});

export const publicSizeGuideSchema = z.object({
  id: catalogUuidSchema, title: z.string().min(1), measurementType: z.enum(["garment", "body"]),
  instructions: z.string().min(1), valuesCm: sizeGuideValuesSchema, isDemo: z.boolean(),
}).strict();

export const publicProductSchema = z.object({
  id: catalogUuidSchema, slug: catalogSlugSchema, title: z.string().min(1), description: z.string(),
  categoryId: catalogUuidSchema, tags: z.array(z.string().min(1)), fit: z.string().min(1),
  material: z.string().nullable(), care: z.array(z.string()), sizeGuideId: catalogUuidSchema.nullable(),
  featuredRank: position, publishedAt: z.string().datetime({ offset: true }).transform((value) => new Date(value).toISOString()), isDemo: z.boolean(),
  variants: z.array(publicVariantSchema), media: z.array(publicMediaSchema),
}).strict();

export const publicCollectionSchema = z.object({
  id: catalogUuidSchema, slug: catalogSlugSchema, title: z.string().min(1), description: z.string(),
  coverMediaId: catalogUuidSchema.nullable(), sortOrder: position, productIds: z.array(catalogUuidSchema),
}).strict();

/** Strict allowlist: a leaked private field is rejected instead of silently shipped. */
export const catalogSnapshotSchema = z.object({
  categories: z.array(publicCategorySchema), products: z.array(publicProductSchema),
  collections: z.array(publicCollectionSchema), sizeGuides: z.array(publicSizeGuideSchema),
}).strict().superRefine((catalog, ctx) => {
  for (const key of ["categories", "products", "collections", "sizeGuides"] as const) {
    const ids = catalog[key].map((row) => row.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", path: [key], message: "Duplicate identifier" });
  }
  const categories = new Set(catalog.categories.map((row) => row.id));
  const products = new Set(catalog.products.map((row) => row.id));
  const guides = new Set(catalog.sizeGuides.map((row) => row.id));
  const variants = new Set<string>();
  catalog.products.forEach((product, index) => {
    if (!categories.has(product.categoryId)) ctx.addIssue({ code: "custom", path: ["products", index, "categoryId"], message: "Unknown category" });
    if (product.sizeGuideId !== null && !guides.has(product.sizeGuideId)) ctx.addIssue({ code: "custom", path: ["products", index, "sizeGuideId"], message: "Unknown size guide" });
    const combinations = new Set<string>();
    product.variants.forEach((variant, variantIndex) => {
      const combination = `${variant.colorKey}:${variant.size}`;
      if (variants.has(variant.id) || combinations.has(combination)) ctx.addIssue({ code: "custom", path: ["products", index, "variants", variantIndex], message: "Duplicate variant" });
      variants.add(variant.id); combinations.add(combination);
    });
  });
  catalog.collections.forEach((collection, index) => {
    if (new Set(collection.productIds).size !== collection.productIds.length || collection.productIds.some((id) => !products.has(id))) {
      ctx.addIssue({ code: "custom", path: ["collections", index, "productIds"], message: "Duplicate or nonpublic collection product" });
    }
  });
});

export type PublicCategory = z.infer<typeof publicCategorySchema>;
export type PublicProduct = z.infer<typeof publicProductSchema>;
export type PublicCollection = z.infer<typeof publicCollectionSchema>;
export type PublicSizeGuide = z.infer<typeof publicSizeGuideSchema>;
export type CatalogSnapshot = z.infer<typeof catalogSnapshotSchema>;
