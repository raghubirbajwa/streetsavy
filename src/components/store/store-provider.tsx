"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { cartSchema } from "../../lib/cart/contracts.ts";
import type { CartDTO } from "../../lib/cart/contracts.ts";
import { productDetailSchema } from "../../lib/catalog/public-api.ts";
import type { PublicProduct, PublicSizeGuide } from "../../lib/validation/catalog.ts";
import { useWishlistStore } from "./wishlist-store.ts";
import { StoreOverlay } from "./overlay.tsx";
import PurchasePanel from "./purchase-panel.tsx";
import CartView from "./cart-view.tsx";
import "./purchase.css";

type MutationResult = { ok: boolean; message: string };
type QuickAdd = { product: PublicProduct; initialVariantId?: string; initialColorKey?: string; sizeGuide?: PublicSizeGuide };
type StoreContextValue = {
  cart: CartDTO | null; cartCount: number; cartLoading: boolean; cartBusy: boolean; cartError: string; cartNotice: string;
  refreshCart: () => Promise<void>; addToCart: (variantId: string, quantity: number) => Promise<MutationResult>;
  updateCartItem: (variantId: string, quantity: number) => Promise<MutationResult>; removeCartItem: (variantId: string) => Promise<MutationResult>;
  openCart: () => void; closeOverlay: () => void;
  openQuickAdd: (product: PublicProduct, initialVariantId?: string, sizeGuide?: PublicSizeGuide, initialColorKey?: string) => void;
  overlay: "cart" | "quick-add" | null;
  wishlistIds: string[]; wishlistReady: boolean; wishlistError: string; toggleWishlist: (id: string) => void; removeWishlist: (ids: string[]) => void;
};
const StoreContext = createContext<StoreContextValue | null>(null);
export function useStore() { const store = useContext(StoreContext); if (!store) throw new Error("StoreProvider is required."); return store; }

