# Design System and Page Specifications

Version 2.0 · 23 September 2026

## Direction

Bold editorial streetwear: strong garment imagery, large headlines, warm-white/near-black foundation, sharp controls and restrained movement. Inspired by the chosen clothing reference; original identity and content. No generic dashboard cards, excessive rounding, glass panels, unrelated gradients or decorative 3D objects.

## Tokens

```css
:root {
  --background: #faf9f6;
  --foreground: #151515;
  --surface: #f0efeb;
  --muted: #616161;
  --border: #d9d8d3;
  --accent: #ff5a1f;
  --control-radius: 4px;
  --overlay-radius: 8px;
  --content-width: 1440px;
}
```

Use near-black text on the orange accent unless measured contrast supports another pairing. Pale borders alone are not sufficient to identify focused inputs. Add a strong outline or contrasting border for focus and validation.

Spacing scale: 4, 8, 12, 16, 24, 32, 48, 64, 96px. Mobile gutters 16px, tablet 24px, desktop 40–64px. Content max width 1440px; campaign images may span the viewport.

One readable sans-serif with optional condensed display family. Use licensed assets and only necessary weights. Hero headings 36–56px mobile / 64–112px desktop; section headings 28–48px; body 14–16px, inputs at least 16px. Use fluid values and check actual wraps. Uppercase is for short campaign/navigation labels, not every paragraph.

## Responsive composition

Mobile <768px, tablet 768–1023px, desktop ≥1024px are layout conventions, not assumptions about device capability. Grid: two product columns on phones, three on tablets when space permits, four on desktop. At 320px allow one column if two cards make text or controls unusable. Crop product imagery at 3:4 with explicit dimensions.

Header approximately 64px on mobile / 80px desktop, plus a separate compact announcement strip. Keep sticky offsets shared so anchors and drawers are not hidden. Use safe-area padding for bottom controls. Ensure 200% zoom reflow.

## Homepage order

1. Static announcement strip with one message and destination.
2. Sticky header, wordmark, navigation and utility controls.
3. Single campaign hero; no automatic slideshow.
4. Shop-by-category image tiles, four to six items.
5. New arrivals, up to eight product cards and View all.
6. Collection story with split or full-width imagery.
7. Featured products, four to eight curated cards.
8. Optional shop-the-look editorial section when suitable assets exist.
9. Structured footer; show newsletter only when a real subscription integration is configured. Fixture previews may label it inactive.

Alternate image-led and product-led sections. Avoid repeating one template for every section. Use CONTENT.md for copy and destinations.

## Hero

Default is a strong photograph or short muted video. Aim for 70–85svh desktop and 60–75svh mobile, capped to preserve readability and avoid excessive blank areas. Provide separate mobile composition/crop. Place title and CTA in negative space rather than across faces or garment details. Use a local gradient scrim only to secure legibility.

CTA and meaningful content are visible immediately. Optional headline entrance: opacity plus 12–20px translation. Image motion must be barely perceptible, pauseable when sustained, and absent under reduced-motion preferences. Poster image must work without video loading.

## Header and overlays

Desktop menu opens on click/keyboard; hover can be an enhancement. Mobile drawer has navigation groups, search access, wishlist and a close control. Search may open a labelled panel containing a normal form. Only one modal overlay is active at a time; close the current overlay before opening another. Trap focus, lock background scroll, support Escape and return focus to the originating control.

Cart drawer slides from the right on desktop; use full width or nearly full width on mobile. Scrolling cart contents and fixed summary must coexist without hiding lines. Cart page remains an alternative for assistive technology or direct navigation.

## Components

Buttons: primary dark fill/light text; secondary outlined; tertiary text link. Minimum practical touch area 44×44px. Distinct hover, focus-visible, active, disabled and pending states. Do not rely on opacity alone to convey a disabled purchase.

Product cards: image, title, price, optional label, colour selection, wishlist; no enclosing card shadow. Product link and utility buttons must not be nested interactives. Essential details are visible on touch devices. Quick add opens variant selection instead of choosing a size silently.

Swatches: colour plus accessible name, visible selection ring/check, and unavailable treatment. Inputs/selects: persistent labels, inline error text and described-by relationships. Size controls: explicit selected/unavailable states, adequate gaps and adjacent guide link.

## Page layouts

Collection: compact introduction, count/sort toolbar, desktop filters or filter popover, mobile filter drawer and product grid. Active chips with remove actions and clear-all. Empty results retain the controls.

Product: desktop gallery on left and purchase panel on right; mobile gallery first, then title/price, colour, size, guide, quantity and purchase. Related products below factual descriptions. Sticky purchase controls are optional and must not cover page content. Gallery supports buttons, keyboard and swipe; do not require gestures.

Cart: readable variant details, quantity/removal and current subtotal. Checkout: one-column mobile form; desktop address/contact form beside sticky order summary. Show shipping availability, fee, tax-inclusive breakdown and final total before a Razorpay payment button. Fixture mode alone uses an explicit demo notice. Do not show a disabled payment form as a finished live checkout.

