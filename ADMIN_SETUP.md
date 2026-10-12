# Admin bootstrap and recovery

The current app stays in fixture mode. These instructions prepare a later isolated Supabase test environment; none of the remote steps below has been executed.

## Fixture preview

Start the app and open `/admin/login`. Choose Demo owner or Demo staff. Demo customer reaches the no-access state and receives HTTP 403 from the protected session API. An unsigned/unknown cookie receives HTTP 401. There is no fixture password or email delivery.

Fixture identities and memberships are server-owned. HTTP clients cannot supply membership, role claims or enable an account. Each protected operation resolves its opaque cookie and rereads membership. `FIXTURE_AUTH_DIR` is a local test-harness override; normal local review stores sessions in `.fixture/`, which is ignored by Git. The store is deliberately limited to a single-process local preview.

## Isolated Supabase setup when authorized

1. Create a separate nonproduction Supabase project and confirm the database target. Never reuse a live project for seeds or tests. Keep credentials outside source control.
2. Apply `supabase/migrations/202609240001_foundation.sql`, then `202609240002_operations.sql` using the trusted migration/database owner. Supabase supplies `auth.users`, `auth.uid()`, and the `anon`, `authenticated`, `service_role` roles. The test-only auth shim in the local harness is not a migration and must not replace real Auth.
3. Create the intended user's email/password identity through the trusted Supabase dashboard or Auth admin tooling. Verify its email and record its UUID privately. There is no public admin signup path.
4. Run the reviewed `scripts/bootstrap-owner.sql` with the UUID using a trusted database connection:

```sh
psql "$ISOLATED_DATABASE_URL" -v owner_user_id='<existing Auth UUID>' -f scripts/bootstrap-owner.sql
```

The script requires an existing Auth user, assigns/enables owner membership and writes an audit entry. It contains no password or key. It is never called by an HTTP handler. The local SQL test exercises missing-user rejection, bootstrap and recovery.

5. Configure the Supabase URL, publishable key and server secret in an untracked environment file, then explicitly choose test mode when permitted. Configure Supabase Site URL and its allowed redirect URL to the app's exact `/auth/callback` URL. Configure SMTP before relying on email recovery. Keep preview and production redirect allowlists separate.
6. Sign in through `/admin/login`. Request-scoped clients validate identity with `getUser()` and query enabled membership on every private operation. Cookie refresh in `src/proxy.ts` does not grant admin access. Verify owner, staff, nonadmin, disabled-user and recovery behavior against real Supabase before calling that integration complete.

## Password reset and membership recovery

`/admin/forgot-password` requests Supabase recovery email and returns the same message for known/unknown addresses. The PKCE callback exchanges the one-time code; redirect destinations are restricted to `/admin` and `/admin/reset-password`. Reset requires a verified current admin session, matching passwords with at least 12 characters, and signs out after success. Fixture mode provides an explanatory recovery screen and sends nothing.

For a lost owner membership, a trusted database operator may rerun the bootstrap script after independently verifying the intended Auth identity. This is separate from password recovery. Do not introduce a public promotion endpoint. To revoke access, disable the membership through trusted operations; the next protected request observes that change. Enable MFA for production admins before launch.

## Deployment prerequisites and evidence limits

Set HTTPS, verify Auth session refresh/reset email end-to-end, use a shared rate limiter, and test actual multi-process database permissions/concurrency in an isolated Supabase project. The current per-process auth throttle and local fixture store do not supply those deployment guarantees. Cookie-authenticated mutations reject cross-origin requests and read only bounded URL-encoded form bodies.

Contract references checked during M1: [Supabase Next.js SSR](https://supabase.com/docs/guides/auth/server-side/nextjs), [Supabase password auth/recovery](https://supabase.com/docs/guides/auth/passwords), [Next.js Proxy](https://nextjs.org/docs/app/api-reference/file-conventions/proxy). Real account configuration and remote behavior are untested.
