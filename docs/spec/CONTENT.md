# Content, Sample Catalog and Business Inputs

Version 2.0 · 23 September 2026

## Content ownership and modes

Working wordmark: YOUR BRAND. Proposed art direction is contemporary streetwear inspired by Bonkers Corner, using original writing and approved imagery. Public campaign content and catalog are admin-editable in Supabase, while image/video bytes live in Cloudflare R2.

The samples below belong only to fixture/test environments. Live content must use real products, photographs, measurements, prices and business facts. Never copy the reference's brand assets or invent sales, customer counts, ratings, celebrity associations, scarcity, certifications or discounts. A published product is a business claim, not a random visual placeholder.

## Homepage copy

- Announcement: “Explore the latest collection.” → `/collections/new-arrivals`.
- Hero eyebrow: “THE EVERYDAY EDIT”.
- Hero headline: “MADE FOR YOUR EVERYDAY.”
- Supporting line: “Relaxed fits. Strong details.”
- CTA: “Explore the collection” → `/collections/everyday-uniform`.
- Category heading: “Find your fit”. Tiles: Oversized Tees, Hoodies, Cargos, Shirts, Accessories → their collection slugs.
- Arrivals: “Just landed” / “View all” → `/collections/new-arrivals`.
- Story: “THE EVERYDAY UNIFORM” / “Easy layers, relaxed shapes and pieces that work together.” / “Shop the edit”.
- Featured: “In the spotlight” / “Explore featured” → `/collections/featured`.
- Optional lookbook: “Wear it your way”; each look links to products actually pictured.

Hero is a strong photograph or short optimized video with real HTML headings and CTA. Default visible footer has shop/support/policy/Track order links. Newsletter is hidden in live mode until an actual subscription integration is chosen; a design preview must explicitly say it is inactive and never store the entered email.

## Customer interface copy

Navigation: New Arrivals, Men, Women, Accessories, Collections, Search, Wishlist, Cart, Track order.

Product: Colour, Size, Size guide, Quantity, Add to cart, Sold out. Missing size: “Choose a size to continue.” Stock conflict: “Availability changed. Please review your cart.” Size-guide demo notice: “Illustrative measurements for this preview; replace with actual garment measurements before launch.”

Cart: “Subtotal”; shipping helper “Delivery charges are calculated at checkout.” Checkout button “Continue to checkout”. Address action “Check delivery”. Payment button “Pay {formattedTotal}” only after a valid server quote. Do not print hardcoded shipping fees in customer copy.

Unserviceable: “We can't deliver to this PIN code with the current shipping options.” Quote unavailable: “We couldn't confirm delivery charges. Please try again.” Quote changed: “Your total has changed. Review it before paying.” Tax line: use configured inclusive tax breakdown; no invented GST rate.

Payment waiting: “We're verifying your payment. Please don't pay again.” Confirmed: “Payment received. We're preparing your order.” Paid but held: “Payment received. Your order needs review. We'll update you.” Confirmed failure: “Payment wasn't completed. You can try again.” Do not show failure solely because the payment window closed.

Tracking: Preparing your order; Pickup pending; Picked up; In transit; Out for delivery; Delivered; Delivery issue; Returning to sender; Returned to sender. Estimates include “Estimated” and last-updated information. Use event-derived state, not a hardcoded timeline that always appears complete.

Return request: “Request a return”; acknowledgement “Request received. We'll review it under our return policy.” Refund accepted by provider: “Refund processing”; only processed: “Refund issued” with bank timing from approved policy, not an invented guarantee.

Recovery: “Enter your order number and checkout email.” Generic OTP request response: “If these details match an order, follow the verification instructions sent to your email.” Avoid revealing whether an email/order exists.

Empty cart: “Your cart is empty.” / “Explore clothing”. Empty wishlist: “Save pieces to come back to.” Empty filters: “No items match these filters.” / “Reset filters”. Missing route: “We couldn't find that page.” Error: “We couldn't load this section.” / “Try again”.

