# Sitemap, Access and URL Contract

Version 2.0 · 23 September 2026

Customer store and admin share one Next.js application and domain. Page routes below are distinct from `/api/v1` server endpoints in API.md. Never use a route's obscurity as an authorization mechanism.

## Customer routes

- `/` — homepage.
- `/collections` — collection directory.
- `/collections/[slug]` — filtered/sorted products.
- `/products/[slug]` — product details; optional `?variant=<uuid>`.
- `/search?q=...` — catalog search and filters.
- `/wishlist` — local saved product IDs.
- `/cart` — current guest cart.
- `/checkout` — address, server quote and Razorpay payment; fixture mode clearly identified.
- `/orders/[id]` — owned receipt, verification-pending or confirmed state; never a public order endpoint.
- `/orders/[id]/tracking` — protected shipment timeline.
- `/orders/[id]/returns/new` — protected policy-eligible return request.
- `/track-order` — existing-session lookup or email OTP recovery using order number/email.
- `/auth/callback` — Supabase recovery/session callback if needed by the chosen OTP flow; strict same-origin redirect allowlist.
- `/about`, `/contact`, `/size-guide` — supporting content.
- `/policies/shipping`, `/policies/returns`, `/policies/privacy`, `/policies/terms` — reviewed policy content in live mode; draft in fixture/test.

Missing/draft/archived product or unknown collection returns an actual 404. Order access without ownership leads to verification or a generic not-found/denied state without leaking whether another customer's order exists. Checkout with empty cart returns useful empty state. No standalone public `/payment-success` that trusts URL parameters; receipt reflects server order state.

## Admin routes

- `/admin/login` — Supabase admin sign-in.
- `/admin/forgot-password`, `/admin/reset-password` — supported reset flow; no public admin registration.
- `/admin` — operating summary: awaiting fulfillment, attention items, low stock and recent orders; all from real data.
- `/admin/products` — searchable product list by status/category.
- `/admin/products/new` — draft creation.
- `/admin/products/[id]` — content, variants, media, size guide and publication.
- `/admin/products/[id]/preview` — authenticated draft storefront preview; private/no-store/noindex.
- `/admin/inventory` — SKU/variant on-hand, reserved, available and adjustment history.
- `/admin/collections`, `/admin/collections/[id]` — new/edit ordered collection memberships.
- `/admin/media` — assets/status/usage; private draft previews.
- `/admin/size-guides` — create/edit measurement guides.
- `/admin/orders`, `/admin/orders/[id]` — order/customer/payment/packing/shipment panel.
- `/admin/returns`, `/admin/returns/[id]` — review and inspection.
- `/admin/content` — homepage draft/publish editor.
- `/admin/settings` — owner-only brand, warehouse, packaging, shipping/tax and policy settings.
- `/admin/operations` — failed/unknown/retrying payment, shipping, upload and notification operations.

Product/collection creation may use the listed page or an accessible form dialog; all transitions must have a working destination. Refund action is inside order detail and owner-only. Staff sees only permitted settings/actions, but server authorization applies regardless of rendering.

## Navigation

Header: wordmark → `/`; New Arrivals → `/collections/new-arrivals`; Men/Women/Accessories → matching collections; Collections → directory. Utilities: search, wishlist, cart. Footer adds Track order and supporting pages. No customer account icon until an account dashboard exists.

Admin sidebar: Overview, Products, Inventory, Collections, Orders, Returns, Media, Homepage, Size guides, Operations, Settings. Collapse to drawer on mobile. Keep separate visual shells; return-to-store link opens public homepage without losing unsaved edits silently.

Breadcrumbs: Home → category collection → product; admin uses section → resource. Never trust a referrer to determine access or breadcrumb labels.

## Collections and URL query rules

Required initial slugs: `all`, `new-arrivals`, `men`, `women`, `accessories`, `oversized-tees`, `hoodies`, `cargos`, `shirts`, `everyday-uniform`, `featured`. Collections own explicit product membership/order; Men/Women are merchandising labels, not purchase restrictions.

```text
q=washed                       # search only
category=oversized-tees         # repeat for OR values
size=M&size=L
color=black&color=stone
minPrice=50000&maxPrice=200000   # integer paise
inStock=true
sort=featured                  # featured|newest|price-asc|price-desc
page=1                         # page size 12
```

Groups use AND; within-group values OR. Size/colour/price/availability must match one enabled variant. Public availability uses on_hand minus reserved. Card displayed minimum and price sort use the same matching variants. Collection featured sort uses membership order; otherwise featured rank. Always apply stable ID tie-breaker.

Parse with URL APIs, dedupe values and ignore unknown enum values. Invalid sort/page resets to default; negative/malformed price bounds ignored, reversed valid range gets a correction message. Filter/search/sort changes reset page1. Clamp out-of-range page; zero results has page1. Mobile filter drafts commit only on Apply; browser back restores controls/results.

Valid product variant parameter selects its colour/size (including sold-out display); invalid/wrong-product IDs are ignored. With no parameter, first colour is shown but size is explicit. Product variant changes replace history rather than creating dozens of back entries.

## Indexing and privacy

Fixture/test environment: entire site noindex. Live public catalog/support pages receive meaningful metadata; approved canonical product/collection URLs in sitemap.xml. Cart, checkout, orders, tracking verification, auth and every admin route stay noindex and private responses no-store. Filter combinations should not generate unlimited indexed duplicates; canonicalize to base collection/search policy. No order address/PII or tokens in analytics, logs, page titles or shareable query strings.
