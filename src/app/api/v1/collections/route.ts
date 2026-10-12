import { catalogRepository } from "../../../../lib/catalog/server.ts";
import { publicCollectionDetail } from "../../../../lib/catalog/public-api.ts";
import { catalogResponse } from "../../../../lib/http/catalog.ts";
export const dynamic = "force-dynamic";
export async function GET() {
  return catalogResponse(async () => {
    const catalog = await (await catalogRepository()).snapshot();
    return { data: { items: [...catalog.collections].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)).map((collection) => publicCollectionDetail(catalog, collection)) } };
  });
}
