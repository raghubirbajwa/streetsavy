import "server-only";
import type { Admin } from "../auth/policy.ts";
import { adminRpc, AdminDatabaseError } from "./db.ts";
import { promoteMediaIds } from "../media/service.ts";
import { collectionActionSchema, collectionsStateSchema, defaultHome, homeActionSchema, homeStateSchema } from "./content-contracts.ts";
export async function readCollections(actor: Admin) {
  return collectionsStateSchema.parse(await adminRpc("admin_collections_read", { p_actor: actor.id }));
}
export async function mutateCollections(actor: Admin, input: unknown) {
  const value = collectionActionSchema.parse(input);
  if (value.action === "save") await adminRpc("admin_save_collection", { p_actor: actor.id, p_id: value.id, p_expected_version: value.expectedVersion, p_draft: value.draft });
  else {
    const collection = (await readCollections(actor)).collections.find(row => row.id === value.id);
    if (!collection) throw new AdminDatabaseError("NOT_FOUND");
    if (collection.version !== value.expectedVersion) throw new AdminDatabaseError("VERSION_CONFLICT", { currentVersion: collection.version });
    if (collection.draft.active && collection.draft.coverMediaId) await promoteMediaIds(actor, [collection.draft.coverMediaId]);
    await adminRpc("admin_publish_collection", { p_actor: actor.id, p_id: value.id, p_expected_version: value.expectedVersion });
  }
  return readCollections(actor);
}
export async function readHomeContent(actor: Admin) {
  const raw = await adminRpc<Record<string, unknown>>("admin_content_read", { p_actor: actor.id });
  return homeStateSchema.parse({ ...raw, draft: raw.draft ?? defaultHome });
}
export async function mutateHomeContent(actor: Admin, input: unknown) {
  const value = homeActionSchema.parse(input);
  if (value.action === "save") await adminRpc("admin_save_content", { p_actor: actor.id, p_expected_version: value.expectedVersion, p_draft: value.draft });
  else {
    const content = await readHomeContent(actor);
    if (content.version !== value.expectedVersion) throw new AdminDatabaseError("VERSION_CONFLICT", { currentVersion: content.version });
    const ids = [content.draft.hero.mediaId, ...content.draft.lookbook.map(look => look.mediaId)].filter((id): id is string => id !== null);
    await promoteMediaIds(actor, ids);
    await adminRpc("admin_publish_content", { p_actor: actor.id, p_expected_version: value.expectedVersion });
  }
  return readHomeContent(actor);
}
