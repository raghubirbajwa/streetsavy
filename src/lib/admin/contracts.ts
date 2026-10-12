import { z } from "zod";
import { catalogUuidSchema, catalogSlugSchema, clothingSizeSchema, moneyPaiseSchema, sizeGuideValuesSchema } from "../validation/catalog.ts";

export type AdminCategory = { id: string; slug: string; name: string; sortOrder: number; active: boolean; version: number };
export type AdminSizeGuide = { id: string; title: string; measurementType: "garment" | "body"; instructions: string; valuesCm: z.infer<typeof sizeGuideValuesSchema>; isDemo: boolean; version: number };
export type AdminPackagingPreset = { id: string; label: string; lengthCm: number; widthCm: number; heightCm: number; tareWeightG: number; maxContentsWeightG: number; maxItems: number; priority: number; active: boolean; version: number };
export type AdminVariant = {
  id: string; sku: string; colorKey: string; colorLabel: string; colorHex: string | null; size: z.infer<typeof clothingSizeSchema>;
  pricePaise: number; compareAtPaise: number | null; taxCategoryKey: string | null; unitWeightG: number; enabled: boolean; version: number;
  inventory: { onHand: number; reserved: number; available: number; version: number };
};
export type AdminProductMedia = {
  id: string; type: "image" | "video"; status: "uploading" | "validating" | "ready" | "publishing" | "published" | "rejected" | "deleting";
  contentType: string; width: number | null; height: number | null; alt: string; colorKey: string | null; sortOrder: number; isCover: boolean; version: number;
};
export type AdminInventoryMovement = { id: string; variantId: string; kind: "receive" | "adjust" | "sale" | "restock"; delta: number; reason: string; actorUserId: string | null; operationKey: string; createdAt: string };
export type AdminProduct = {
  id: string; slug: string; title: string; description: string; categoryId: string; tags: string[]; status: "draft" | "published" | "archived";
  fit: string; material: string | null; care: string[]; sizeGuideId: string | null; featuredRank: number; publishedAt: string | null; isDemo: boolean; version: number;
  variants: AdminVariant[]; media: AdminProductMedia[]; packagingPresetIds: string[]; publicationMissing: string[]; inventoryMovements: AdminInventoryMovement[];
};
export type AdminCatalogSnapshot = { products: AdminProduct[]; categories: AdminCategory[]; sizeGuides: AdminSizeGuide[]; packagingPresets: AdminPackagingPreset[] };

const positiveVersion = z.number().int().min(1).max(2147483647);
const text = z.string().trim().min(1).max(200);
const fields = {
  title: text, slug: catalogSlugSchema.max(120), description: z.string().trim().max(10000).default(""), categoryId: catalogUuidSchema,
  tags: z.array(z.string().trim().min(1).max(60)).max(30).default([]), fit: text.default("regular"), material: z.string().trim().max(1000).nullable().default(null),
  care: z.array(z.string().trim().min(1).max(500)).max(30).default([]), sizeGuideId: catalogUuidSchema.nullable().default(null),
  featuredRank: z.number().int().min(0).max(2147483647).default(0),
};
export const createProductSchema = z.object(fields).strict();
export const updateProductSchema = z.object({ version: positiveVersion, ...fields }).strict();
export const variantInputSchema = z.object({
  id: catalogUuidSchema.optional(), sku: z.string().trim().min(1).max(100), colorKey: catalogSlugSchema.max(60), colorLabel: text,
  colorHex: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable().default(null), size: clothingSizeSchema,
  pricePaise: moneyPaiseSchema, compareAtPaise: moneyPaiseSchema.nullable().default(null), taxCategoryKey: z.string().trim().min(1).max(60).nullable().default(null),
  unitWeightG: z.number().int().positive().max(1000000), enabled: z.boolean(),
}).strict().refine((v) => v.compareAtPaise === null || v.compareAtPaise > v.pricePaise, { path: ["compareAtPaise"], message: "Compare-at must exceed the price." });
export const replaceVariantsSchema = z.object({ version: positiveVersion, variants: z.array(variantInputSchema).max(200) }).strict().superRefine((input, ctx) => {
  for (const selector of [(v: z.infer<typeof variantInputSchema>) => v.sku, (v: z.infer<typeof variantInputSchema>) => `${v.colorKey}:${v.size}`, (v: z.infer<typeof variantInputSchema>) => v.id]) {
    const keys = input.variants.map(selector).filter((key) => key !== undefined);
    if (new Set(keys).size !== keys.length) ctx.addIssue({ code: "custom", path: ["variants"], message: "Variant IDs, SKUs and colour/size pairs must be unique." });
  }
});
export const versionSchema = z.object({ version: positiveVersion }).strict();
export const productPackagingSchema = z.object({ version: positiveVersion, presetIds: z.array(catalogUuidSchema).max(50) }).strict().refine((v) => new Set(v.presetIds).size === v.presetIds.length, { path: ["presetIds"], message: "Duplicate packaging preset." });
export const saveSizeGuideSchema = z.object({ id: catalogUuidSchema.optional(), version: positiveVersion.optional(), title: text, measurementType: z.enum(["garment", "body"]), instructions: z.string().trim().min(1).max(5000), valuesCm: sizeGuideValuesSchema, isDemo: z.boolean() }).strict().refine((v) => Boolean(v.id) === Boolean(v.version), { path: ["version"], message: "Existing size guides require a version." });
export const adjustInventorySchema = z.object({ variantId: catalogUuidSchema, delta: z.number().int().min(-2147483647).max(2147483647).refine((v) => v !== 0), expectedVersion: positiveVersion, reason: z.string().trim().min(1).max(500), operationKey: z.string().min(1).max(150) }).strict();
