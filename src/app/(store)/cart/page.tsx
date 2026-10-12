import type {Metadata} from "next";
import CartView from "../../../components/store/cart-view.tsx";
export const metadata:Metadata={title:"Your cart",robots:{index:false,follow:false}};
export const dynamic="force-dynamic";
export default function CartPage(){return <main id="main" className="store-cart-page"><header><p className="purchase-kicker">Good choices start here</p><h1>Your cart</h1></header><CartView/></main>;}
