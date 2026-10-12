"use client";
import Image from "next/image";
import { useState } from "react";
import type { PublicDisplayMedia } from "../../lib/catalog/storefront.ts";

export function DisplayMedia({ media, priority = false, sizes = "100vw" }: { media: PublicDisplayMedia; priority?: boolean; sizes?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <div className="store-media-fallback" role="img" aria-label={media.alt || "Image unavailable"}>Image unavailable</div>;
  const url = `/api/v1/media/${media.publicKey}`;
  if (media.type === "video") return <video className="store-display-media" controls playsInline preload="none" aria-label={media.alt} poster={media.posterKey ? `/api/v1/media/${media.posterKey}` : undefined} width={media.width} height={media.height} onError={() => setFailed(true)}><source src={url} type="video/mp4" /></video>;
  return <Image className="store-display-media" src={url} alt={media.alt} width={media.width} height={media.height} sizes={sizes} {...(priority ? { preload: true } : { loading: "lazy" })} style={{ objectPosition: `${media.focalX * 100}% ${media.focalY * 100}%` }} onError={() => setFailed(true)} />;
}
