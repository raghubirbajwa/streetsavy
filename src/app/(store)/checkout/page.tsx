import { readEnvironment } from "../../../config/env.ts";
import { CheckoutClient } from "../../../components/store/checkout-client.tsx";
export const dynamic="force-dynamic";
export const metadata={title:"Checkout — YOUR BRAND",robots:{index:false,follow:false}};
export default function CheckoutPage(){return <main id="main" className="checkout-page"><h1>Checkout</h1><CheckoutClient fixture={readEnvironment().APP_MODE==="fixture"}/></main>;}
