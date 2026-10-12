# Customer and Admin User Flows

Version 2.0 · 23 September 2026

DATA_MODEL.md owns state transitions and API.md owns endpoints. Flows here define the visible experience in live/test modes. Fixture mode simulates the same states but explicitly labels them and makes no real provider calls.

## UF-01 — Discover clothing (FR-01/02)

Homepage → campaign/category → collection → optional filters/sort → product. CTA is usable immediately. Public results include only published products with enabled variants. The back button restores URL filters/page. Unknown collection/product returns a useful not-found state. Missing image uses a dimension-preserving fallback without inventing garment details.

Desktop filters commit immediately; mobile drawer holds draft selections until Apply. Closing discards draft changes. OR inside filter group, AND across groups; one variant must match colour/size/price/stock. Reset keeps user on the same collection. Pagination retains filters; changing filter/sort resets page1. Search trims and normalizes query; blank query prompts input; no-results offers reset/categories.

## UF-02 — Choose colour and size (FR-03)

Product shows first colour in stable order and no selected size unless a valid variant URL preselects it. Colour updates images and available sizes. Preserve an already selected size only when valid and available in the new colour; otherwise clear and announce it. Sold-out combinations remain visible but not purchasable. ONE_SIZE accessories still require a concrete selected variant.

Open size guide → labelled garment/body measurements in cm/in → close and restore focus. Add without size focuses size selection and shows a concise error. Valid add updates server cart and announces success; open cart drawer. Quick add uses identical variant logic in an accessible panel, never silent default size.

## UF-03 — Cart and wishlist (FR-03)

Same variant merges quantity; different colours/sizes create separate lines. Update/remove recalculates subtotal from server catalog. Cart never reserves stock. Public availability may change later and is revalidated at checkout. Reload uses the guest cookie/server cart; wishlist uses validated local IDs only.

Cart mutation with stale version returns current cart to review rather than overwriting another tab. Unavailable products are marked/removed with explanation before checkout; no silent substitution. If checkout is already pending, show its status and let the shopper resolve/cancel it before creating a conflicting order. Storage failure affects wishlist persistence but does not corrupt the server order.

## UF-04 — Address and delivery quote (FR-04)

Product-page PIN check gives an estimate only. Cart → checkout → contact/full address → server confirms serviceability, packaging and total. Select a compatible preset that fits every item and total weight; no unsupported split shipping. The server returns shipping fee, tax-inclusive breakdown, total and quote expiry.

Unserviceable PIN: explain and allow another address, no payment. Missing package configuration: report unavailable delivery quote and alert admin. Provider timeout: keep cart/address in current session UI and offer retry; do not invent a free rate. Expired/changed quote: refresh, show revised total and require the shopper to confirm it before payment. Do not persist address drafts in browser local storage.

## UF-05 — Pay (FR-05)

Click Pay → lock UI against repeats → server consumes quote, creates pending store order and reserves stock → server creates/reconciles Razorpay order → open Razorpay Checkout. If provider order creation is queued/unknown, show Preparing payment and poll safe operation status with bounded backoff.

Successful client handler sends signature details to server. Display Verifying payment until captured payment is confirmed server-side. Receipt then displays paid amount and order number. Cart clearing removes only the purchased snapshot once; do not erase new unrelated items. Email notification is queued after commit; email failure does not undo order/payment.

Failure/recovery cases:

- Client closes window or network drops: return to pending receipt; server continues verification. Do not invite another payment while outcome is uncertain.
- Authorized but not captured: remain awaiting confirmation, no shipping.
- Known failed attempt: offer retry through the existing unresolved order when safe and its reservation is valid; do not create competing store orders.
- Expired reservation: reconcile payment first; release only when safe. Customer reviews fresh stock/quote before a new checkout.
- Late captured payment without stock: show Payment received — order needs review; admin resolves/refunds. Never claim no payment occurred.
- Duplicate callback/webhook: existing success appears; no extra order, sale movement or notification.

## UF-06 — Admin login and product creation (FR-07/08/09)

Admin logs in through Supabase → server verifies identity/current membership → dashboard. Ordinary authenticated users are denied. Owner bootstrap is performed by trusted setup, never by registering through admin UI.

Products → Add product → draft title/category/description → colours/sizes/SKUs/prices/unit weights → inventory adjustment → real size guide → compatible packaging → media → preview → publish. Admin may save an incomplete draft at any stage; publish lists missing fields. Concurrent edit conflict shows current version and preserves unsaved local inputs for manual resolution.

