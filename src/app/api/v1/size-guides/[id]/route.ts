import { catalogRepository } from "../../../../../lib/catalog/server.ts";
import { catalogUuidSchema, publicSizeGuideSchema } from "../../../../../lib/validation/catalog.ts";
import { catalogResponse, CatalogNotFound } from "../../../../../lib/http/catalog.ts";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return catalogResponse(async () => {
    const { id } = await context.params;
    if (!catalogUuidSchema.safeParse(id).success) throw new CatalogNotFound();
    const guides = await (await catalogRepository()).listSizeGuides();
    const guide = guides.find((row) => row.id === id);
    if (!guide) throw new CatalogNotFound();
    return { data: publicSizeGuideSchema.parse(guide) };
  });
}
