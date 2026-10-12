# T05 — official contract review

Reviewed 24 September 2026. This is documentation verification, not an integration test. No provider credentials, account changes, shipment bookings, payment operations or email sends were used.

| Component | Verified documentation and implementation consequence |
| --- | --- |
| Next.js | Current App Router installation requires Node ≥20.9 and TypeScript ≥5.1. NEXT_PUBLIC values become browser-visible and are frozen at build time. Preserve server-only boundaries; select/pin actual app versions when scaffolding is authorized. [Installation](https://nextjs.org/docs/app/getting-started/installation), [environment variables](https://nextjs.org/docs/app/guides/environment-variables). |
| Supabase | Cookie-based SSR uses `@supabase/supabase-js` with `@supabase/ssr`. Publishable keys belong in public configuration; secret/service-role keys bypass RLS and stay server-side. Legacy anon/service_role keys remain supported. [SSR client](https://supabase.com/docs/guides/auth/server-side/creating-a-client), [API keys](https://supabase.com/docs/guides/getting-started/api-keys). |
| Cloudflare R2 | JavaScript examples use `@aws-sdk/client-s3`, `S3Client`, region `auto`, the account's S3 endpoint and access credentials. Compatibility has documented differences. Use private staging/documents and a separate public media bucket; do not infer public-read URLs from signed S3 operations. [S3 setup](https://developers.cloudflare.com/r2/get-started/s3/), [compatibility](https://developers.cloudflare.com/r2/api/s3/api/). |
| Razorpay | The Node SDK is `razorpay`. Create orders server-side; verify Checkout signature using the stored order ID, payment ID and API secret. Webhooks separately use `X-Razorpay-Signature` with HMAC-SHA256 over raw bytes and the webhook secret. Test Mode simulates payments and supports test webhooks. [Node integration](https://razorpay.com/docs/payments/server-integration/nodejs/integration-steps/), [webhook verification/testing](https://razorpay.com/docs/webhooks/validate-test/). |

## Shiprocket logistics

Official sources: [Shiprocket's API collection](https://www.postman.com/shiprocketdev/shiprocket-dev-s-public-workspace/documentation/qu05zax/shiprocket-api), [authentication helpsheet](https://shiprocket.freshdesk.com/support/solutions/articles/43000337456-api-document-helpsheet).

- API-user email/password authenticates via `POST https://apiv2.shiprocket.in/v1/external/auth/login`. Documentation gives JWT validity as 10 days; subsequent requests use `Authorization: Bearer …`. Future implementation must still handle expiry/auth failures and redact credentials/tokens.
- Documented tracking routes include `GET /v1/external/courier/track/awb/{awb_code}`, `GET /v1/external/courier/track/shipment/{shipment_id}`, and `GET /v1/external/courier/track?order_id=…&channel_id=…`.
- Logistics tracking webhooks use JSON POST with a configurable `x-api-key` token. It is optional provider-side; this application will require its configured token before enabling the webhook. No HMAC contract was verified. Verify shipment mapping and use authoritative retrieval when trust is insufficient.
- The collection requests an HTTP 200 response and says callback URLs must not contain `shiprocket`, `kartrocket`, `sr` or `kr`. This conflicts with the original planned `/api/v1/webhooks/shiprocket` route. At the authorized webhook implementation step, select a compliant callback path, verify it against the account, and update API.md plus the implementation together. No route is implemented here.
- The collection warns that requests using valid credentials affect actual account data. A separate shipping sandbox URL/contract was not established by this review. `APP_MODE=test` therefore keeps Shiprocket disabled. A marketing mention of a sandbox is insufficient to authorize shipping requests.

Shiprocket's separate fastrr Checkout product has a [Checkout webhook support page](https://support.shiprocket.in/support/solutions/articles/152000000918-sr-checkout-webhooks). That page does not establish the logistics webhook signature contract. Keep these products distinct.

## Still unverified

Actual account permissions/activation, webhook payloads/headers, enabled payment methods, test facilities, credentials, isolation between environments, and SDK/runtime behavior remain untested. No Supabase, AWS/R2, Razorpay or Shiprocket SDK is installed. Recheck these details at the relevant later task; do not treat fixture success as provider verification or deployment approval.
