# Supabase auth email (OTP)

Store account login and track-order recovery both use **Supabase Auth email OTP**.
Order-payment mail still uses Resend’s HTTP API (`TRANSACTIONAL_EMAIL_*`) and is
separate from this page.

## SMTP (Resend)

In the Supabase dashboard: **Authentication → SMTP Settings**.

1. Enable custom SMTP.
2. Sender email: a verified Resend address such as `noreply@streetsavy.com` (not a website URL, not a Gmail From address).
3. Sender name: `StreetSavy`.
4. Host: `smtp.resend.com`
5. Port: `465` or `587`
6. Username: `resend`
7. Password: the Resend API key (`re_…`)
8. Verify `streetsavy.com` under **Resend → Domains** before expecting inbox delivery.

## URL configuration

**Authentication → URL Configuration**

- Site URL = the app origin (`APP_URL`), e.g. `https://www.streetsavy.com` or `http://localhost:3000` for local tests.
- Redirect URLs must include `{APP_URL}/auth/callback`.

## Email template

**Authentication → Email Templates → Magic Link** (OTP).

1. Open [`email-otp-template.html`](email-otp-template.html).
2. Paste the HTML into the template body.
3. The body **must** contain `{{ .Token }}` (numeric code). Account login and `/track-order` both expect a 6-digit code.
4. The hero image URL is `https://www.streetsavy.com/email/P_Co-SS26-4.jpg`. For a staging host, change that origin to the public `APP_URL`. Email clients cannot load `localhost` images.
5. Confirm email OTP / passwordless email is enabled. Completing `verifyOtp` marks the email verified; avoid a second “confirm email” mail that conflicts with OTP.

## Manual inbox check

1. Set `APP_MODE` to `test` or `live` (not `fixture`) and keep store Supabase keys in the app env.
2. Open `/account`, enter a mailbox you control, request a code.
3. Confirm the branded image and 6-digit code arrive (check Resend logs if nothing appears).
4. Enter the code; you should land on the signed-in account page.
5. Repeat `/track-order` with an order number + the same mailbox so the shared template still shows `{{ .Token }}`.
