import "server-only";
import { z } from "zod";
import { readEnvironment } from "../../config/env.ts";
import type { Admin } from "../auth/policy.ts";
import { catalogUuidSchema } from "../validation/catalog.ts";
import { adminRpc, AdminDatabaseError } from "./db.ts";
import { createProductSchema, updateProductSchema, replaceVariantsSchema, productPackagingSchema, saveSizeGuideSchema, adjustInventorySchema, versionSchema,
  type AdminCatalogSnapshot, type AdminProduct, type AdminSizeGuide } from "./contracts.ts";

function validated<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const fieldErrors: Record<string,string[]> = {};
    for (const issue of result.error.issues) (fieldErrors[issue.path.join(".") || "form"] ??= []).push(issue.message);
    throw new AdminDatabaseError("INVALID_PAYLOAD", { fieldErrors });
  }
  return result.data;
}
const identity = (actor: Admin) => validated(catalogUuidSchema, actor.id);
const productId = (id: string) => validated(catalogUuidSchema,id);
const mode = () => readEnvironment().APP_MODE;
export type CatalogRpc = <T = unknown>(name: string,args: Record<string,unknown>) => Promise<T>;
export type PromoteProduct = (actor: Admin,id: string,version: number) => Promise<void>;

/** Call only with the verified requireAdmin() result; each SQL RPC also checks membership. */
export function createAdminCatalogService(rpc: CatalogRpc = adminRpc, promote: PromoteProduct = async (actor,id,version) => {
  const { promoteProductMedia } = await import("../media/service.ts");
  await promoteProductMedia(actor,id,version);
}) {
  return {
    getCatalogAdmin(actor: Admin) {
      return rpc<AdminCatalogSnapshot>("admin_catalog", { p_actor: identity(actor), p_mode: mode() });
    },
    getProductAdmin(actor: Admin,id: string) {
      return rpc<AdminProduct>("admin_get_product", { p_actor: identity(actor),p_id: productId(id),p_mode: mode() });
    },
    createProduct(actor: Admin,input: unknown) {
      return rpc<AdminProduct>("admin_save_product", { p_actor: identity(actor),p_id: null,p_version: null,p_data: validated(createProductSchema,input),p_mode: mode() });
    },
    updateProduct(actor: Admin,id: string,input: unknown) {
      const { version,...data } = validated(updateProductSchema,input);
      return rpc<AdminProduct>("admin_save_product", { p_actor: identity(actor),p_id: productId(id),p_version: version,p_data: data,p_mode: mode() });
    },
    replaceVariants(actor: Admin,id: string,input: unknown) {
      const data = validated(replaceVariantsSchema,input);
      return rpc<AdminProduct>("admin_replace_variants", { p_actor: identity(actor),p_id: productId(id),p_version: data.version,p_variants: data.variants,p_mode: mode() });
    },
    setProductPackaging(actor: Admin,id: string,input: unknown) {
      const data = validated(productPackagingSchema,input);
      return rpc<AdminProduct>("admin_set_product_packaging", { p_actor: identity(actor),p_id: productId(id),p_version: data.version,p_preset_ids: data.presetIds,p_mode: mode() });
    },
    saveSizeGuide(actor: Admin,input: unknown) {
      const { id,version,...data } = validated(saveSizeGuideSchema,input);
      return rpc<AdminSizeGuide>("admin_save_size_guide", { p_actor: identity(actor),p_id: id ?? null,p_version: version ?? null,p_data: data });
    },
    adjustInventory(actor: Admin,input: unknown) {
      const data = validated(adjustInventorySchema,input);
      return rpc<{ movementId: string; replayed: boolean }>("admin_adjust_inventory", { p_actor: identity(actor),p_variant_id: data.variantId,p_delta: data.delta,p_expected_version: data.expectedVersion,p_reason: data.reason,p_operation_key: data.operationKey });
    },
    async publishProduct(actor: Admin,id: string,input: unknown) {
      const { version } = validated(versionSchema,input);
      const args = { p_actor: identity(actor),p_id: productId(id),p_mode: mode() };
      const product = await rpc<AdminProduct>("admin_get_product",args);
      if (product.version !== version) throw new AdminDatabaseError("VERSION_CONFLICT", { currentVersion: product.version });
      if (product.publicationMissing.length) throw new AdminDatabaseError("PUBLISH_INCOMPLETE", { fieldErrors: { publication: product.publicationMissing } });
      await promote(actor,id,version);
      return rpc<AdminProduct>("admin_publish_product", { ...args,p_version: version });
    },
    archiveProduct(actor: Admin,id: string,input: unknown) {
      const { version } = validated(versionSchema,input);
      return rpc<AdminProduct>("admin_archive_product", { p_actor: identity(actor),p_id: productId(id),p_version: version,p_mode: mode() });
    },
  };
}
export const { getCatalogAdmin,getProductAdmin,createProduct,updateProduct,replaceVariants,setProductPackaging,saveSizeGuide,adjustInventory,publishProduct,archiveProduct } = createAdminCatalogService();