Upload flow: request signed private PUT → upload file → request validation → wait for ready → attach/map/reorder → publication promotes validated assets → storefront updates. Network/validation failure leaves that asset failed, not a published broken URL. Large or unsupported file rejected with limits. An upload URL is temporary and does not expose R2 credentials.

After successful publish, invalidate affected public catalog/content caches. Product can be edited without a source redeploy. Archiving removes public listing and blocks new checkout while preserving ordered snapshots. Never delete inventory/order history to hide a product.

## UF-07 — Pack and dispatch (FR-10)

Paid + allocated order appears Awaiting fulfillment. Admin checks items, packs them and confirms actual weight/dimensions. Fetch courier options for the same one-parcel order. Admin selects quote → Create shipment → Assign AWB → download/print label → Request pickup. Each step persists its own status/reference. A request accepted by the provider is not yet physical collection.

Customer total remains the original paid total even if actual shipping cost differs. Admin sees the cost difference. If the parcel cannot be shipped under v1 constraints, hold for resolution; no automatic extra charge or hidden split parcel.

Failure/recovery:

- Unpaid, fully refunded, cancelled or payment-held order: shipping blocked.
- Double click/concurrent admin: one operation and one active forward shipment.
- Create/AWB/pickup timeout: Unknown — checking with carrier; reconcile saved reference before new action.
- AWB assigned but pickup failed: keep AWB and label; retry pickup only.
- Provider unavailable: order stays paid/ready, operations queue alerts admin; it is not marked shipped.
- Cancellation requested: lock against dispatch; confirm provider cancellation before recreating shipment. After pickup use return/interception workflow, not ordinary cancellation.

## UF-08 — Track delivery (FR-06/10)

Customer opens owned order → tracking shows Preparing order, Pickup pending, Collected, In transit, Out for delivery and Delivered when supported by real events. Webhooks update DB; scheduled polling repairs missing updates. Include last refreshed time. Unknown provider status stays an attention event, not mapped arbitrarily to Delivered.

Stale/out-of-order events are recorded but cannot regress a verified delivery. Failed delivery/RTO is displayed explicitly and alerts admin. Physical RTO receipt and condition inspection determine restocking/refund handling; a tracking notification alone does not make goods sellable again.

No current guest session: Track order → order number/email → generic accepted message → verify Supabase email OTP → server checks matching order email → grant authorized order access. Wrong OTP/order pairing reveals no order details; rate limit retries.

## UF-09 — Cancel, return and refund (FR-11)

Pre-dispatch cancellation: customer submits request → server checks payment/fulfillment → lock against booking → resolve provider cancellation if shipment exists → cancel order and release uncommitted inventory or restock unshipped allocated goods once → refund captured funds as appropriate. Unknown provider state requires review, not a guessed cancel.

Delivered return: customer selects eligible order lines/quantities/reason → request recorded → admin approves/rejects under configured policy → admin arranges reverse pickup (provider dashboard/manual reference supported in v1) → records receipt/inspection → sellable accepted quantity may be restocked → owner initiates refund. Physical receipt, restock and refund are separate auditable operations.

Refund screen shows captured amount minus processed/pending refunds. Owner chooses amount/reason, confirms, and sees Processing until provider confirms. Timeout remains Unknown and reconciles; never sends a second refund blindly. Partial refund updates payment status without cancelling unrelated fulfillment automatically.

Size exchange v1: support guides customer through an eligible return and a separate new order. No automatic replacement reservation/shipment UI is promised.

## UF-10 — Content, settings and attention work (FR-12)

Admin changes homepage draft/collection order → previews → publishes → cache refresh. Owner changes warehouse/packaging/shipping/tax/policy settings with version checking and audit trail. Existing paid order snapshots remain immutable; new quotes use the new settings.

Operations queue shows provider/task, affected order, safe error, attempts and next action. Known retryable failure may retry; ambiguous creation requires reconcile. Refund/payment mismatch belongs to owner attention. Notifications can retry independently; do not roll back a paid order because email failed.

## UF-11 — Accessibility and motion

Keyboard follows logical order; overlays move/trap/restore focus and close with Escape. Mobile never depends on hover. Reduced-motion uses static hero/poster, removes parallax and preserves all controls. Loading states reserve space and announce meaningful status without overwhelming screen readers. No private data should appear in a shared public preview.
