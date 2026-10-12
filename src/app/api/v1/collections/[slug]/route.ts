import { catalogRepository } from "../../../../../lib/catalog/server.ts";
import { publicCollectionDetail } from "../../../../../lib/catalog/public-api.ts";
import { catalogResponse, CatalogNotFound } from "../../../../../lib/http/catalog.ts";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  return catalogResponse(async () => {
    const { slug } = await context.params;
    const catalog = await (await catalogRepository()).snapshot();
    const collection = catalog.collections.find((row) => row.slug === slug);
    if (!collection) throw new CatalogNotFound();
    return { data: publicCollectionDetail(catalog, collection) };
  });
}
