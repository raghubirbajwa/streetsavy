import "server-only";
import { fixtureCatalogSeedSchema } from "../../data/fixtures/catalog.ts";
import type { FixtureCatalogSeed } from "../../data/fixtures/catalog.ts";
import { catalogSnapshotSchema } from "../validation/catalog.ts";
import type { CatalogSnapshot } from "../validation/catalog.ts";

const compareId = (left: { id: string }, right: { id: string }) => left.id.localeCompare(right.id, "en");

/** Fixture equivalent of public_catalog(): enumerate every public field explicitly. */
export function projectPublicCatalog(source: FixtureCatalogSeed): CatalogSnapshot {
  const seed = fixtureCatalogSeedSchema.parse(source);
  const categories = seed.categories.filter((row) => row.active).sort((a, b) => a.sort_order - b.sort_order || compareId(a, b));
  const categoryIds = new Set(categories.map((row) => row.id));
  const products = seed.products.filter((row) => row.status === "published" && categoryIds.has(row.category_id)).sort((a, b) => a.featured_rank - b.featured_rank || compareId(a, b));
  const productIds = new Set(products.map((row) => row.id));
  const mediaById = new Map(seed.media_assets.filter((row) => row.status === "published" && row.public_key !== null).map((row) => [row.id, row]));
  const inventoryById = new Map(seed.inventory.map((row) => [row.variant_id, row]));
  const guides = new Set(products.map((row) => row.size_guide_id).filter((id) => id !== null));
  return catalogSnapshotSchema.parse({
    categories: categories.map((row) => ({ id: row.id, slug: row.slug, name: row.name, sortOrder: row.sort_order })),
    products: products.map((row) => ({
      id: row.id, slug: row.slug, title: row.title, description: row.description, categoryId: row.category_id, tags: row.tags,
      fit: row.fit, material: row.material, care: row.care, sizeGuideId: row.size_guide_id, featuredRank: row.featured_rank, publishedAt: row.published_at, isDemo: row.is_demo,
      variants: seed.product_variants.filter((variant) => variant.product_id === row.id && variant.enabled)
        .sort((a, b) => a.color_key.localeCompare(b.color_key, "en") || a.size.localeCompare(b.size, "en") || compareId(a, b))
        .map((variant) => {
          const inventory = inventoryById.get(variant.id);
          return { id: variant.id, colorKey: variant.color_key, colorLabel: variant.color_label, colorHex: variant.color_hex,
            size: variant.size, pricePaise: variant.price_paise, compareAtPaise: variant.compare_at_paise,
            available: inventory !== undefined && inventory.on_hand > inventory.reserved };
        }),
      media: seed.product_media.filter((link) => link.product_id === row.id && mediaById.has(link.media_id))
        .sort((a, b) => a.sort_order - b.sort_order || a.media_id.localeCompare(b.media_id, "en"))
        .map((link) => {
          const media = mediaById.get(link.media_id)!;
          return { id: media.id, publicKey: media.public_key, type: media.type, contentType: media.content_type,
            width: media.width, height: media.height, alt: media.alt, colorKey: link.color_key, sortOrder: link.sort_order, isCover: link.is_cover };
        }),
    })),
    collections: seed.collections.filter((row) => row.active).sort((a, b) => a.sort_order - b.sort_order || compareId(a, b)).map((row) => ({
      id: row.id, slug: row.slug, title: row.title, description: row.description,
      coverMediaId: row.cover_media_id !== null && mediaById.has(row.cover_media_id) ? row.cover_media_id : null,
      sortOrder: row.sort_order,
      productIds: seed.collection_products.filter((link) => link.collection_id === row.id && productIds.has(link.product_id))
        .sort((a, b) => a.sort_order - b.sort_order || a.product_id.localeCompare(b.product_id, "en")).map((link) => link.product_id),
    })),
    sizeGuides: seed.size_guides.filter((row) => guides.has(row.id)).sort(compareId).map((row) => ({
      id: row.id, title: row.title, measurementType: row.measurement_type, instructions: row.instructions, valuesCm: row.values_cm, isDemo: row.is_demo,
    })),
  });
}
