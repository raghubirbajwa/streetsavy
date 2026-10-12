import type { Metadata } from "next";
import { storefrontData } from "../../../lib/catalog/storefront.ts";
import { parseCatalogQuery, queryParams } from "../../../lib/catalog/query.ts";
import { CatalogListing } from "../../../components/store/catalog-listing.tsx";

export const metadata: Metadata = { title: { absolute: "Search | YOUR BRAND" }, description: "Find everyday clothing by name, colour or style.", robots: { index: false, follow: false } };

export default async function SearchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [values, { catalog }] = await Promise.all([searchParams, storefrontData()]);
  return <CatalogListing catalog={catalog} query={parseCatalogQuery(queryParams(values), catalog, { search: true })} />;
}
