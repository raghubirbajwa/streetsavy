import { redirect } from "next/navigation";
import { requireAdmin } from "../../../../lib/auth/server.ts";
import { AccessError } from "../../../../lib/auth/policy.ts";
import { readSettings } from "../../../../lib/admin/settings.ts";
import SettingsEditor from "./editor.tsx";
export const dynamic = "force-dynamic";
export default async function SettingsPage() {
  let actor;
  try { actor = await requireAdmin(true); } catch (error) { if (error instanceof AccessError) redirect(error.status===401 ? "/admin/login" : "/admin/no-access"); throw error; }
  return <main id="main" className="overview"><header className="page-heading"><p className="eyebrow">Owner workspace</p><h1>Store settings</h1><p>Configure fulfillment and approved business policies. Changes apply to future activity and are audited.</p></header><SettingsEditor initial={await readSettings(actor)} /></main>;
}
