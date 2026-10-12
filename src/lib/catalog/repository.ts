import "server-only";
import { catalogSnapshotSchema, catalogSlugSchema } from "../validation/catalog.ts";
import type { CatalogSnapshot, PublicCategory, PublicCollection, PublicProduct, PublicSizeGuide } from "../validation/catalog.ts";

export interface CatalogRepository {
  snapshot(): Promise<CatalogSnapshot>;
  listCategories(): Promise<PublicCategory[]>;
  listProducts(): Promise<PublicProduct[]>;
  getProduct(slug: string): Promise<PublicProduct | null>;
  listCollections(): Promise<PublicCollection[]>;
  getCollection(slug: string): Promise<PublicCollection | null>;
  listSizeGuides(): Promise<PublicSizeGuide[]>;
}

/** One validated contract for fixture data and the safe Supabase public RPC. */
export function createCatalogRepository(load: CatalogSnapshot | (() => Promise<unknown>)): CatalogRepository {
  const snapshot = async () => catalogSnapshotSchema.parse(typeof load === "function" ? await load() : load);
  return {
    snapshot,
    listCategories: async () => (await snapshot()).categories,
    listProducts: async () => (await snapshot()).products,
    getProduct: async (slug) => catalogSlugSchema.safeParse(slug).success ? (await snapshot()).products.find((row) => row.slug === slug) ?? null : null,
    listCollections: async () => (await snapshot()).collections,
    getCollection: async (slug) => catalogSlugSchema.safeParse(slug).success ? (await snapshot()).collections.find((row) => row.slug === slug) ?? null : null,
    listSizeGuides: async () => (await snapshot()).sizeGuides,
  };
}
