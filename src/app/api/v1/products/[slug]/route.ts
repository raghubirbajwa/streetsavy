import { catalogRepository } from "../../../../../lib/catalog/server.ts";
import { publicProductDetail } from "../../../../../lib/catalog/public-api.ts";
import { catalogResponse, CatalogNotFound } from "../../../../../lib/http/catalog.ts";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, ctx: { params: Promise<{slug:string}> }) {
  return catalogResponse(async () => {
    const product = publicProductDetail(await (await catalogRepository()).snapshot(), (await ctx.params).slug);
    if (!product) throw new CatalogNotFound();
    return { data: product };
  });
}
