import { z } from "zod";
import { catalogUuidSchema, catalogSlugSchema, publicCategorySchema, publicCollectionSchema, publicMediaSchema, publicProductSchema, publicSizeGuideSchema, moneyPaiseSchema } from "../validation/catalog.ts";
import type { CatalogSnapshot, PublicCollection } from "../validation/catalog.ts";
import { parseCatalogQuery, queryCatalog } from "./query.ts";
import type { CatalogMatch } from "./query.ts";

export const productCardSchema = z.object({
  id: catalogUuidSchema, slug: catalogSlugSchema, title: z.string().min(1), category: publicCategorySchema,
  cover: publicMediaSchema.nullable(),
  colors: z.array(z.object({ colorKey: catalogSlugSchema, colorLabel: z.string().min(1), colorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable(), available: z.boolean() }).strict()),
  fromPricePaise: moneyPaiseSchema, hasPriceRange: z.boolean(), availability: z.enum(["in_stock", "sold_out"]),
  matchingVariantIds: z.array(catalogUuidSchema).min(1),
}).strict();
export const productListingSchema = z.object({ items: z.array(productCardSchema).max(12), total: z.number().int().nonnegative(), page: z.number().int().positive(), pageSize: z.literal(12), totalPages: z.number().int().positive() }).strict();
export const productDetailSchema = publicProductSchema.extend({ category: publicCategorySchema, guide: publicSizeGuideSchema.nullable() }).strict();
const productReferenceSchema = z.object({ id: catalogUuidSchema, slug: catalogSlugSchema, title: z.string().min(1) }).strict();
export const collectionDetailSchema = publicCollectionSchema.extend({ products: z.array(productReferenceSchema) }).strict();

function productCard(catalog: CatalogSnapshot, row: CatalogMatch) {
  const { product, matchingVariants } = row;
  const colors = [...new Set(matchingVariants.map((variant) => variant.colorKey))].map((key) => {
    const variants = matchingVariants.filter((variant) => variant.colorKey === key);
    const first = variants[0]!;
    return { colorKey: key, colorLabel: first.colorLabel, colorHex: first.colorHex, available: variants.some((variant) => variant.available) };
  });
  const firstColor = colors[0]?.colorKey;
  const images = product.media.filter((media) => media.type === "image" && (media.colorKey === firstColor || media.colorKey === null));
  const cover = images.find((media) => media.colorKey === firstColor && media.isCover) ?? images.find((media) => media.colorKey === firstColor) ?? images.find((media) => media.isCover) ?? images[0] ?? null;
  return productCardSchema.parse({
    id: product.id, slug: product.slug, title: product.title, category: catalog.categories.find((row) => row.id === product.categoryId), cover, colors,
    fromPricePaise: row.minPricePaise, hasPriceRange: row.minPricePaise !== row.maxPricePaise,
    availability: matchingVariants.some((variant) => variant.available) ? "in_stock" : "sold_out", matchingVariantIds: matchingVariants.map((variant) => variant.id),
  });
}

export function publicProductListing(catalog: CatalogSnapshot, params: URLSearchParams) {
  const query = parseCatalogQuery(params, catalog, { search: true });
  const result = queryCatalog(catalog, query);
  return { data: productListingSchema.parse({ items: result.rows.map((row) => productCard(catalog, row)), total: result.total, page: result.page, pageSize: 12, totalPages: result.pageCount }), notices: result.notices };
}

export function publicProductDetail(catalog: CatalogSnapshot, slug: string) {
  if (!catalogSlugSchema.safeParse(slug).success) return null;
  const product = catalog.products.find((row) => row.slug === slug);
  if (!product) return null;
  return productDetailSchema.parse({ ...product, category: catalog.categories.find((row) => row.id === product.categoryId), guide: catalog.sizeGuides.find((row) => row.id === product.sizeGuideId) ?? null });
}

export function publicCollectionDetail(catalog: CatalogSnapshot, collection: PublicCollection) {
  const products = collection.productIds.flatMap((id) => {
    const product = catalog.products.find((row) => row.id === id);
    return product ? [{ id: product.id, slug: product.slug, title: product.title }] : [];
  });
  return collectionDetailSchema.parse({ ...collection, products });
}
