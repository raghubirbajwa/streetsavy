import type {Metadata} from "next";
import {storefrontData} from "../../../lib/catalog/storefront.ts";
import WishlistView from "../../../components/store/wishlist-view.tsx";
export const metadata:Metadata={title:"Your wishlist",robots:{index:false,follow:false}};
export const dynamic="force-dynamic";
export default async function WishlistPage(){const {catalog}=await storefrontData();return <main id="main" className="store-wishlist-page"><header><p className="purchase-kicker">For another day</p><h1>Your wishlist</h1><p>A few things worth keeping close.</p></header><WishlistView products={catalog.products} sizeGuides={catalog.sizeGuides}/></main>;}