## Admin interface copy

Actions: Add product, Save draft, Preview, Publish, Archive, Adjust stock, Upload media, Set cover, Add colour, Add size, Save collection, Create shipment, Assign tracking number, Download label, Request pickup, Refresh tracking, Review return, Record inspection, Issue refund.

Publication error: “Complete these fields before publishing.” Upload completion: “Upload complete — validating file.” Ready: “Ready to use.” Unknown provider operation: “Checking with the provider. Don't create another request yet.” Save conflict: “This item changed since you opened it. Review the latest version before saving.”

Order UI labels payment, fulfillment and shipment separately. SKU stock labels: On hand, Reserved, Available. Refund UI labels Captured, Refunded, Pending refunds, Remaining refundable. Never label a requested pickup Collected or a refund request Refunded.

## Initial catalog: 16 original demo products

These names, prices and descriptions are seed instructions. All amounts are INR display values; convert to integer paise in fixtures. Use deterministic UUID seed IDs (for example UUIDv5 from the numbered product key) and stable lowercase hyphenated slugs from these names; database IDs remain UUIDs.

1. Everyday Oversized Tee — ₹899 — oversized-tees — black, off-white. “An easy oversized shape for everyday outfits.”
2. Washed Studio Tee — ₹1,099 — oversized-tees — washed-black, stone. “A relaxed tee with a washed-look finish.”
3. Linework Graphic Tee — ₹999 — oversized-tees — black, off-white. “A graphic-led tee with a relaxed silhouette.”
4. Boxy Pocket Tee — ₹949 — oversized-tees — olive, stone. “A boxy shape with a simple pocket detail.”
5. Core Pullover Hoodie — ₹1,899 — hoodies — black, grey. “A relaxed layer with a clean everyday look.”
6. Washed Zip Hoodie — ₹2,199 — hoodies — washed-black, stone. “An easy zip layer for a laid-back outfit.”
7. Panelled Street Hoodie — ₹2,399 — hoodies — grey, black. “Panel details give this relaxed layer definition.”
8. Straight Utility Cargo — ₹1,999 — cargos — olive, black. “A straight silhouette with utility-inspired pockets.”
9. Wide-Leg Cargo — ₹2,199 — cargos — stone, black. “A wider shape for relaxed everyday styling.”
10. Everyday Drawstring Cargo — ₹1,799 — cargos — grey, olive. “An easy shape with a drawstring waist detail.”
11. Boxy Everyday Shirt — ₹1,499 — shirts — off-white, black. “A boxy shirt to wear on its own or as a layer.”
12. Contrast Stitch Shirt — ₹1,699 — shirts — black, stone. “Contrasting stitch details on a relaxed silhouette.”
13. Relaxed Check Shirt — ₹1,599 — shirts — blue-check, brown-check. “A relaxed check shirt for simple layered outfits.”
14. Everyday Cap — ₹699 — accessories — black, stone. “A simple cap to finish the look.”
15. Studio Tote — ₹799 — accessories — off-white, black. “A graphic everyday carry option.”
16. Ribbed Crew Socks — ₹349 — accessories — off-white, black. “A crew-length pair for everyday styling.”

Descriptions are concepts: use assets that actually match them or adjust the copy. Do not assert material percentages, comfort performance or exact construction without content support. Clothing sizes: S/M/L/XL initially; accessories ONE_SIZE. Set explicit per-variant demo on_hand and reserved=0, not random values during rendering. Use stable timestamps and ranks.

Required edge-case seeds: one sold-out size; product 7 entirely sold out; product 12's stone variants ₹1,799 to exercise range pricing; product 15 with only one image; one title extended in a development test fixture to verify wrapping. Avoid invented compare-at discounts in the initial catalog.

## Collection membership seed

Use product numbers above as shorthand for their IDs; persist actual IDs, not numbers, in Collection fixtures. Order here is featured order.

