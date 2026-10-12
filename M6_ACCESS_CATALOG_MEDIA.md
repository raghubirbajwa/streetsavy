# M6 authorization, catalog and media verification

12 October 2026. Scope: Q01, Q02 and Q08, in `APP_MODE=fixture`. No account, bucket, deployment or external provider was used. Local passing evidence does not pass the hosted requirements below.

## Ready in fixture mode

| Check | Evidence |
| --- | --- |
| Q01 — anonymous/nonadmin denial, current membership and owner restriction | `tests/auth.test.ts`: `anonymous/nonadmin/disabled/wrong-user identities cannot become admin`; `fixture sessions are opaque, hashed, revocable and check current membership`. `tests/catalog-admin.test.ts`: SQL catalog workflow rejects a forged caller role and revoked staff writes. `tests/returns.test.ts`: owner refunds reject staff, and policy/mode isolation test rejects a revoked owner. |
| Q01 — other customers' orders and private assets | `tests/checkout.test.ts`: `checkout SQL: immutable quote, reservations, duplicate capture, receipt ownership, late capture and outbox` denies a second guest's access. `tests/media.test.ts`: preview capability binds actor/media/expiry; actual media workflow rejects nonadmin access and the same preview after membership revocation. `tests/database/001-foundation.sql` exercises anon/authenticated grants and cross-customer order/item RLS with local Supabase role shims. |
| Q02 — same-variant filtering and matching price/stock | Existing `tests/catalog-query.test.ts` checks combined color/size/price/stock predicates, sorting and pagination. New `M6 Q02: black/S plus blue/M never matches black/M; matching price and stock control results` uses that exact two-variant counterexample and verifies both price sort directions and in-stock behavior. There is no separate stock sort; availability is an `inStock` filter. |
| Q02 — public draft exclusion | `tests/catalog-admin.test.ts` SQL publication workflow verifies create/edit return to draft and disappear publicly, explicit publication exposes the record, and archive retains stock/history. `tests/database/003-catalog.sql` checks draft exclusion and incomplete-publication denial. |
| Q08 — invalid bytes, size, privacy and publication failure | `tests/media.test.ts` rejects oversized declarations/streams, type mismatch, SVG, truncated bytes and unsupported video codec; validates real PNG/MP4; checks failed promotion remains nonpublic; rejects deleting referenced media. `tests/database/004-media.sql` checks validation lease ownership, color/version conflicts and private promotion. |
| Q01/Q08 — incomplete upload and revoked mutation | New `M6 Q01/Q08: missing upload bytes cannot become attachable or public, and revoked actors cannot upload or complete` verifies incomplete files cannot attach, preview or become public; forged customers and revoked owners cannot start uploads/complete validation. |
| Q08 — bounded cleanup with actual fixture storage | New `M6 Q08: cleanup is bounded, retries storage failure and preserves recent, referenced and published media` creates 21 expired candidates. First batch touches 20 and reports 19 cleaned/1 pending after an injected storage failure; next batch cleans the remaining two; the third does nothing. Recent, referenced, ready, validating, publishing and published assets retain their bytes. |

New focused command actually run:

```sh
node --experimental-strip-types --conditions=react-server --test tests/m6-access-catalog-media.test.ts
```

Result: **3 passed, 0 failed, 0 skipped**. The first attempt exposed an invalid test seed for a published asset; its required public key/dimensions were supplied and the rerun passed. No application code or production constraint was changed. Existing tests above were covered by the prerequisite `npm test` rerun; the main M6 report records the final combined run and fresh HTTP/database results.

HTTP coverage is deliberately separate from these service tests: `npm run test:http` tests direct admin access, session revocation and Origin/cookie protections; `npm run test:m2` tests nonadmin upload denial, authenticated private preview, real PNG publication and draft/archive visibility. A rendered HTTP response is not browser/device evidence.

## BLOCKED — real systems and browser evidence

| Gate | Needed and how to verify |
| --- | --- |
| Q01 hosted Supabase Auth, PostgREST/RLS, revocation and order recovery | An isolated Supabase project, genuine owner/staff/nonadmin test identities and a controlled test mailbox. Follow **G01, G02 and G12** in `M4_HOSTED_VERIFICATION.md`; apply all migrations to that separate test project, run the permissions helper, repeat same-session membership revocation, cross-guest/other-user receipt access and actual email OTP recovery. Local role shims are insufficient evidence. |
| Q08 R2 signing, CORS, privacy and promotion | Isolated private/public R2 buckets, scoped credentials and an approved test origin. Follow `src/lib/media/README.md` for the exact-origin staging CORS configuration. In the separate test app: upload an actual PNG and supported MP4; inspect browser preflight/PUT behavior; verify another Origin cannot upload; request original/staged bytes without app authentication and expect denial; confirm ready preview requires current membership; publish and fetch only the immutable public copy; retry a failed publication and verify the same key; revoke membership and retry the preview. Also check expired tickets and mismatched/oversized upload rejection against real R2 HEAD/read results. None ran here. |
| Q08 hosted cleanup and validation runtime | A deployment/test runtime with maintained `ffprobe`/`ffmpeg`, provider object permissions and an external cleanup schedule. Prepare older unreferenced test uploads plus protected references in the isolated environment; invoke bounded cleanup, inject/recover a storage deletion failure, inspect bucket state and prove referenced/public assets are retained. Verify the deployed process can fully decode a supported clip and rejects unsupported/corrupt input. No production objects should be used. |
| Q08/Q10 device-specific media delivery | Supported desktop/mobile browser access, the configured HTTPS test origin and R2 delivery path. Verify presigned upload/CORS, image orientation/dimensions, video playback/posters and failed uploads in those browsers. Local decoding tests and HTTP checks do not pass device rendering. |

Q02's fixture logic is ready; actual merchant catalog acceptance still needs the approved product/color/size/price/stock data and media under Q13. Do not import demonstration products into the merchant's live catalog as acceptance evidence.
