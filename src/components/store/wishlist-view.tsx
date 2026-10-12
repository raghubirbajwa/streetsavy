"use client";
import Link from "next/link";
import type { PublicProduct, PublicSizeGuide } from "../../lib/validation/catalog.ts";
import ProductCard from "./product-card.tsx";
import { useStore } from "./store-provider.tsx";
export default function WishlistView({products,sizeGuides}:{products:PublicProduct[];sizeGuides:PublicSizeGuide[]}){
  const store=useStore();if(!store.wishlistReady)return <p role="status" className="store-wishlist-state">Loading your saved pieces…</p>;
  const saved=store.wishlistIds.flatMap((id)=>{const product=products.find((p)=>p.id===id);return product?[product]:[];});const missing=store.wishlistIds.filter((id)=>!products.some((p)=>p.id===id));
  return <>{store.wishlistError&&<p role="status" className="purchase-notice">{store.wishlistError}</p>}{missing.length>0&&<div className="purchase-notice"><p>{missing.length} saved {missing.length===1?"piece is":"pieces are"} no longer available.</p><button type="button" className="store-text-button" onClick={()=>store.removeWishlist(missing)}>Remove unavailable pieces</button></div>}{saved.length?<><p className="store-wishlist-count">{saved.length} saved {saved.length===1?"piece":"pieces"}</p><div className="store-related-grid">{saved.map((product)=><ProductCard key={product.id} product={product} sizeGuides={sizeGuides}/>)}</div></>:<div className="store-cart-state"><span className="store-empty-symbol" aria-hidden="true">♡</span><h2>Save pieces to come back to.</h2><p>Tap the heart on anything that catches your eye.</p><Link className="store-primary-button" href="/collections/all">Explore clothing <span aria-hidden="true">↗</span></Link></div>}<p className="store-wishlist-storage">Your wishlist is saved in this browser. It does not reserve stock.</p></>;
}
