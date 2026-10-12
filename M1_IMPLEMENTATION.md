> Historical M1 checkpoint. M2 supersedes the pending-task and dependency notes below; see M2_IMPLEMENTATION.md.

# M1 — Supabase foundation and admin identity

Implementation dates: 24–25 September 2026. Authorized scope: T06–T11, fixture mode, then stop for review. No M2 work, hosted service changes or deployment.

## Scope delivered

- [x] T06: two ordered SQL migrations; all 35 application tables, row constraints, foreign keys, query indexes, RLS and explicit grants. Database types are generated from the migrated PostgreSQL catalog; strict Zod schemas validate public/fixture DTOs. Cross-row checkout/refund/return transaction workflows remain at their specified later tasks.
- [x] T07: public catalog RPC exposes an explicit field allowlist, published products/media and availability booleans. Private base tables are unavailable to anonymous users. The server repository validates the RPC output. Public, request-scoped and privileged Supabase clients are separate and server secrets stay out of client modules.
- [x] T08: Supabase SSR cookie refresh via Next.js Proxy; fresh verified identity and current owner/staff membership per operation; local fixture sessions model identity, revocation and denial without external calls. Trusted owner bootstrap/recovery SQL and setup instructions are in ADMIN_SETUP.md.
- [x] T09: admin sign-in, protected layout/overview, sign-out, no-access and password recovery/reset screens. Direct session API denies anonymous/nonadmin callers. Same-origin checks, bounded form parsing, safe errors and a local auth throttle protect entry points. No public admin registration or membership mutation endpoint.
- [x] T10: durable job leases, fencing tokens, bounded retries/dead jobs, idempotent external operations, webhook inbox and append-only audit primitives. Unknown remote outcomes require reconciliation. All operational RPCs are service-role-only. Workers, scheduler, provider-specific webhooks and commerce transitions remain later tasks.
- [x] T11: 16 deterministic UUIDv5 products, 110 explicit-stock variants, 5 categories, 11 collections and required sold-out/range/single-image/long-title cases. Neutral original placeholders are clearly marked for replacement. Opt-in seed SQL refuses live mode, checks an empty target and is never run on app startup.

## Verification

- `npm run check:env`: fixture mode, localhost URL, no credentials.
- `npm test`: 37 focused environment, authorization/session, catalog, form-boundary and operations tests passed.
- `npm run test:db`: both migrations execute in a fresh embedded PostgreSQL database. SQL permission/privacy/invariant assertions and operations dedupe/lease/reclaim/webhook/audit assertions passed. Trusted owner bootstrap/recovery passed. Seeded SQL public projection matches the fixture snapshot for all 16 products.
- `npm run typecheck`: passed after integration fixes.
- `npm run build`: optimized Next.js fixture build passed, including server/client boundaries.
- `npm run test:http`: passed against a managed production server with fixture mode. Covers anonymous/forged cookies, owner/staff/nonadmin, immediate membership revocation, logout, origin checks, inactive recovery, cache/indexing headers and malformed/oversized request rejection.
- In-app browser: owner login/overview, logout, customer no-access, 390px login, 1440px admin and 320px admin reflow checked. No horizontal overflow observed; captured console errors/warnings were empty. Preview screenshots were displayed during review.
- Playwright CLI browser execution was blocked by macOS MachPort permissions; its automated visual suite and on-disk screenshots are not marked passed. The initial development-server attempt also hit host filesystem-watcher limits; the production server was used successfully instead.

Native PostgreSQL 17.11 initialization was blocked by the sandbox's shared-memory restriction. Tests therefore execute PostgreSQL through PGlite 0.5.8, using test-only Supabase role/auth shims. This proves the SQL/RLS behavior exercised by those tests; it does not verify real Supabase Auth/SMTP, PostgREST behavior, or contention between independent database processes. Those checks remain required in an isolated Supabase environment. PGlite is a development dependency only; the application does not use it as a production database.

## Versions and setup

Pinned: Next.js 16.3.6, React/React DOM 19.3.0, Supabase JS 2.117.1, Supabase SSR 0.12.7, Tailwind/PostCSS integration 4.3.3, TypeScript 5.9.3, Zod 3.25.76, PGlite 0.5.8 and Playwright 1.63.0. M1 checks used Node 24.20.0 and npm 11.19.0. The lockfile preserves exact installs. TypeScript checks app/tests strictly; skipLibCheck avoids incompatible ambient declarations in third-party packages.

Use README.md for install/dev/check commands. Migration order is `202609240001_foundation.sql` then `202609240002_operations.sql`. `npm run types:db` generates column/RPC types from a clean migrated schema. Generated relationship arrays are intentionally empty; no relational select inference is used by current clients. Schema/DTO validation remains authoritative at the boundaries.

## Review boundaries

APP_MODE remains fixture. No actual provider credentials are present. Auth/SMTP integration code exists but was not exercised against hosted Supabase; browser review uses explicit local fixture identities. No scheduler/worker is deployed, and no paid order, shipment, email or media upload was created.

The original archive documents stay unchanged in `docs/spec/`; this file records implementation status. Launch inputs from the M0 plan remain unresolved. Product management/media/settings belong to M2 (T12–T18), and remain unstarted. Stop at this review point.

Current local review server: `http://127.0.0.1:3107/admin/login`, fixture mode, temporary review sessions. The in-app browser is left at sign-in. Restart with README commands if the server stops.
