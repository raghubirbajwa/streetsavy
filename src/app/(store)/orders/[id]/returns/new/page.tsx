import Link from "next/link";
import { readEnvironment } from "../../../../../../config/env.ts";
import { OrderFulfillment } from "../../../../../../components/store/order-fulfillment.tsx";
import "../../../../../../components/store/checkout.css";
export const dynamic = "force-dynamic";
export const metadata = { title: "Request a return — YOUR BRAND", robots: { index: false, follow: false } };
export default async function ReturnPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <main id="main" className="checkout-page"><Link href={`/orders/${id}`}>← Your receipt</Link><h1>Return request</h1>{readEnvironment().APP_MODE === "fixture" && <p className="checkout-mode">Fixture return — requests and inspection are simulated locally. No actual parcel or refund is sent.</p>}<OrderFulfillment orderId={id} section="returns" /></main>; }
