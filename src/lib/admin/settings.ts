import "server-only";
import { AccessError } from "../auth/policy.ts";
import type { Admin } from "../auth/policy.ts";
import { adminRpc } from "./db.ts";
import { defaultSettings, settingsActionSchema, settingsStateSchema } from "./settings-contracts.ts";
export async function readSettings(actor: Admin) {
  if (actor.role !== "owner") throw new AccessError(403);
  const raw = await adminRpc<Record<string, unknown>>("admin_settings_read", { p_actor: actor.id });
  return settingsStateSchema.parse({ ...raw, value: raw.value ?? defaultSettings });
}
export async function mutateSettings(actor: Admin, input: unknown) {
  if (actor.role !== "owner") throw new AccessError(403);
  const value = settingsActionSchema.parse(input);
  if (value.action === "saveSettings") await adminRpc("admin_save_settings", { p_actor: actor.id, p_expected_version: value.expectedVersion, p_value: value.value });
  else await adminRpc(value.action === "saveWarehouse" ? "admin_save_warehouse" : "admin_save_packaging", { p_actor: actor.id, p_id: value.id, p_expected_version: value.expectedVersion, p_value: value.value });
  return readSettings(actor);
}
