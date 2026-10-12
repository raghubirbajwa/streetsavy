import { catalogRepository } from "../../../../lib/catalog/server.ts";
import { publicProductListing } from "../../../../lib/catalog/public-api.ts";
import { catalogResponse } from "../../../../lib/http/catalog.ts";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return catalogResponse(async () => publicProductListing(await (await catalogRepository()).snapshot(), new URL(request.url).searchParams));
}
