import type { Metadata } from "next";
import Link from "next/link";
import { publishedMedia, storefrontData } from "../../../lib/catalog/storefront.ts";
import { DisplayMedia } from "../../../components/store/display-media.tsx";
import styles from "../../../components/store/catalog.module.css";

export const metadata: Metadata = { title: { absolute: "Collections | YOUR BRAND" }, description: "Find your everyday fit. Explore tees, hoodies, cargos, shirts and accessories." };

export default async function CollectionsPage() {
  const { catalog } = await storefrontData();
  const collections = [...catalog.collections].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  const covers = await publishedMedia(collections.flatMap((row) => row.coverMediaId ? [row.coverMediaId] : []));
  return <main id="main" className="store-container">
    <div className={styles.intro}><nav className={styles.breadcrumb} aria-label="Breadcrumb"><Link href="/">Home</Link><span aria-hidden="true">/</span><span aria-current="page">Collections</span></nav><h1>Find your fit.</h1><p>Easy layers. Relaxed shapes. Explore the edits and make them your own.</p></div>
    <div className={styles.directory}>{collections.map((collection) => {
      const cover = covers.find((media) => media.id === collection.coverMediaId);
      const product = catalog.products.find((row) => row.id === collection.productIds[0]);
      const fallback = product?.media.find((media) => media.type === "image" && media.isCover) ?? product?.media.find((media) => media.type === "image");
      const key = cover ? (cover.type === "image" ? cover.publicKey : cover.posterKey) : fallback?.publicKey;
      return <Link className={styles.collection} href={`/collections/${collection.slug}`} key={collection.id}>
        <div className={styles.collectionImage}>{key ? <DisplayMedia media={{ id: cover?.id ?? fallback!.id, publicKey: key, type: "image", alt: "", width: cover?.width ?? fallback?.width ?? 600, height: cover?.height ?? fallback?.height ?? 800, focalX: cover?.focalX ?? .5, focalY: cover?.focalY ?? .5, posterKey: null }} sizes="(max-width: 350px) 100vw, (max-width: 1023px) 50vw, 33vw" /> : <div className={styles.collectionPlaceholder} aria-hidden="true" />}</div>
        <h2>{collection.title}<span aria-hidden="true">↗</span></h2><p>{collection.productIds.length} {collection.productIds.length === 1 ? "piece" : "pieces"}</p>
      </Link>;
    })}</div>
    {collections.length === 0 && <div className={styles.empty}><h2>Collections are on their way.</h2><p>There are no published collections to show yet.</p><Link href="/">Back to the homepage</Link></div>}
  </main>;
}