export function StoreProvider({ children }: { children: ReactNode }) {
  const [cart,setCart] = useState<CartDTO|null>(null); const cartRef = useRef<CartDTO|null>(null);
  const [cartLoading,setCartLoading]=useState(true); const [cartBusy,setCartBusy]=useState(false); const busy=useRef(false);
  const [cartError,setCartError]=useState(""); const [cartNotice,setCartNotice]=useState(""); const requestVersion=useRef(0);
  const [overlay,setOverlay]=useState<"cart"|"quick-add"|null>(null); const [quick,setQuick]=useState<QuickAdd|null>(null); const quickRequest=useRef(0);
  const [overlayOrigin,setOverlayOrigin]=useState<HTMLElement|null>(null); const pendingCartOrigin=useRef<HTMLElement|null>(null);
  const {wishlistIds,wishlistReady,wishlistError,toggleWishlist,removeWishlist}=useWishlistStore();
  const acceptCart=useCallback((next:CartDTO)=>{cartRef.current=next;setCart(next);},[]);
  const loadCart=useCallback((signal?:AbortSignal):Promise<void>=>{
    if(busy.current)return Promise.resolve();
    const version=++requestVersion.current;
    const isCurrent=()=>version===requestVersion.current&&!signal?.aborted;
    return fetch("/api/v1/cart",{cache:"no-store",...(signal?{signal}:{})})
      .then(async(response)=>{const body=await response.json();if(!response.ok)throw new Error();return cartSchema.parse(body.data);})
      .then((next)=>{if(isCurrent()){acceptCart(next);setCartError("");}})
      .catch(()=>{if(isCurrent())setCartError("Your cart could not be loaded. Please try again.");})
      .finally(()=>{if(isCurrent())setCartLoading(false);});
  },[acceptCart]);
  const refreshCart=useCallback(async()=>{
    if(busy.current)return;
    setCartLoading(true);
    await loadCart();
  },[loadCart]);
  useEffect(()=>{
    // Initial loading is already represented by state; fetch completion updates it.
    const controller=new AbortController();
    void loadCart(controller.signal);
    const focused=()=>{if(!busy.current)void refreshCart();};
    window.addEventListener("focus",focused);
    return()=>{controller.abort();window.removeEventListener("focus",focused);};
  },[loadCart,refreshCart]);
  async function mutateCart(action:"add"|"update"|"remove",variantId:string,quantity=1):Promise<MutationResult>{
    if(busy.current)return{ok:false,message:"Your cart is updating. Please wait."};
    const trigger = overlay === "quick-add" ? overlayOrigin : document.activeElement instanceof HTMLElement ? document.activeElement : null;
    busy.current=true;setCartBusy(true);setCartError("");setCartNotice("");++requestVersion.current;
    try{
      let current=cartRef.current;
      if(!current?.id){const response=await fetch("/api/v1/cart",{method:"POST",cache:"no-store"});const body=await response.json();if(!response.ok)throw new Error();current=cartSchema.parse(body.data);acceptCart(current);}
      const endpoint=action==="add"?"/api/v1/cart/items":`/api/v1/cart/items/${encodeURIComponent(variantId)}`;
      const response=await fetch(endpoint,{method:action==="add"?"POST":action==="update"?"PATCH":"DELETE",cache:"no-store",headers:action==="remove"?{"If-Match":`"${current.version}"`}:{"Content-Type":"application/json"},...(action!=="remove"?{body:JSON.stringify(action==="add"?{variantId,quantity,cartVersion:current.version}:{quantity,cartVersion:current.version})}:{})});
      const body=await response.json();
      if(!response.ok){const latest=cartSchema.safeParse(body.error?.currentCart);if(latest.success)acceptCart(latest.data);const message=typeof body.error?.message==="string"?body.error.message:"The cart changed. Review it before trying again.";setCartError(message);return{ok:false,message};}
      acceptCart(cartSchema.parse(body.data));if(action==="add")pendingCartOrigin.current=trigger;const message=action==="add"?"Added to your cart.":action==="remove"?"Item removed.":"Quantity updated.";setCartNotice(message);return{ok:true,message};
    }catch{const message="We couldn’t update your cart. Check your connection and try again.";setCartError(message);return{ok:false,message};}
    finally{busy.current=false;setCartBusy(false);setCartLoading(false);}
  }
  function closeOverlay(){++quickRequest.current;setOverlay(null);}
  function openCart(){setOverlayOrigin(pendingCartOrigin.current ?? (document.activeElement instanceof HTMLElement?document.activeElement:null));pendingCartOrigin.current=null;++quickRequest.current;setOverlay("cart");void refreshCart();}
  function openQuickAdd(product:PublicProduct,initialVariantId?:string,sizeGuide?:PublicSizeGuide,initialColorKey?:string){
    setOverlayOrigin(document.activeElement instanceof HTMLElement?document.activeElement:null);
    const version=++quickRequest.current;
    setQuick({product,...(initialVariantId?{initialVariantId}:{}),...(sizeGuide?{sizeGuide}:{}),...(initialColorKey?{initialColorKey}:{})});setOverlay("quick-add");
    void fetch(`/api/v1/products/${encodeURIComponent(product.slug)}`,{cache:"no-store"}).then(async(response)=>{if(!response.ok)return;const body=await response.json();const next=productDetailSchema.safeParse(body.data);if(next.success&&quickRequest.current===version){const {category,guide,...freshProduct}=next.data;setQuick((current)=>{if(!current)return current;const {sizeGuide:previousGuide,...previous}=current;return{...previous,product:freshProduct,...(guide?{sizeGuide:guide}:{})};});}}).catch(()=>undefined);
  }
  const value:StoreContextValue={cart,cartCount:cart?.itemCount??0,cartLoading,cartBusy,cartError,cartNotice,refreshCart,addToCart:(id,q)=>mutateCart("add",id,q),updateCartItem:(id,q)=>mutateCart("update",id,q),removeCartItem:(id)=>mutateCart("remove",id),openCart,closeOverlay,openQuickAdd,overlay,wishlistIds,wishlistReady,wishlistError,toggleWishlist,removeWishlist};
  return <StoreContext.Provider value={value}>{children}{overlay==="cart"&&<StoreOverlay title="Your cart" onClose={closeOverlay} returnFocus={overlayOrigin} className="store-cart-drawer"><CartView drawer/></StoreOverlay>}{overlay==="quick-add"&&quick&&<StoreOverlay title="Choose your fit" onClose={closeOverlay} returnFocus={overlayOrigin} className="store-quick-add"><PurchasePanel key={`${quick.product.id}:${quick.initialVariantId??""}:${quick.initialColorKey??""}`} product={quick.product} {...(quick.initialVariantId?{initialVariantId:quick.initialVariantId}:{})} {...(quick.initialColorKey?{initialColorKey:quick.initialColorKey}:{})} {...(quick.sizeGuide?{sizeGuide:quick.sizeGuide}:{})} compact/></StoreOverlay>}</StoreContext.Provider>;
}
export default StoreProvider;
