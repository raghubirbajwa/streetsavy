# Clothing store — M6 fixture verification

M0–M5 are implemented and M6 has been checked as far as the local fixture environment permits. `APP_MODE=fixture` remains set in `.env.local` and `.env.example`; no provider credentials are included. **Stop for review. Nothing was deployed.** Browser, real-account, client-content and infrastructure requirements remain **BLOCKED**; this is not approval for live sales.

See [M6_READINESS.md](M6_READINESS.md) for Q01–Q15, actual command results, repeatable local checks and verification limits. [M6_BLOCKED_INPUTS.md](M6_BLOCKED_INPUTS.md) lists what is needed next. [M6_ACCESS_CATALOG_MEDIA.md](M6_ACCESS_CATALOG_MEDIA.md) and [M6_MONEY_OPERATIONS.md](M6_MONEY_OPERATIONS.md) record focused regression coverage.

[M5_IMPLEMENTATION.md](M5_IMPLEMENTATION.md), [M5_SHIPPING_VERIFICATION.md](M5_SHIPPING_VERIFICATION.md), [M5_RETURNS_VERIFICATION.md](M5_RETURNS_VERIFICATION.md) and [M4_HOSTED_VERIFICATION.md](M4_HOSTED_VERIFICATION.md) retain implementation and real-account procedures. M0–M4 notes, [ADMIN_SETUP.md](ADMIN_SETUP.md) and [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) are historical checkpoints; the original specifications remain unchanged in `docs/spec/`.

## Start locally

Use Node.js 22.16+ (checked with 24.20.0) and npm (11.19.0 used here):

```sh
npm ci --ignore-scripts --no-audit --no-fund
APP_MODE=fixture npm run prepare:m5
npm run build
npm start
```

Open `http://localhost:3000` for the storefront. The explicit preparation command adds a labelled sample warehouse/parcel and zero sample tax where configuration is absent, and sets the local return window to a **14-day sample policy**. Run it with the server stopped, preferably against a fresh fixture directory. These are development examples, not approved business inputs. At `/admin/login`, choose Demo owner or Demo staff; Demo customer demonstrates denied admin access. Keep `APP_URL` equal to the browser origin because mutations enforce same-origin requests. If `.env.local` is absent, copy `.env.example` without overwriting an existing environment file.

`npm run dev` is also available. This host hit filesystem-watcher limits in development and a Turbopack sandbox port restriction, so the production build uses Next's supported Webpack builder.

## Fixture persistence

First fixture access migrates a local PGlite database and seeds the sixteen deterministic demo products. Product/content/settings edits and guest carts persist in `.fixture/database`; uploads and canonical media stay in `.fixture/media`, outside Next's public directory. Opaque admin fixture sessions are hashed in `.fixture/auth.json`; guest cart capabilities are hashed in the database and expire after 30 days. Restarting the server preserves data and does not reseed it. Startup never seeds a hosted test/live database.

## Review the storefront

1. Follow the homepage edit into a collection, filter by colour/size/price/availability, and use sorting and pagination. Filters share URL state; mobile selections apply only when submitted.
2. Open a product or Choose size panel. Select a colour and explicit size, then add to cart. No size is silently selected, including One size accessories.
3. Change quantities or remove a line in the cart drawer/page. Reload to confirm server persistence. A second tab's stale mutation returns the current cart for review.
4. Save products to the local wishlist. Invalid or unavailable saved IDs are handled without exposing unpublished products.
5. Review support/policy pages. Only approved, published policy/contact content is displayed. Sample imagery is labelled; no discounts, measurements, guarantees or business details are invented.

The fixture homepage uses CONTENT.md's sample campaign when no published homepage exists. Publishing a homepage replaces that fallback; test/live modes never inject the fixture campaign. Collection covers, campaign media and product images use published-only media projections. Newsletter remains hidden. Checkout and order recovery work as clearly labelled fixture simulations; no real inbox is verified in fixture mode.

Run **one application process per fixture data directory**. PGlite is an embedded local review database, not the hosted deployment database. Multi-process locking and real Supabase Auth/PostgREST remain separate integration checks. Test harnesses use their own temporary directories. Trusted local overrides `FIXTURE_DB_DIR`, `FIXTURE_AUTH_DIR`, and `FIXTURE_MEDIA_DIR` are available to isolate previews; never point multiple servers at the same directory.

## Review checkout

Checkout uses a minimal shell (logo + back to cart, no store nav/footer). Delivery is on the left; the grey column shows line thumbnails and the server total.

1. Add an available option to your cart, open `/checkout`, and enter sample Indian address details. Choose **Continue to payment**. PIN `999999` simulates unserviceable delivery; `888888` simulates a provider outage.
2. Review shipping, tax-inclusive total, and **Pay now**. Fixture mode skips Razorpay and opens the order receipt. Try capture, authorization only, failure, or lost confirmation. Refresh payment status to reconcile. Closing Razorpay (or the page) leaves the order pending; resume from the cart or receipt.
3. Only captured payment confirms the order and deducts stock. Cancellation of a known unpaid checkout releases its reservation; uncertain or late payments stay held for review. A failed payment reuses the existing order.
4. At Track order, enter the order number and sample email. Use the displayed fixture code; this does not send email or verify an inbox. Another browser without the receipt capability or successful recovery is denied access.
5. In `/admin/operations`, review payment holds, uncertain operations, failed jobs and the notification outbox. Fixture notifications truthfully remain unconfigured.

