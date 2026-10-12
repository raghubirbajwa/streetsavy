# Clothing Store — Project Specification

Version 2.0 · Updated 23 September 2026

Status: documentation only. The application and integrations have not been built or tested by producing this package.

## What we are building

An original Bonkers Corner-inspired clothing store with a customer storefront and protected admin area in one Next.js application. Admins can publish products, manage sizes/colours and stock, upload media, maintain collections, process orders and book shipping without editing code for each change.

Selected stack: Next.js + React + TypeScript + Tailwind; Supabase Postgres and Auth; Cloudflare R2 for images/video files; Razorpay for prepaid payments; Shiprocket for shipping. Hosting for Next.js is still to be selected. R2 is media storage, not an automatic choice of application hosting.

This package supersedes the earlier prototype-only documents and the original single-file brief. Backend, admin, payment and shipping implementation are now part of the product specification. This request updates documentation; it does not itself authorize production charges, courier pickups or deployment.

## Reading order and ownership

1. [PRD.md](PRD.md) — scope, requirement IDs and acceptance criteria.
2. [DESIGN.md](DESIGN.md) — storefront/admin layouts, accessibility and motion.
3. [SITEMAP.md](SITEMAP.md) — routes, navigation and URL rules.
4. [USER_FLOWS.md](USER_FLOWS.md) — customer/admin journeys and recovery paths.
5. [CONTENT.md](CONTENT.md) — copy, sixteen development products and required assets.
6. [DATA_MODEL.md](DATA_MODEL.md) — database entities, permissions and invariants.
7. [API.md](API.md) — actual planned server contracts and provider adapters.
8. [TECH_STACK.md](TECH_STACK.md) — architecture, environments and conventions.
9. [TASKS.md](TASKS.md) — build sequence, dependencies and acceptance checks.

Each document owns its subject. Explicit user instructions and applicable repository instructions take precedence. If an implementation decision changes a shared contract, update its owner and affected documents together. Do not keep contradictory prototype restrictions in the codebase.

## Confirmed direction and proposed launch defaults

Confirmed: selected technology stack; original clothing design inspired by Bonkers Corner; admin product management; integrated payments and shipping.

Defaults carried forward from the accepted recommendation: India/INR, prepaid only, one warehouse/pickup location, one parcel per order, admin-controlled shipment booking, guest checkout, local wishlist and email-verified order recovery. These are deliberate v1 implementation assumptions and can be changed by the user. Customer password accounts, COD, multi-warehouse/split shipments, coupons and automated size exchanges are later enhancements.

Keep `YOUR BRAND` until a name is supplied. Start with a photographic/video hero and subtle motion; interactive garment 3D remains optional. Use the sixteen sample products only in fixture/test mode.

## How the agent should work

- Inspect the repository, its rules, framework versions, lockfile, services and existing code before editing. Reuse working infrastructure.
- When asked to build the full project, implement the TASKS.md milestones sequentially through the authorized scope. Do not stop at a static homepage and call the store complete.
- Keep provider integrations behind typed adapters so unconfigured services can be developed with explicit fixtures. Never silently fall back to mock payments or shipments in live mode.
- Validate authorization in every server operation; an admin layout or hidden button is not authorization.
- Use database transactions for stock/order invariants and durable jobs for asynchronous external operations. Never assume a network timeout means a provider did nothing.
- Preserve original branding and unrelated changes. Do not scrape the reference's photographs/logo/copy for reuse without permission.
- Update task checkboxes only when verified. Record test commands, screenshots where useful, missing credentials and limits accurately.
- Do not ask again about reversible choices covered by these defaults. Continue all work that does not need missing business input or external access.
- Provisioning paid resources, making live financial/courier transactions and deployment require an applicable user request. Test mode is the default during development.

## Development modes

`fixture`: local typed products and fake provider adapters, prominently identified; no external payment, shipment or email action. Useful for design and failure simulation.

`test`: separate Supabase/R2 data, Razorpay Test Mode and Shiprocket fixture adapter by default. Real Shiprocket test calls require a documented safe provider test facility or an explicitly authorized controlled shipment; do not assume a shipping sandbox exists.

`live`: actual accounts, verified configuration, real assets/products, final policies, tested jobs and authorized launch. Missing critical configuration blocks checkout or the affected action with a useful error.

## Setup handoff

No application commands have been executed as part of writing these docs. After implementation, replace this section with verified package manager/Node versions, install/dev/build/test commands, migration/seed steps, first-admin bootstrap, environment setup, scheduler setup and rollback instructions. See TECH_STACK.md for the environment contract. Never place secret values in these files.

## Open launch inputs

Brand/logo, product photographs, actual garment measurements and weights, packaging presets, pickup details, real pricing/tax configuration, shipping fee policy, return/refund eligibility and period, support contacts, policies, transactional email delivery, domain/application host, and provider account activation/credentials. These are launch inputs, not reasons to leave frontend/admin implementation unfinished.

Default shipping fee mode is a server-selected live courier quote with no added markup; business may choose a flat fee or threshold later. Do not invent GST rates, free-shipping thresholds or delivery guarantees. Configure taxes before accepting live payments.

## Suggested coding-agent task

> Read README.md and all linked documents. Inspect the repository and implement this clothing-store specification in the order defined in TASKS.md. Use Next.js, Supabase, Cloudflare R2, Razorpay and Shiprocket. Start with the data/security foundation, then storefront and admin, payments, and shipping. Use fixture/test adapters until actual credentials are configured. Preserve the Bonkers Corner-inspired design while creating original branding. Keep moving through the authorized implementation scope, report concrete blockers, and verify each milestone. Do not deploy or make live payment/courier transactions without authorization.

Attach the files to the coding task; Markdown filenames alone do not guarantee editor-wide automatic rule loading.

## Change from version 1

Replaces local-only checkout with a staged real checkout contract; adds Supabase schema/RLS and admin bootstrap; defines R2 staging/publication; adds payment verification, stock reservations, shipping quotes/bookings/tracking, manual returns/refunds and reconciliation jobs. Storefront design and the sixteen sample product concepts remain.
