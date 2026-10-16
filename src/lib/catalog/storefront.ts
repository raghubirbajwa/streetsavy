import "server-only";
import { cache } from "react";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { readEnvironment, integrationConfig } from "../../config/env.ts";
import type { Database } from "../supabase/database.types.ts";
import { catalogRepository } from "./server.ts";
import { readPublicContent } from "./content.ts";
import { homeDraftSchema, defaultHome } from "../admin/content-contracts.ts";

export const publicDisplayMediaSchema = z.object({
  id: z.string().uuid(), publicKey: z.string().min(1), type: z.enum(["image", "video"]),
  width: z.number().int().positive(), height: z.number().int().positive(), alt: z.string(),
  focalX: z.number().min(0).max(1), focalY: z.number().min(0).max(1), posterKey: z.string().nullable(),
}).strict();
export type PublicDisplayMedia = z.infer<typeof publicDisplayMediaSchema>;
export async function publishedMedia(ids: string[]): Promise<PublicDisplayMedia[]> {
  const selected = z.array(z.string().uuid()).parse([...new Set(ids)]);
  if (!selected.length) return [];
  if (selected.length > 50) {
    const result: PublicDisplayMedia[] = [];
    for (let offset = 0; offset < selected.length; offset += 50) result.push(...await publishedMedia(selected.slice(offset, offset + 50)));
    return result;
  }
  if (readEnvironment().APP_MODE === "fixture") {
    const { adminRpc } = await import("../admin/db.ts");
    return z.array(publicDisplayMediaSchema).parse(await adminRpc("public_media_details", { p_ids: selected }));
  }
  const config = integrationConfig("supabase");
  const client = createClient<Database>(config.NEXT_PUBLIC_SUPABASE_URL, config.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (url, options) => fetch(url, { ...options, cache: "no-store" }) },
  });
  const { data, error } = await client.rpc("public_media_details", { p_ids: selected });
  if (error) throw new Error("Media is temporarily unavailable.");
  return z.array(publicDisplayMediaSchema).parse(data);
}

/** Skip published metadata when bytes are missing so the storefront can fall back cleanly. */
export async function publicMediaIfAvailable(media: PublicDisplayMedia | undefined): Promise<PublicDisplayMedia | undefined> {
  if (!media) return undefined;
  try {
    const { getMediaService } = await import("../media/service.ts");
    await (await getMediaService()).publicFile(media.publicKey);
    return media;
  } catch {
    return undefined;
  }
}

export const storefrontData = cache(async () => {
  const [catalog, rawHome] = await Promise.all([(await catalogRepository()).snapshot(), readPublicContent("public_home_content")]);
  const mode = readEnvironment().APP_MODE;
  const home = rawHome === null ? (mode === "fixture" ? homeDraftSchema.parse({
    ...defaultHome,
    hero: { ...defaultHome.hero, collectionId: catalog.collections.find((c) => c.slug === "everyday-uniform")?.id ?? null },
    announcement: { ...defaultHome.announcement, collectionId: catalog.collections.find((c) => c.slug === "new-arrivals")?.id ?? null },
    story: { heading: "THE EVERYDAY UNIFORM", body: "Easy layers, relaxed shapes and pieces that work together." },
    featuredProductIds: catalog.collections.find((c) => c.slug === "featured")?.productIds ?? [],
  }) : null) : homeDraftSchema.parse(rawHome);
  return { catalog, home, mode };
});

const settingsSchema = z.object({
  shippingMode: z.enum(["flat", "free_above", "provider"]), shippingFeePaise: z.number().int().nonnegative(),
  freeShippingThresholdPaise: z.number().int().nonnegative(), taxInclusive: z.literal(true),
  policies: z.object({ returnWindowDays: z.number().int(), shipping: z.string(), returns: z.string(), privacy: z.string(), terms: z.string() }).nullable(),
  contact: z.object({ email: z.string(), phone: z.string() }).nullable(),
}).strict();
export const publicStoreSettings = cache(async () => {
  const raw = await readPublicContent("public_store_settings");
  return raw === null ? null : settingsSchema.parse(raw);
});
