# T01–T05 implementation record

Historical M0 record. The user approved continuation through M1; see [M1_IMPLEMENTATION.md](M1_IMPLEMENTATION.md) for the current review point.

Date: 24 September 2026. Authorized scope ends at T05; review is required before T06 or any other application code.

## Inspection and plan (T01–T02)

Read all ten documents from the supplied archive: README.md, PRD.md, DESIGN.md, SITEMAP.md, USER_FLOWS.md, CONTENT.md, DATA_MODEL.md, API.md, TECH_STACK.md and TASKS.md. Unmodified copies are in `docs/spec/`. Also read the eleven AppleDouble metadata entries; they are macOS metadata, not application files.

The task workspace initially contained only empty `work/` and `outputs/` directories. There was no application, package manifest, lockfile, Git repository, service configuration, existing source, or applicable ancestor AGENTS.md. No unrelated files were changed. This deliverable is an environment-only foundation in `outputs/clothing-store`.

Initial sandbox tooling: Node.js 22.16.0, npm 10.9.2, pnpm 12.5.1 and Bun 1.4.0. Yarn's Corepack shim could not resolve its version without registry access. After network permission, the execution environment resolved Node.js 24.20.0 and npm 11.19.0; these performed installation and the primary checks. Tests also passed under the original Node.js 22.16.0. npm 11.19.0 is recorded in package.json. Installed exact versions: TypeScript 5.9.3, @types/node 22.20.1, Zod 3.25.76 and server-only 0.0.1, with package-lock.json. These are explicit compatible pins, not a claim that they are the newest versions.

Next.js, React, Tailwind, Supabase/provider SDKs and an application framework version are not installed or selected yet. The selected product stack remains the one in TECH_STACK.md. Current Next.js documentation requires Node ≥20.9 and TypeScript ≥5.1; the chosen tooling meets those minima. Actual app/SDK compatibility must be checked when that implementation is authorized.

Short implementation sequence:

1. Preserve the specification and record the empty-project/tooling findings.
2. Add only a typed, server-only environment module, its dependency/check setup, and secret-free example/local fixture configuration. Validate configuration at explicit startup/feature entry, with no provider calls.
3. Record outstanding launch inputs and current official provider contracts; run focused environment tests and type checking.
4. Stop for user review. If later authorized, resume at T06, following TASKS.md in dependency order.

## Mode contract and environment (T03)

`APP_MODE=fixture` is set in `.env.local` and `.env.example`. It is independent of `NODE_ENV`. The module rejects missing/unknown modes rather than guessing. Fixture mode requires no credentials and disables all external integrations. Test mode permits separately configured Supabase/R2 and Razorpay test credentials; Shiprocket remains disabled until a safe, authorized test facility is established. Live mode never falls back to fixtures and requires HTTPS URLs. Neither test nor live configuration grants permission to transact or deploy.

The environment module validates supplied values, requires integration-specific values at feature entry, enforces public/private R2 bucket separation, matches Razorpay key mode, and exposes only a small explicit public projection. Errors name invalid variables without including their values. A successful configuration check does not prove account activation, credentials, data isolation, policies, or integration behavior. Future adapters must call the integration guard before construction; no adapters exist yet.

## Unresolved inputs (T04)

Keep `YOUR BRAND` until supplied. Still needed for launch: brand/logo and licensed assets; actual catalog/prices, garment measurements and weights; packaging dimensions/limits; pickup details; tax/invoice treatment; customer shipping fee policy; return/refund eligibility and period; support/business contacts and approved policy copy; email sender/provider; domain/hosting; and activated provider accounts with isolated credentials/data.

These do not block this fixture-mode environment work. No real support identity, pickup address, taxes, shipping charges or provider credentials have been invented. Product seeds belong to T11 and remain pending.

## Provider review (T05)

Current official documentation findings and exact source links are recorded in [PROVIDER_CONTRACTS.md](PROVIDER_CONTRACTS.md). Shiprocket test shipping remains unverified; its documented callback naming restriction also conflicts with the proposed route containing `shiprocket`. Resolve that route in API.md and the implementation together when webhook work is authorized. No shared API contract or provider adapter has been changed in this foundation.

## Verification and stop point

- [x] T01: all ten docs and applicable instruction locations read; empty workspace inspected.
- [x] T02: observed/installed versions and short implementation plan recorded; unrelated files preserved.
- [x] T03: fixture mode, validated server-only environment module, secret-free example/local configuration, and pinned check dependencies provided.
- [x] T04: unresolved launch inputs recorded; fixture-mode configuration work completed without requiring them. Catalog fixture/seed implementation remains T11.
- [x] T05: official provider contracts reviewed and uncertainties recorded; no account/provider execution claimed.

Verified commands: dependency install and clean `npm ci --ignore-scripts --no-audit --no-fund` completed; `npm run typecheck` passed; `npm test` passed 14/14; `npm run check:env` printed only `{ mode: 'fixture', appUrl: 'http://localhost:3000' }`. The same 14 tests passed under Node 22.16.0. Read-only review found no remaining blocking issues. Node 22 reports its expected experimental TypeScript-stripping warning. Archive comparison confirmed all ten source documents are preserved byte-for-byte; all 24 environment variable names are covered, the example has no credential values, and the lockfile matches the exact dependency pins.

The original specification checklist is preserved unchanged; this record is the completion log. No app dev/build command, migrations, owner bootstrap, scheduler, storefront, admin, fixture catalog, provider adapter or deployment exists in this scope. T06 and every later task remain pending. Stop here for user review.
