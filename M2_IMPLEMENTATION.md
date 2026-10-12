# M2 — Catalog, media and operating admin

Completed for fixture review on 26 September 2026. Authorized scope: T12–T18 only, following the approved M1 foundation. APP_MODE remains fixture. M3 is not started; stop here for user review.

## Implemented

- **T12:** Search/status/category product list, creation and editing, private saved preview, explicit publish/archive, expected-version conflicts. Failed saves preserve client edits. Content/variant/packaging/gallery edits return a published product to draft. Public reads are dynamic and uncached; archive retains product/variant records and order snapshots.
- **T13:** Colour/size row generator, unique SKU and colour/size validation, integer paise prices, gram weights, compare-at validation, tax-category fields, enabled/disabled variants, measured size-guide editor and compatible packaging assignment. Publication requires size rows covering enabled clothing sizes. Omitted persisted variants are disabled, not deleted.
- **T14:** Atomic inventory adjustment with version check, reserved-stock floor, required reason, actor-scoped idempotency and append-only stock/audit history. On-hand, reserved and available quantities are displayed separately.
- **T15:** Five-minute private upload tickets, canonical image/MP4 byte validation, size/dimension/duration limits, validation leases, safe identical retries, bounded orphan cleanup, and an R2 signing/storage adapter behind the integration gate. Fixture objects live outside Next's public directory. R2 CORS instructions are documented; no hosted policy was applied.
- **T16:** Authenticated expiring previews, alt/source/license/focal/poster editing, ordering/colour/cover controls, immutable publication copies and exact-key public asset lookups. Failed copying leaves retryable state. Published/referenced media cannot be destructively removed. Gallery/media edits remain visible on conflicts; publication is disabled while local gallery edits or uploads are pending.
- **T17:** Versioned collections and homepage drafts with explicit publication, ordered product/navigation references, hero, announcement, brand story and lookbook fields. Private drafts preserve the prior published content. New ready cover/hero media can publish directly without first belonging to a product. Final entity publication commits media visibility transactionally. Public home content is withheld if its references subsequently become unavailable.
- **T18:** Owner-only warehouse, measured packaging, courier-quote (default)/flat/threshold shipping fee settings, tax-inclusive configuration, policy/contact publication and redacted audit history. One active warehouse is enforced. Unconfigured tax and business policies remain explicit; no values are invented.

## Implementation layout

Three M2 migrations follow the two M1 migrations: `202609250001_catalog.sql`, `202609250002_media.sql`, and `202609250003_content-settings.sql`. Generated Supabase types reflect the complete schema.

`src/lib/admin/` provides validated service contracts, SQL transport and content/settings services. All write/read RPCs check active membership independently; owner-only settings check owner role. App routes verify identity and current membership before invoking them. Request JSON is bounded while streaming, requires same origin and returns safe error codes/details.

In fixture mode, `src/lib/admin/db.ts` initializes/seeds one persistent local PGlite database and runs the same RPCs used by the hosted adapter. Startup does not contact or seed hosted services. It applies every migration, including filenames containing hyphens; regression coverage checks the settings RPC is available from the fixture runtime. Calls are serialized within the process, and current fixture membership revocations are refreshed for every operation.

Product/media/size-guide screens are under `/admin/products`, `/admin/media`, `/admin/size-guides`; collection, home and owner settings screens are under `/admin/collections`, `/admin/content`, `/admin/settings`. Minimal public detail/content/settings/media endpoints support the M2 exit check; the storefront and shopping flow remain M3 work.

## Verification performed

- `npm run check:env`: reports fixture mode and the configured localhost origin; no credentials.
- `npm run typecheck`: passed. Production build also completes its TypeScript checks.
- `npm test`: **48 tests passed**. Includes real embedded database workflows, fixture persistence across reopen, privilege-field rejection, versions, stock dedupe, actual PNG decode/canonicalization, actual H.264 MP4 validation, signed-preview expiry/identity binding and simulated publication-copy failure/retry.
- `npm run test:db`: **all five migrations and five SQL assertion suites passed**, plus trusted-owner bootstrap and deterministic public-projection parity. Includes RLS/grants, reserved-stock floor, media cleanup/leases/references, private drafts, owner-only configuration, archive retaining an actual order's financial/item snapshots, and no public draft/private-data projection.
- `npm run build`: passed with **Next.js Webpack**. Turbopack could not bind its compiler port in this sandbox, so the package build script selects the supported Webpack builder.
- `npm run test:http`: M1 authentication regression suite passed on an isolated production server.
- `npm run test:m2`: passed on an isolated production server. A staff session creates a draft and variant, adjusts stock, uses owner-created packaging, uploads actual PNG bytes, validates/annotates/attaches/publishes the image, reads the newly public product/image without rebuilding, then archives it and verifies stock/history retention. Also tests a separately uploaded collection cover, homepage draft isolation, authorization, same-origin/oversize failures, conflict codes and every M2 admin page.
- In-app browser: owner sign-in, new product draft save, colour/size variant generation/save, incomplete-publication feedback, 390px product list and 320px settings layout checked. Final desktop catalog and narrow form layouts were inspected; captured console errors/warnings were empty. Screenshots were displayed inline, not saved as automated on-disk evidence.

Fixtures use local generated placeholder imagery and test product/configuration inputs. These are actual uploaded/decoded image bytes, not approved garment photography or live merchant data. No R2/Supabase/financial/courier/email service was called.

## Review and remaining boundaries

Final local preview: `http://127.0.0.1:3113/admin/products`. Start normally with README commands if it stops. The final preview uses this project's `.fixture` directory; older temporary review data remains under the workspace `work/` directory. No user data was deleted to produce a fresh review.

Use one process per fixture database/media directory. PGlite is a local preview runtime; multi-process contention, hosted Supabase Auth/PostgREST and actual R2 signing/CORS/upload delivery still require isolated provider testing. R2/custom-domain configuration, shared deployment rate limiting, scheduled cleanup and deployed workers remain operational checks before launch. MP4 requires maintained ffprobe/ffmpeg; missing tools fail closed. The native Playwright browser harness remains unverified here because macOS sandbox permissions blocked browser launch.

Actual brand/assets, measurements, stock, weights, pickup address, packaging, inclusive-tax rules and approved policies remain merchant inputs. No claim of production or launch readiness is made. No payment, shipment, email or deployment occurred. Original archive files in `docs/spec/` remain unchanged.

**Review checkpoint: M2 complete in fixture mode. Wait for approval before M3.**
