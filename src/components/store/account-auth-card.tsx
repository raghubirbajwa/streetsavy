"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { z } from "zod";
import { OtpCodeInput } from "./otp-code-input.tsx";

type Notice = { tone: "error" | "status"; text: string };
const perks = [
  "View and manage your wishlist",
  "Access to our Loyalty Dept. full of rewards",
  "Return and track parcels",
];
const requestSchema = z.object({ accepted: z.boolean(), message: z.string(), fixtureToken: z.string().optional() });
const verifySchema = z.object({ href: z.string() });

async function api<T>(path: string, schema: z.ZodType<T>, body: unknown): Promise<T> {
  const response = await fetch(`/api/v1/${path}`, {
    method: "POST",
    cache: "no-store",
    signal: AbortSignal.timeout(30000),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data: unknown = await response.json();
  const payload = data && typeof data === "object" ? data as { error?: { message?: string }; data?: unknown } : {};
  if (payload.error) throw new Error(payload.error.message ?? "Please retry.");
  return schema.parse(payload.data);
}

export function AccountAuthCard({ fixture, initialTab, notice, next }: {
  fixture: boolean;
  initialTab: "login" | "signup";
  notice: Notice | null;
  next: string;
}) {
  const [mode, setMode] = useState(initialTab);
  const [step, setStep] = useState<"details" | "code">("details");
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [marketing, setMarketing] = useState(false);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [fixtureToken, setFixtureToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function switchMode(nextMode: "login" | "signup") {
    setMode(nextMode);
    setStep("details");
    setCode("");
    setMessage("");
    setFixtureToken("");
    setError("");
  }

  async function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const body = mode === "signup"
        ? { intent: "signup" as const, email, firstName, lastName, marketing, ...(next ? { next } : {}) }
        : { intent: "login" as const, email, ...(next ? { next } : {}) };
      const result = await api("auth/store-otp/request", requestSchema, body);
      setMessage(result.message);
      setFixtureToken(result.fixtureToken ?? "");
      setStep("code");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to send a code.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || code.length !== 6) return;
    setBusy(true);
    setError("");
    try {
      const result = await api("auth/store-otp/verify", verifySchema, {
        email,
        token: code,
        ...(mode === "signup" ? { firstName, lastName, marketing } : {}),
        ...(next ? { next } : {}),
      });
      // Session cookies are HttpOnly; load the destination as a fresh document.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(result.href);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to verify.");
      setBusy(false);
    }
  }

  return <>
    <div className="store-account-tabs" role="tablist" aria-label="Account">
      <button type="button" role="tab" id="account-tab-login" aria-selected={mode === "login"} aria-controls="account-panel" onClick={() => switchMode("login")}>Log in</button>
      <button type="button" role="tab" id="account-tab-signup" aria-selected={mode === "signup"} aria-controls="account-panel" onClick={() => switchMode("signup")}>Sign up</button>
    </div>
    <h1>{step === "code" ? "Enter your code" : mode === "login" ? "Sign in to account" : "Create your account"}</h1>
    {notice && <p className={`store-account-note${notice.tone === "error" ? " store-account-error" : ""}`} role={notice.tone === "error" ? "alert" : "status"}>{notice.text}</p>}
    {fixture && step === "details" && <p className="store-account-note"><strong>Fixture preview</strong>This demo customer only uses local sample data. No email is sent.</p>}
    <div id="account-panel" role="tabpanel" aria-labelledby={mode === "login" ? "account-tab-login" : "account-tab-signup"}>
      {step === "details" ? (
        <form className="store-account-form" onSubmit={(event) => void requestCode(event)}>
          {mode === "signup" && <>
            <label className="store-account-label" htmlFor="signup-first">First name</label>
            <input id="signup-first" name="firstName" type="text" autoComplete="given-name" placeholder="First name" required maxLength={80} value={firstName} onChange={(event) => setFirstName(event.target.value)} disabled={busy} />
            <label className="store-account-label" htmlFor="signup-last">Last name</label>
            <input id="signup-last" name="lastName" type="text" autoComplete="family-name" placeholder="Last name" required maxLength={80} value={lastName} onChange={(event) => setLastName(event.target.value)} disabled={busy} />
          </>}
          <label className="store-account-label" htmlFor="account-email">Email address</label>
          <input id="account-email" name="email" type="email" autoComplete="email" placeholder="Email address" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy} />
          {mode === "signup" && <label className="store-account-consent">
            <input name="marketing" type="checkbox" checked={marketing} onChange={(event) => setMarketing(event.target.checked)} disabled={busy} />
            <span>I’d like to be notified about new products, behind the scenes news and early access to sales. I can unsubscribe at any time.</span>
          </label>}
          <ArrowButton disabled={busy}>{busy ? "Please wait…" : "Send verification code"}</ArrowButton>
          {mode === "signup" && <p className="store-account-legal">By providing your email address, you agree to our <Link href="/policies/privacy">Privacy Policy</Link> and <Link href="/policies/terms">Terms &amp; Conditions</Link>.</p>}
        </form>
      ) : (
        <form className="store-account-form" onSubmit={(event) => void verifyCode(event)}>
          <p className="store-account-note" role="status">{message}</p>
          {fixtureToken && <p className="store-account-note"><strong>Fixture code</strong>{fixtureToken}. This development simulation does not verify a real inbox.</p>}
          <p className="store-account-email">{email}</p>
          <OtpCodeInput value={code} disabled={busy} autoFocus onChange={setCode} />
          <ArrowButton disabled={busy || code.length !== 6}>{busy ? "Please wait…" : "Verify and continue"}</ArrowButton>
          <button className="store-account-text-button" type="button" disabled={busy} onClick={() => { setStep("details"); setCode(""); setFixtureToken(""); setMessage(""); setError(""); }}>Request a new code</button>
        </form>
      )}
    </div>
    {error && <p className="store-account-note store-account-error" role="alert">{error}</p>}
    {mode === "login" && step === "details" && <>
      <div className="store-account-member">
        <span>Not yet a member?</span>
        <button type="button" onClick={() => switchMode("signup")}>Sign up</button>
      </div>
      <ul className="store-account-perks">{perks.map((perk) => <li key={perk}><span aria-hidden="true">→</span><span>{perk}</span></li>)}</ul>
    </>}
  </>;
}

function ArrowButton({ children, disabled }: { children: string; disabled?: boolean }) {
  return <button className="store-account-submit" type="submit" disabled={disabled}><span className="store-account-submit-label">{children}</span><span className="store-account-submit-arrow" aria-hidden="true">→</span></button>;
}
