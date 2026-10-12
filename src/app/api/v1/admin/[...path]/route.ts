import { requireAdmin } from "../../../../../lib/auth/server.ts";
import { adminResponse, ApiError, readJson } from "../../../../../lib/http/admin.ts";
import { getCatalogAdmin, getProductAdmin, createProduct, updateProduct, replaceVariants, setProductPackaging, saveSizeGuide, adjustInventory, publishProduct, archiveProduct } from "../../../../../lib/admin/catalog.ts";
import { readCollections, mutateCollections, readHomeContent, mutateHomeContent } from "../../../../../lib/admin/content.ts";
import { readSettings, mutateSettings } from "../../../../../lib/admin/settings.ts";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path: string[] }> };
function missing(): never { throw new ApiError(404, "NOT_FOUND", "This endpoint does not exist."); }
export async function GET(_request: Request, ctx: Context) {
  return adminResponse(async () => {
    const { path } = await ctx.params;
    const admin = await requireAdmin(path[0] === "settings");
    if (path.length === 1) {
      switch (path[0]) {
        case "products": return getCatalogAdmin(admin);
        case "collections": return readCollections(admin);
        case "content": return readHomeContent(admin);
        case "settings": return readSettings(admin);
        case "size-guides": return (await getCatalogAdmin(admin)).sizeGuides;
      }
    }
    if (path[0] === "products" && path.length === 2) return getProductAdmin(admin, path[1]!);
    return missing();
  });
}
async function mutate(request: Request, ctx: Context) {
  return adminResponse(async () => {
    const { path } = await ctx.params;
    const admin = await requireAdmin(path[0] === "settings");
    const body = await readJson(request);
    const method = request.method;
    if (path.length === 1 && method === "POST") {
      switch (path[0]) {
        case "products": return createProduct(admin, body);
        case "collections": return mutateCollections(admin, body);
        case "content": return mutateHomeContent(admin, body);
        case "settings": return mutateSettings(admin, body);
        case "size-guides": return saveSizeGuide(admin, body);
      }
    }
    if (path.join("/") === "inventory/adjustments" && method === "POST") return adjustInventory(admin, body);
    if (path[0] === "products" && path[1]) {
      if (path.length === 2 && method === "PATCH") return updateProduct(admin, path[1], body);
      if (path.length === 3) {
        if (path[2] === "variants" && method === "PUT") return replaceVariants(admin, path[1], body);
        if (path[2] === "packaging" && method === "PUT") return setProductPackaging(admin, path[1], body);
        if (path[2] === "publish" && method === "POST") return publishProduct(admin, path[1], body);
        if (path[2] === "archive" && method === "POST") return archiveProduct(admin, path[1], body);
      }
    }
    return missing();
  });
}
export const POST = mutate;
export const PATCH = mutate;
export const PUT = mutate;
