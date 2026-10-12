import "server-only";
import type { AppMode } from "../../config/env.ts";
import { createFixtureCatalogSeed } from "./catalog.ts";

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const literal = (value: unknown): string => {
  if (value === null) return "null";
  if (typeof value === "string") return quote(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) return `array[${value.map((entry) => quote(String(entry))).join(",")}]::text[]`;
  return `${quote(JSON.stringify(value))}::jsonb`;
};

/** Emits SQL only. It never opens a connection, changes APP_MODE, or resets stock. */
export function createFixtureSeedSql(mode: AppMode): string {
  if (mode !== "fixture" && mode !== "test") throw new Error("FIXTURE_SEED_FORBIDDEN_IN_LIVE");
  const seed = createFixtureCatalogSeed();
  const lines = [
    "-- Deterministic demo catalog. Apply only to a fresh isolated test database.",
    "-- Deliberately not an automatic migration or app startup operation.",
    "begin;", "set local standard_conforming_strings = on;",
    "do $$ begin",
    "  if coalesce(current_setting('app.environment', true), '') not in ('fixture', 'test') then",
    "    raise exception 'FIXTURE_SEED_REQUIRES_ISOLATED_TEST_DATABASE';",
    "  end if;",
    "  if exists(select 1 from public.products) or exists(select 1 from public.orders) then",
    "    raise exception 'FIXTURE_SEED_REQUIRES_EMPTY_CATALOG_AND_ORDERS';",
    "  end if;", "end $$;",
  ];
  const tables = ["categories", "size_guides", "products", "product_variants", "inventory", "media_assets", "product_media", "collections", "collection_products"] as const;
  for (const table of tables) {
    const rows = seed[table] as unknown as Record<string, unknown>[];
    if (!rows.length) continue;
    const columns = Object.keys(rows[0]!);
    lines.push(`insert into public.${table} (${columns.join(", ")}) values`, rows.map((row) => `(${columns.map((column) => literal(row[column])).join(", ")})`).join(",\n") + ";");
  }
  lines.push("commit;", "");
  return lines.join("\n");
}