Supporting pages: narrower readable text column, consistent headings and spacing. Draft policy notices in fixture/test; reviewed real terms are required for live checkout.

## Motion rules

Microinteractions 120–200ms; overlays 200–300ms; hero/reveals 400–650ms. Prefer opacity/transform. Animate section entrances once with small stagger. Avoid scroll hijacking, forced intros, cursor replacements, automatic audio and layout-driven animation. Content remains visible if scripts or animation fail.

Reduced-motion: remove translations, parallax and ambient rotation; static hero poster; instant or short opacity state changes. Sustained auto-moving content includes pause/resume. Focus behavior cannot depend on transition completion.

Optional real garment 3D only after base design acceptance: usable licensed model, dynamic load, visible poster fallback, rendering paused offscreen, plain-text equivalent, separate CTA, pointer-independent shopping and graceful WebGL failure. Never use a placeholder cube as the campaign.

## Visual verification

Inspect 360, 390, 768, 1024 and 1440px, plus 320px and 200% zoom reflow. Check title wraps, model crops, image loading, long names, unavailable sizes, open overlays, empty cart and filter-empty state. Capture representative desktop/mobile screenshots; record any untested browsers. Accessibility checks include keyboard, contrast, screen-reader labels and reduced motion, not only automated scoring.


## Admin workspace

Use a practical light interface with a compact sidebar, page title, contextual primary action and clear save feedback. Reuse typography/tokens but omit ambient animation. Admin density can be higher than the storefront; do not wrap every field in oversized decorative cards. Mobile navigation becomes a drawer and long editors stack vertically.

Overview contains factual cards for orders awaiting fulfillment, low stock and operations needing attention. Empty database means helpful empty states, never invented revenue graphs. Product list shows thumbnail, title, status, price range, available stock and edit link, with search/filter/pagination. On phones use readable stacked rows or bounded horizontal scrolling for genuinely tabular variant data.

Product editor groups: Basics; Images & video; Variants & pricing; Inventory; Size guide; Packaging; Publication. Keep Save draft and Preview visible. Publish has a short validation summary with links to missing fields. Saving a field is distinct from publishing. Show unsaved-changes warnings on navigation and optimistic-concurrency conflicts with reload/compare options.

Variant editor: rows for colour/size, SKU, price, weight and availability. Stock adjustments show on-hand/reserved/available separately and require a reason. Reserved stock is read-only. Do not make a staff user type one variant per disconnected page. Accessible add-colour/add-size controls generate a matrix preview; duplicate combinations are rejected.

Media uploader: drag/drop plus normal file picker, accepted limits, per-file progress, validating/ready/error states, retry, alt text, colour mapping, cover selection and keyboard-accessible reorder. A completed browser upload is not yet a validated/published asset. Draft preview images use protected URLs. Provide descriptive errors rather than raw provider messages.

Order detail: order number and separate payment/fulfillment badges, line items with frozen size/colour/price, customer address, payment summary, shipment actions and chronological audit history. Packing form shows actual weight/dimensions and courier quote. Visually separate Create shipment, Assign tracking number, Download label and Request pickup. Disable unavailable actions with reasons. Unknown provider outcome says Reconciliation pending, with safe status refresh; never display a generic retry that creates a duplicate shipment.

Owner refund form displays captured, already refunded, pending refunds and maximum remaining amount, with reason and confirmation of the exact amount. Staff lacks that action. Return screen tracks requested items, approval, reverse shipping reference, receipt and inspected/restockable quantity. Do not auto-check a refund or restock box on pickup request.

## Customer checkout, receipt and tracking

Checkout contact/address labels remain visible. PIN availability appears inline; estimates are labelled estimates, not guaranteed dates. Loading quote keeps current cart visible and disables payment until a valid total exists. Changed price/stock or expired quote shows a review message and requires confirming the new total.

Payment is handled by Razorpay's checkout. Show submitting/awaiting verification states and prevent repeated sessions. A closed payment window is not a failure screen by default. Receipt queries server state and shows Payment being verified until captured confirmation; no celebratory paid state from URL parameters.

Tracking separates booking, pickup and delivery progress. Highlight exceptions and RTO without presenting them as normal delivered milestones. If no shipment exists, show Preparing your order. Include Last updated and manual refresh when data is stale; avoid aggressive client polling.

Track-order recovery asks for order number and email, then an OTP, with generic request responses to prevent exposing customer orders. Never display full delivery details before ownership verification. Return request form selects purchased items/quantities and reason; show eligible period and policy, not a made-up return guarantee.

## Additional review states

Review empty/admin lists, upload validation failure, unpublished draft, stale admin version, stock reservation conflict, shipping unavailable, changed quote, payment pending, captured-but-held order, AWB success with failed pickup, stale tracking, RTO, and partial refund. Verify each on keyboard and a small phone. A successful screenshot of the hero does not establish that these operational flows work.
