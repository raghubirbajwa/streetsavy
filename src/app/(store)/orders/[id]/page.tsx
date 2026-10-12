import { OrderClient } from "../../../../components/store/checkout-client.tsx";
export const dynamic="force-dynamic";
export const metadata={title:"Your order — YOUR BRAND",robots:{index:false,follow:false}};
export default async function OrderPage({params}:{params:Promise<{id:string}>}){const{id}=await params;return <main id="main" className="checkout-page"><h1>Your order</h1><OrderClient id={id}/></main>;}
