import { readEnvironment } from "../../../config/env.ts";
import { storeSupabaseReady } from "../../../lib/supabase/store.ts";
import { OrderRecoveryClient } from "../../../components/store/checkout-client.tsx";
import "../../../components/store/checkout.css";
export const dynamic="force-dynamic";
export const metadata={title:"Track order — YOUR BRAND",robots:{index:false,follow:false}};
export default function TrackOrderPage(){return <main id="main" className="track-order-scene checkout-page"><h1>Track order</h1><OrderRecoveryClient fixture={!storeSupabaseReady() && readEnvironment().APP_MODE==="fixture"}/></main>;}