- all: 1–16 in sequence.
- new-arrivals: 12, 9, 6, 3, 13, 15, 4, 7.
- men: 1, 2, 5, 8, 11, 12, 14, 16.
- women: 3, 4, 6, 9, 10, 13, 15, 16.
- accessories: 14, 15, 16.
- oversized-tees: 1, 2, 3, 4.
- hoodies: 5, 6, 7.
- cargos: 8, 9, 10.
- shirts: 11, 12, 13.
- everyday-uniform: 1, 5, 8, 11, 14, 16.
- featured: 2, 5, 8, 11, 14, 16.

These are demo merchandising assignments, not restrictions on who can wear a garment. Optional outfit pairings: 1+8+14; 11+10+15. Display lookbook only if images accurately represent those garments.

## Sample operational data

All numbers below are test fixtures, not real garment/shipping facts. Assign tees 250g, hoodies 700g, cargos 600g, shirts 350g, caps 150g, totes 200g and socks 80g for exercising packaging logic. Use test packaging presets with dimensions/tare/capacity and product compatibility; replace by measured packed values before live operation. No sample courier quote is a claimed market price.

Do not invent a real pickup address or support identity. Use clearly labelled test address data only in fixture mode; provider calls require approved pickup/test details. Fixture shipping/payment adapters must exercise success, unserviceable PIN, timeouts, duplicate events, late capture and failed pickup.

## Size information

Real charts state garment or body measurements, column definitions, cm values and measurement instructions. Display inch conversion from stored cm. If not supplied during design, show explanatory content rather than pretending sample values guarantee fit. Publish validation in live mode requires applicable approved size information for sized clothing.

## Assets and publication

Required: desktop hero, mobile crop, five category images, collection-story imagery, product front/alternate images, colour-specific images and optional outfit media. Prefer consistent lighting, models and backgrounds. Keep product photography faithful to each variant.

Asset manifest records source/creator, license/permission, attribution, local/object key, dimensions, alt text, crop/focal point, usage and replacement status. Suggested upload limits: JPEG/PNG/WebP/AVIF images ≤10MB; MP4 ≤50MB and ≤30 seconds with poster. Actual file validation uses the shared API constants, not client declarations. Reject unapproved SVG/HTML uploads. Optimize delivery assets; upload maximums are not target page payload sizes.

Private staging upload → verified media → attach to draft → promote immutable public copy on publish. Never use a public R2 bucket for draft-only assets, customer addresses, invoices or courier labels. Public catalog images are intended to be publicly viewable; archiving does not instantly revoke cached copies.

Use neutral placeholders only while developing and list replacements. Real launch requires suitable actual assets. No third-party branded images without permission.

## Required business content before launch

Owner must supply brand identity, support email/phone, business details required for invoices, actual products/prices/tax categories, measured sizes/weights, pickup address, packaging limits, shipping fee policy and return/refund terms. No guessed tax rate or legal policy.

Shipping policy specifies serviceable geography, dispatch process, estimated transit wording, customer shipping fee policy and delivery-failure handling. Return policy specifies eligible items/condition/window, request process, pickup/cost responsibility, inspection/refund rules and size-exchange approach. Privacy/terms reflect actual data/payment/shipping providers and retention; draft placeholders block live-checkout readiness.

## Transactional notifications

Implement order-confirmed, dispatched/tracking, delivery exception, return decision and refund-status templates behind NotificationService. Send only after committed factual state, with a dedupe key. Include order number, relevant items/status and protected order route; do not include secrets or unnecessary address details. Sender/contact must be configured. Delivery failure is visible in admin and retried independently of the order.

Supabase email OTP uses configured Auth email delivery and separate recovery wording. Marketing subscription is not silently bundled into checkout consent.

## Metadata

Homepage “YOUR BRAND — Everyday Streetwear”; collection “{title} | YOUR BRAND”; product “{title} | YOUR BRAND”. Actual content owns descriptions, canonical slugs and alt text. Admin/order/auth/cart/checkout routes remain noindex; entire fixture/test environment noindex. Keep personal data and order tokens out of metadata and analytics.