To open the real Razorpay **Test Mode** modal instead of fixture simulation, set `APP_MODE=test` with isolated Supabase keys and `rzp_test_` credentials in `.env.local`. See comments in `.env.example` and [M4_HOSTED_VERIFICATION.md](M4_HOSTED_VERIFICATION.md). Do not put live keys in the review app.

## Review fulfillment

1. Capture a fixture payment, then open its order in `/admin/orders`. Enter actual sample packing measurements (for the default sample parcel: 1200 g, 40 × 30 × 15 cm), get courier quotes, and select a quote. The customer total remains frozen.
2. Create the shipment, assign its AWB, generate/download its private fixture label, and request pickup as separate steps. Use the fixture control to fail the next pickup, then retry the missing step; the shipment and AWB remain the same. The label is not a usable courier label.
3. Use fixture tracking controls to simulate delivery or RTO. The customer timeline requires the original order capability or successful recovery. RTO or failed delivery does not add inventory.
4. A customer may cancel before physical collection, or request an eligible return after delivery. At `/admin/returns`, approve the requested quantities, record a manual reverse reference, receive and inspect the items, then explicitly restock only sellable accepted units. This is separate from refunding.
5. As Demo owner, request a partial or remaining refund with a reason. It starts pending; fixture confirmation controls can simulate success or an uncertain timeout. Unknown/pending amounts reserve the balance. Staff cannot initiate refunds. A refund never restocks inventory.
6. Reconcile unknown operations in `/admin/operations`. Audited manual resolution only clears holds whose stored evidence passes the server rules; it cannot mark a provider action paid, shipped or refunded by assertion.

## Review the admin

1. Owner: add an active packaging preset in Settings; keep tax/business policies unconfigured until actual inputs are supplied.
2. Create a product draft; add colour/size variants with unique SKUs, integer paise prices and gram weights.
3. Create/choose a measured size guide for sized clothing, assign compatible packaging, and record stock adjustments with reasons.
4. Upload JPEG/PNG/WebP/AVIF or a supported MP4, wait for validation, record alt/source/license details, and save its gallery order/colour/cover.
5. Preview privately, then publish. The public record at `/api/v1/products/<slug>` updates without rebuilding. Archiving hides it while preserving stock and order history.
6. Edit/publish collections and homepage content. New cover/hero assets may publish directly from private ready media. Owner settings include warehouse, packaging, courier-quote/flat/threshold shipping fees, inclusive-tax configuration and policies.

Media limits, R2 CORS setup, signing, canonical validation and retry/cleanup details are in [src/lib/media/README.md](src/lib/media/README.md). MP4 validation needs maintained `ffprobe` and `ffmpeg` on PATH, or trusted absolute `FFPROBE_PATH` / `FFMPEG_PATH`. Missing video tools fail closed; image uploads still work.

## Verify

```sh
npm run check:env
npm run lint
npm test
npm run test:db
npm run build
npm run typecheck
npm run check:secrets
npm run test:http
npm run test:m2
M3_TEST_URL=http://localhost:3000 node scripts/test-m3-http.mjs
M4_TEST_URL=http://localhost:3000 npm run test:m4
M5_TEST_URL=http://localhost:3000 npm run test:m5
```

`test:db` executes all migrations and SQL assertions in a fresh in-memory PGlite database with test-only Supabase auth/role shims. It checks generated database types, fixture/public-projection parity and permissions. Run `npm run types:db` after a schema change. `test:http` and `test:m2` start/stop isolated production servers on ports 3108 and 3110 (overridable); they require localhost permission.

Browser checks Q09–Q10 are **BLOCKED**: browser-control permissions were pending and have not been confirmed granted. The legacy `test:browser` harness was not run as part of M6. HTTP rendering does not establish visual, keyboard, responsive or hydration behavior. Follow the manual/browser checklist in `M6_READINESS.md`.

## Hosted boundaries

Outside fixture mode, Supabase provides identity and PostgreSQL; R2 provides private staging and public immutable objects. Integration gates reject missing configuration and disable all real provider operations in fixture mode. Apply migrations in filename order and follow trusted owner bootstrap instructions before hosted testing. R2 signing/CORS code is implemented but no bucket, CORS rule or hosted upload was created or tested here.

Real branding/photos/measurements, pickup/packaging details, tax and policy approvals remain outstanding. `/api/v1/internal/jobs/run` processes separate leased checkout, shipping and returns/refund queues; fixture review runs it explicitly. Hosted operation needs an authenticated external scheduler with enough repeated invocations to drain due work. Shared deployment rate limiting, real scheduler/cleanup operation and hosted concurrency remain pending. `APP_MODE=test` uses real Razorpay Test Mode when configured but simulates courier dispatch; Shiprocket has no assumed free sandbox. Real carrier checks need separately authorized access. M6 fixture verification stops for review; hosted gates remain **BLOCKED**. No real payment, refund, shipment, email or deployment was performed.
