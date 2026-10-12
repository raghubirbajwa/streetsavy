# Technology Stack and Engineering Conventions

Version 2.0 · 23 September 2026

## Selected architecture

- Next.js App Router, React and TypeScript: public storefront, admin UI, server services and Route Handlers in one repository.
- Tailwind CSS: tokens and responsive styling from DESIGN.md; CSS for basic motion.
- Supabase PostgreSQL: products, variants, inventory, orders, payments and shipping records. Supabase Auth: admin sessions and optional verified email order recovery.
- Cloudflare R2: private staging/private documents and public catalog media. Use separate buckets/permissions for public assets and sensitive labels/drafts.
- Razorpay Standard Checkout: prepaid INR payments; server creates/verifies orders and captures according to the configured account setting.
- Shiprocket: shipping serviceability, quotes, bookings, AWB/labels, pickup and tracking through a server adapter.

These services are selected product requirements, not evidence that accounts are configured. Use existing compatible project versions; for a new project verify stable compatibility and pin dependencies/lockfile when coding. Do not upgrade unrelated projects.

## Backend approach

Use `@supabase/supabase-js` and `@supabase/ssr`; distinct browser and request-scoped server clients. Follow the actual Next.js version's cookie/session-refresh convention (`proxy.ts` for 16+, `middleware.ts` for older supported versions). Validate claims/user server-side and check current admin membership per operation. Never treat a cookie read or client context role as proof.

Use SQL migrations in `supabase/migrations`, generated TS types and restricted transaction RPCs. No Prisma requirement for this project. Use a small server-only service layer for catalog/order/payment/shipping logic shared by Route Handlers and server rendering. Client code receives DTOs, not raw private database rows.

Service-role/secret credentials bypass RLS: expose them only to explicit trusted server modules after authorization. Never export a privileged client from a shared client-importable file. Use `server-only` boundaries. Keep payment and admin routes uncached; only cache public projections and invalidate them on publication/archive/stock changes as appropriate.

## Suggested repository layout

```text
src/app/(store)/                  storefront pages
src/app/admin/                    protected admin routes and login
src/app/api/v1/                   public, guest, admin, webhook and job handlers
src/components/store/             gallery, cards, cart, checkout
src/components/admin/             product editor, variant grid, order panel
src/components/ui/                genuinely shared controls
src/lib/supabase/                 server/browser/privileged clients
src/lib/auth/                     admin permissions and guest/order access
src/lib/catalog/                  catalog queries and public projections
src/lib/orders/                   checkout, state changes, reservations
src/lib/integrations/             R2, Razorpay, Shiprocket, notification adapters
src/lib/jobs/                     leases, handlers, reconciliation
src/lib/validation/               schemas and DTOs
src/config/                      validated app/brand/environment settings
src/data/fixtures/                16 demo products and provider scenarios
supabase/migrations/              versioned schema/RLS/RPC changes
tests/                           meaningful unit, integration and browser tests
```

Paths are conventions; adapt existing organization. Avoid unused abstractions/hooks/global state. A small cart context and local UI state are enough unless the implementation proves otherwise. Filters live in the URL; server cart owns commerce state; wishlist may use validated local storage.

## Environment contract

Application-chosen names below; document exact implementation in `.env.example` with empty/sample values only. Validate required variables at startup/feature entry. Never show secrets in admin, logs or README.

```dotenv
APP_MODE=fixture
APP_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_STAGING_BUCKET=
R2_PUBLIC_BUCKET=
R2_PRIVATE_BUCKET=
R2_PUBLIC_BASE_URL=
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
SHIPROCKET_API_EMAIL=
SHIPROCKET_API_PASSWORD=
SHIPROCKET_WEBHOOK_TOKEN=
JOBS_SECRET=
TRANSACTIONAL_EMAIL_PROVIDER=
TRANSACTIONAL_EMAIL_API_KEY=
TRANSACTIONAL_EMAIL_FROM=
```

If the existing Supabase project uses legacy keys, map its server service-role key appropriately; do not expose it as a publishable key. R2 private/staging buckets may be one nonpublic bucket with isolated prefixes; public bucket must remain separate. Razorpay Key ID is returned to checkout when needed; the secret never is. Shiprocket webhook token is only applicable if the account's documented mechanism uses it; do not infer a signature algorithm from this variable name.

Pickup location, packaging and shipping fee/tax policy belong in validated database settings, not hidden hardcoded UI constants. Supabase transactional Auth OTP delivery uses its configured production email setup; store order/shipment notifications use NotificationService with a selected email provider. Until configured, record unsent jobs accurately; no fake subscription/order email success.

## Runtime and jobs

Use a Node-compatible runtime for provider SDKs and media validation. Hosting must support SSR/API routes, HTTPS webhook endpoints and a reliable scheduler/worker. Cloudflare R2 does not imply the app is already deployed on Workers. Choose deployment target later and verify adapter/runtime compatibility; don't create a static export for a server-dependent store.

Durable Postgres jobs are sufficient initially: short cron invocations claim bounded work with leases, perform remote calls, then commit results. Choose limits below platform request timeouts; longer media validation belongs in an appropriate worker. A separate Redis queue is not automatically needed. No browser-driven queue processing, in-process cron in a sleeping server, or fire-and-forget payment tasks.

Use SDK clients on the server, request timeouts, bounded retry and redacted error logging. A timeout after remote creation is `unknown`, not proof of failure. Payment/refund/shipment operations must reconcile before retries that might duplicate side effects.

## Media delivery

Server signs short-lived R2 S3 endpoint PUT URLs; configure browser CORS narrowly to app origins. R2 presigned operations and public custom-domain reads have different URLs. After upload, verify actual type/size/dimensions/duration before ready state. Store keys and derive public URLs. Public media custom domain is the production delivery path; keep labels/order documents private.

Use Next.js Image with explicit remote patterns, dimensions and responsive sizes. R2 stores bytes; it does not automatically produce responsive images or adaptive video streams. Optimize images through the chosen image pipeline and pre-encode short MP4s/posters. Cloudflare Stream is optional later for managed encoding/streaming.

## Testing and deployment discipline

Reuse the repository package manager and testing tools. Unit-test money/filter logic; Postgres integration-test RLS, stock and concurrency; adapter-test external errors; browser-test full admin/customer paths. Test payment webhooks with raw signed payloads and Razorpay test transactions. Fixture Shiprocket until a real safe test path is confirmed; do not buy postage in routine CI.

Separate dev/test/live projects/buckets/keys, or provide equally strict documented isolation. Never seed demo stock/orders into live. Keep APP_MODE independent from NODE_ENV so a production build of staging remains test mode.

At handoff include actual setup commands, migration order, owner bootstrap, scheduler configuration, test results and backup/restore/rollback steps. Restrict public indexing to approved production catalog pages. No live transactions or deployment without corresponding authorization.

## Official references

Use [Next.js data security](https://nextjs.org/docs/app/guides/data-security), [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/nextjs), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/), [Razorpay integration](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/), and [Shiprocket developer documentation](https://www.shiprocket.in/developers/). Relevant entry points checked 22 September 2026; exact SDK versions/account configuration must be verified when implementing.
