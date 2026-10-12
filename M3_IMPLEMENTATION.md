# M3 — Storefront design and shopping

Scope: T19–T25 only. M2 was approved; APP_MODE remains `fixture`. Stop at M3 review before checkout, payment or shipping implementation.

## Implementation plan

1. Connect a separate responsive customer shell and campaign homepage to published catalog/content. Use the specified YOUR BRAND copy and disclose sample imagery.
2. Implement URL-driven collection/search filtering against the same enabled variant, stable ordering and pagination.
3. Share explicit colour/size selection across product detail and quick add; build gallery, size-guide display and local wishlist.
4. Persist guest carts on the server using opaque cookie capabilities, version checks and current catalog prices. Never reserve inventory in a cart.
5. Add support and approved-policy views; keep newsletter, payments and order tracking unavailable without their later integrations.
6. Run unit/database/HTTP checks and review desktop/mobile, keyboard, reduced motion and narrow/zoom layouts. Record actual results below.

## Review status

Ready for the M3 review checkpoint on 2026-09-28. Implementation stops here; M4 has not started. Review the running fixture storefront at <http://127.0.0.1:3114/>.

The preview uses isolated `work/m3-review/{database,auth,media}` directories outside the app and `APP_URL=http://127.0.0.1:3114`. The normal `.env.local` and `.env.example` remain configured for fixture mode on localhost:3000. Both contain no provider credentials. All ten original files in `docs/spec/` still byte-match the supplied archive.

## Delivered scope

| Task | Result |
| --- | --- |
| T19 | Responsive customer shell, design tokens, YOUR BRAND wordmark, mobile navigation, search/cart/wishlist controls, skip link and truthful fixture notices. |
| T20 | Animated campaign hero, category links, arrivals, story and featured products. Published imagery replaces labelled placeholders; lookbook appears only when supplied. Videos play only on user request. |
| T21 | Collections and search with URL filters, stable sorting/pagination, matching-variant prices and availability, mobile Apply/discard behavior, empty/error states and actual HTTP 404 responses. |
| T22 | Product gallery, colour/size selection, explicit size requirement, size guide, availability, related products and shared quick-add purchase logic. Gallery keyboard/swipe handlers preserve native video controls. |
| T23 | Server-persisted guest carts with opaque HttpOnly cookies, hashed capabilities, expiration, version conflicts and current catalog prices; quantity/removal controls, cart drawer/page and local wishlist. |
| T24 | About/contact/size-guide/policy routes and Track order entry. Unpublished business information is identified as unavailable. Newsletter, order recovery and checkout await later integrations. |
| T25 | Desktop/mobile/320px, keyboard and narrow reflow reviews completed; screenshots saved below. Actual browser zoom and an emulated reduced-motion preference were unavailable in the browser tool and remain explicitly unchecked below. |

Cart changes validate stock and prices on the server without reserving inventory. Unavailable or extreme-price items remain removable, and stale mutations return the current cart for review. Published media projections omit private metadata and unpublished posters. Dialogs trap Tab focus, close on Escape and restore focus after both product-page and quick-add actions.

## Verification

- [x] `npm run check:env`: fixture mode and local application URL.
- [x] `npm run typecheck`: passed.
- [x] `npm test`: 65 passed, 0 failed.
- [x] `npm run test:db`: eight migrations, six SQL assertion files, fixture/public projection parity and generated database types passed.
- [x] `npm run build`: final Webpack production build and TypeScript checks passed after the gallery input fix.
- [x] `npm run test:m2` and `npm run test:http`: existing admin, authentication, media and HTTP regression checks passed against isolated fixture servers.
- [x] `M3_TEST_URL=http://127.0.0.1:3114 node scripts/test-m3-http.mjs`: passed on the final build. Covers 21 storefront pages, four actual 404s, metadata, matching-variant API prices, image optimization and the cart HTTP suite.
- [x] Cart HTTP/SQL coverage: capability isolation and expiry/revocation, current prices, stale versions, stock/unpublished variants, bounded JSON, origin checks, quote invalidation, pending-order guard and safe removal.
- [x] Browser journey: home → collection → product → cart; size-required validation, sold-out sizes, colour changes clearing unavailable sizes and shared quick add.
- [x] Cart quantity/reload/removal/empty states; wishlist reload/removal/empty states. Browser review cart and wishlist were cleared after testing.
- [x] Mobile filters discard on Escape, apply to URL, display the matching Stone shirt price and reset with browser history.
- [x] Keyboard modal focus wraps in both directions, Escape closes, and focus returns to the originating Add/Choose size control. Mobile navigation is usable.
- [x] Layout reviewed at 320, 360, 390, 720, 768, 1024 and 1440 CSS pixels across the storefront surfaces. No horizontal page overflow in those checks; the 320px cart remains usable.
- [x] 720 CSS-pixel reflow reviewed as the layout-width equivalent of a 1440px viewport at 200% zoom. This does not certify browser zoom behavior.
- [x] Reduced-motion source review: storefront motion has `prefers-reduced-motion: reduce` overrides; videos do not autoplay.
- [x] Final browser console review returned no errors or warnings.
- [ ] Actual 200% browser zoom: not exercised; the in-app browser exposes viewport sizing but no zoom control.
- [ ] Runtime reduced-motion preference: not emulated by the available browser tool; needs a manual preference check.
- [ ] Native Playwright browser harness: macOS blocked its Chromium launch; supported in-app browser checks were used instead.
- [ ] Hosted Supabase/R2 and concurrent hosted database integration: not exercised in fixture mode.

## Review screenshots

- [Desktop homepage, 1440px](review/m3/home-1440.png)
- [Filtered collection, 390px](review/m3/collection-390.png)
- [Cart drawer, 320px](review/m3/cart-320.png)
- [Collection reflow, 720px](review/m3/collection-720.png)

## Review limits and next checkpoint

Neutral fixture imagery is intentional. Approved product/campaign photography, final brand assets, measured guides and business policies are still needed before launch. No business guarantees, discounts, ratings or contact information have been invented. Optional lookbook and newsletter content stay hidden until their inputs/integrations exist.

Run one process per PGlite fixture directory. These local results do not certify hosted provider behavior or multi-process concurrency. No real payment, shipment, email or deployment was performed. Stop for the user's M3 review before beginning M4 quotes, reservations or payments.
