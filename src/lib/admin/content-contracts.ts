import { z } from "zod";

const id = z.string().uuid();
const text = (max: number) => z.string().trim().max(max);
const title = text(120).min(1);
const distinctIds = z.array(id).max(100).refine((ids) => new Set(ids).size === ids.length, "Select each product once.");
export const collectionDraftSchema = z.object({
  title, slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(100), description: text(2000),
  coverMediaId: id.nullable(), productIds: distinctIds, sortOrder: z.number().int().min(0).max(9999), active: z.boolean(),
}).strict();
export type CollectionDraft = z.infer<typeof collectionDraftSchema>;
export const homeDraftSchema = z.object({
  hero: z.object({ eyebrow: text(80), heading: title, body: text(300), ctaLabel: text(60).min(1), collectionId: id.nullable(), mediaId: id.nullable() }).strict(),
  story: z.object({ heading: text(120), body: text(2000) }).strict().default({ heading: "", body: "" }),
  announcement: z.object({ text: text(160), collectionId: id.nullable() }).strict(),
  navigation: z.array(z.object({ label: text(60).min(1), collectionId: id }).strict()).max(8),
  featuredProductIds: distinctIds,
  lookbook: z.array(z.object({ title, mediaId: id, productIds: distinctIds.refine((ids) => ids.length > 0) }).strict()).max(8),
}).strict();
export type HomeDraft = z.infer<typeof homeDraftSchema>;
export const defaultHome: HomeDraft = {
  hero: { eyebrow: "THE EVERYDAY EDIT", heading: "MADE FOR YOUR EVERYDAY.", body: "Relaxed fits. Strong details.", ctaLabel: "Explore the collection", collectionId: null, mediaId: null },
  story: { heading: "", body: "" },
  announcement: { text: "Explore the latest collection.", collectionId: null }, navigation: [], featuredProductIds: [], lookbook: [],
};
export const collectionActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), id: id.nullable(), expectedVersion: z.number().int().nonnegative(), draft: collectionDraftSchema }).strict(),
  z.object({ action: z.literal("publish"), id, expectedVersion: z.number().int().positive() }).strict(),
]);
export const homeActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), expectedVersion: z.number().int().nonnegative(), draft: homeDraftSchema }).strict(),
  z.object({ action: z.literal("publish"), expectedVersion: z.number().int().positive() }).strict(),
]);
const productOption = z.object({ id, title: z.string(), status: z.string() });
const mediaOption = z.object({ id, alt: z.string(), status: z.string() });
export const collectionsStateSchema = z.object({
  collections: z.array(z.object({ id, version: z.number().int(), active: z.boolean(), title: z.string(), draft: collectionDraftSchema })),
  products: z.array(productOption), media: z.array(mediaOption),
});
export type CollectionsState = z.infer<typeof collectionsStateSchema>;
export const homeStateSchema = z.object({
  version: z.number().int(), draft: homeDraftSchema, published: homeDraftSchema.nullable(), publishedAt: z.string().nullable(),
  collections: z.array(z.object({ id, title: z.string(), active: z.boolean() })), products: z.array(productOption), media: z.array(mediaOption),
});
export type HomeState = z.infer<typeof homeStateSchema>;
