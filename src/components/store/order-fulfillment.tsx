"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { z } from "zod";
import { shippingTrackingSchema, type ShippingTrackingDTO } from "../../lib/fulfillment/shipping-contracts.ts";
import { returnEligibilitySchema, returnSchema } from "../../lib/fulfillment/returns-contracts.ts";
import { m5Request, readable, when, useM5Action } from "../admin/M5Shared.tsx";
import "./order-fulfillment.css";
import { sizeLabel } from "../../lib/store/purchase.ts";
import { receiptSchema } from "../../lib/checkout/contracts.ts";

const deliveryLabels: Record<string, string> = { not_shipped: "Preparing your order", in_transit: "In transit", out_for_delivery: "Out for delivery", delivered: "Delivered", exception: "Delivery needs attention", rto_in_transit: "Returning to the store", rto_delivered: "Returned to the store", cancelled: "Shipment cancelled", unknown: "Carrier update needs review" };
const returnEligibilityMessages: Record<string, string> = {
  NOT_DELIVERED: "Return requests open after delivery is confirmed.",
  RETURNS_UNCONFIGURED: "Online return requests are not available yet. Please contact the store about your order.",
  RETURN_WINDOW_CLOSED: "The return period for this order has ended.",
  NO_RETURNABLE_ITEMS: "All purchased quantities are already included in return requests. You can review those requests below.",
};
function ReturnHistory({ requests }: { requests: z.infer<typeof returnEligibilitySchema>["requests"] }) {
  return requests.length ? <div className="order-return-history"><h3>Your return requests</h3>{requests.map(request => <article key={request.id}><p><strong>{request.kind === "rto" ? "Carrier return" : "Return request"}</strong> · {readable(request.status)}</p><p>{request.reason}</p><ul>{request.items.map(item => <li key={item.id}>{item.title} × {item.quantity}{item.receivedQuantity > 0 ? ` · ${item.receivedQuantity} received` : ""}</li>)}</ul>{request.reverseReference && <p>Reverse shipment reference: {request.reverseReference}</p>}<p className="muted">Requested {when(request.requestedAt)}. Receipt, inspection and refund are checked separately.</p></article>)}</div> : null;
}
type OrderFulfillmentProps = { orderId: string; section?: "all" | "tracking" | "returns"; captured?: boolean; canCancel?: boolean; orderStatus?: string; onChanged?: () => void };
export function OrderFulfillment(props: OrderFulfillmentProps) {
  // A new order or payment transition starts with fresh eligibility, tracking and form state.
  return <OrderFulfillmentDetails key={`${props.orderId}:${props.captured ?? true}`} {...props} />;
}
function OrderFulfillmentDetails({ orderId, section = "all", captured = true, canCancel = false, orderStatus, onChanged }: OrderFulfillmentProps) {
  const [tracking, setTracking] = useState<ShippingTrackingDTO | null>(null);
  const [eligibility, setEligibility] = useState<z.infer<typeof returnEligibilitySchema> | null>(null);
  const [loadError, setLoadError] = useState("");
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [reason, setReason] = useState(""), [cancelReason, setCancelReason] = useState(""), [cancelConfirmed, setCancelConfirmed] = useState(false);
  const action = useM5Action();
  const readRevision = useRef(0);
  async function refresh() {
    const revision = ++readRevision.current;
    const [delivery, returns] = await Promise.all([m5Request(`orders/${orderId}/tracking`).then(value => shippingTrackingSchema.parse(value)), m5Request(`orders/${orderId}/returns`).then(value => returnEligibilitySchema.parse(value))]);
    if (revision === readRevision.current) { setTracking(delivery); setEligibility(returns); setLoadError(""); }
  }
  useEffect(() => {
    let disposed = false; const revision = ++readRevision.current;
    void Promise.all([m5Request(`orders/${orderId}/tracking`).then(value => shippingTrackingSchema.parse(value)), m5Request(`orders/${orderId}/returns`).then(value => returnEligibilitySchema.parse(value))]).then(([delivery, returns]) => { if (!disposed && revision === readRevision.current) { setTracking(delivery); setEligibility(returns); } }).catch(error => { if (!disposed && revision === readRevision.current) setLoadError(error instanceof Error ? error.message : "Order information unavailable."); });
    return () => { disposed = true; };
  }, [orderId, captured]);
  const activeShipments = tracking?.shipments.filter(shipment => shipment.bookingStatus !== "cancelled") ?? [];
  const hasReturnableItems = eligibility?.items.some(item => item.returnableQuantity > 0) ?? false;
  const collected = activeShipments.some(shipment => shipment.pickupStatus === "picked_up" || ["in_transit", "out_for_delivery", "delivered", "exception", "rto_in_transit", "rto_delivered"].includes(shipment.transitStatus));
  return <section className="order-fulfillment" aria-label="Delivery and returns">
    <div className="order-fulfillment-heading"><h2>{section === "returns" ? "Returns" : "Delivery & returns"}</h2><button className="store-text-button" disabled={action.busy} onClick={() => void action.run(refresh, "Saved delivery and return information refreshed. Carrier updates are checked by the store.")}>Refresh order information</button></div>
    {loadError && <div className="purchase-error" role="alert"><p>{loadError}</p><Link href="/track-order">Verify order access</Link></div>}
    {action.busy && <p role="status">Checking the saved order…</p>}{action.error && <p className="purchase-error" role="alert">{action.error}</p>}{action.notice && <p className="order-return-notice" role="status">{action.notice}</p>}
    {!tracking && !loadError && <p role="status">Loading delivery and return information…</p>}
    {tracking && section !== "returns" && <section className="checkout-card"><h3>Delivery progress</h3>{tracking.shipments.length === 0 ? <p>{captured ? "Preparing your order. A courier has not been booked yet." : "Delivery starts after payment is confirmed and the order is allocated."}</p> : tracking.shipments.map(shipment => <article className="order-shipment" key={shipment.id}>
      {shipment.fixture && <p className="checkout-mode">Fixture shipment — simulated tracking; no parcel is booked or collected.</p>}
      <h4>{shipment.bookingStatus === "cancelled" ? "Shipment cancelled" : shipment.transitStatus === "not_shipped" && (shipment.pickupStatus === "requested" || shipment.pickupStatus === "scheduled") ? "Pickup pending" : deliveryLabels[shipment.transitStatus] ?? "Carrier update needs review"}</h4>
      {shipment.bookingStatus === "unknown" && <p className="order-return-notice">The carrier booking is being checked. There is no confirmed dispatch yet.</p>}
      {shipment.pickupStatus === "failed" && <p className="order-return-notice">The pickup request needs attention. A tracking number does not mean the parcel has been collected.</p>}
      {(shipment.pickupStatus === "requested" || shipment.pickupStatus === "scheduled") && <p>The pickup request is recorded. Collection is confirmed by a later carrier event.</p>}
      {shipment.transitStatus === "exception" && <p className="purchase-error">Delivery needs attention. The store will review the carrier update.</p>}
      {shipment.transitStatus.startsWith("rto_") && <p>The parcel is returning to the store. Inspection and any refund are separate steps.</p>}
      {shipment.courierName && <p>Courier: {shipment.courierName}</p>}{shipment.awb && <p>Tracking number: <strong>{shipment.awb}</strong></p>}
      <p className="muted">Last refreshed: {when(shipment.lastSyncedAt)}</p>
      {shipment.events.length > 0 && <ol className="order-delivery-timeline">{[...shipment.events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)).map(event => <li key={event.id}><strong>{deliveryLabels[event.status] ?? readable(event.status)}</strong><time dateTime={event.occurredAt}>{when(event.occurredAt)}</time></li>)}</ol>}
    </article>)}{section === "all" && <p><Link href={`/orders/${orderId}/tracking`}>Open delivery timeline</Link></p>}</section>}
    {eligibility && section !== "tracking" && <section className="checkout-card"><h3>Request a return</h3><p><Link href="/policies/returns">Read the return policy</Link>. Size exchanges use an eligible return and a separate new order.</p>{eligibility.deadline && <p>Eligible return period ends {when(eligibility.deadline)} ({eligibility.windowDays} days).</p>}
      {!eligibility.eligible || !hasReturnableItems ? <p>{returnEligibilityMessages[eligibility.reason ?? (!hasReturnableItems ? "NO_RETURNABLE_ITEMS" : "")] ?? "This order is not currently eligible for a return request."}</p> : <form onSubmit={event => { event.preventDefault(); const items = eligibility.items.filter(item => (quantities[item.orderItemId] ?? 0) > 0).map(item => ({ orderItemId: item.orderItemId, quantity: quantities[item.orderItemId] ?? 0 })); void action.run(async () => { if (!items.length) throw new Error("Select at least one eligible item quantity."); returnSchema.parse(await m5Request(`orders/${orderId}/returns`, "POST", { items, reason })); setQuantities({}); setReason(""); await refresh(); onChanged?.(); }, "Return request recorded. Approval, physical receipt and refund are separate steps."); }}>
        <fieldset disabled={action.busy}><legend>Select the items to return</legend>{eligibility.items.map(item => <label className="order-return-item" key={item.orderItemId}><span>{item.title}<small>{item.color} / {sizeLabel(item.size)}</small><small>{item.returnableQuantity} remaining eligible of {item.purchasedQuantity} purchased</small></span><select aria-label={`Return quantity for ${item.title}`} disabled={item.returnableQuantity === 0} value={quantities[item.orderItemId] ?? 0} onChange={event => setQuantities({ ...quantities, [item.orderItemId]: Number(event.target.value) })}>{Array.from({ length: item.returnableQuantity + 1 }, (_, count) => <option value={count} key={count}>{count === 0 ? "Do not return" : count}</option>)}</select></label>)}<label>Reason for return<textarea required minLength={3} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} /></label><button className="store-primary-button" type="submit">Submit return request</button></fieldset>
      </form>}<ReturnHistory requests={eligibility.requests} />{section === "all" && eligibility.eligible && hasReturnableItems && <p><Link href={`/orders/${orderId}/returns/new`}>Open return request</Link></p>}
    </section>}
    {captured && canCancel && tracking && !collected && !["cancelled", "closed"].includes(orderStatus ?? "") && section === "all" && <section className="checkout-card"><h3>Cancel before collection</h3><p>The store checks any carrier booking before confirming cancellation. A paid cancellation may still need a separate refund.</p><form onSubmit={event => { event.preventDefault(); void action.run(async () => { const result = receiptSchema.parse(await m5Request(`orders/${orderId}/cancel`, "POST", { reason: cancelReason })); await refresh(); onChanged?.(); if (result.orderStatus !== "cancelled") throw new Error("Cancellation is saved and waiting for carrier reconciliation. Dispatch is held; refresh later."); }, "Order cancellation confirmed. Any captured funds remain visible on your receipt until the refund is processed."); }}><fieldset disabled={action.busy}><label>Reason for cancellation<textarea required minLength={3} maxLength={1000} value={cancelReason} onChange={event => setCancelReason(event.target.value)} /></label><label className="checkout-confirm"><input type="checkbox" checked={cancelConfirmed} onChange={event => setCancelConfirmed(event.target.checked)} />Request cancellation of this order.</label><button type="submit" className="store-text-button" disabled={!cancelConfirmed}>Request cancellation</button></fieldset></form></section>}
  </section>;
}
