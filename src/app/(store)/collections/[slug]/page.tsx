import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { storefrontData } from "../../../../lib/catalog/storefront.ts";
import { parseCatalogQuery, queryParams } from "../../../../lib/catalog/query.ts";
import { CatalogListing } from "../../../../components/store/catalog-listing.tsx";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const { catalog } = await storefrontData();
  const collection = catalog.collections.find((row) => row.slug === slug);
  if (!collection) return { title: { absolute: "Collection not found | YOUR BRAND" }, robots: { index: false, follow: false } };
  return { title: { absolute: `${collection.title} | YOUR BRAND` }, description: collection.description, alternates: { canonical: `/collections/${collection.slug}` } };
}

export default async function CollectionPage({ params, searchParams }: Props) {
  const [{ slug }, values, { catalog }] = await Promise.all([params, searchParams, storefrontData()]);
  const collection = catalog.collections.find((row) => row.slug === slug);
  if (!collection) notFound();
  return <CatalogListing catalog={catalog} collection={collection} query={parseCatalogQuery(queryParams(values), catalog)} />;
}
