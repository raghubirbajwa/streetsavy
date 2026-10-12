import Link from "next/link";
import { OrderFulfillment } from "../../../../../components/store/order-fulfillment.tsx";
import "../../../../../components/store/checkout.css";
export const dynamic = "force-dynamic";
export const metadata = { title: "Delivery timeline — YOUR BRAND", robots: { index: false, follow: false } };
export default async function TrackingPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <main id="main" className="checkout-page"><Link href={`/orders/${id}`}>← Your receipt</Link><h1>Delivery timeline</h1><OrderFulfillment orderId={id} section="tracking" /></main>; }
