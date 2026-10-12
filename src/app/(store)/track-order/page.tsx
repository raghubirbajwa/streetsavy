import { readEnvironment } from "../../../config/env.ts";
import { OrderRecoveryClient } from "../../../components/store/checkout-client.tsx";
export const dynamic="force-dynamic";
export const metadata={title:"Track order — YOUR BRAND",robots:{index:false,follow:false}};
export default function TrackOrderPage(){return <main id="main" className="checkout-page"><h1>Track order</h1><OrderRecoveryClient fixture={readEnvironment().APP_MODE==="fixture"}/></main>;}
