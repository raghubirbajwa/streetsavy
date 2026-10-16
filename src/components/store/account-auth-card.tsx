"use client";

import Link from "next/link";
import { useState } from "react";

type Notice = { tone: "error" | "status"; text: string };
const perks = [
  "View and manage your wishlist",
  "Access to our Loyalty Dept. full of rewards",
  "Return and track parcels",
];

export function AccountAuthCard({ fixture, initialTab, notice, next }: {
  fixture: boolean;
  initialTab: "login" | "signup";
  notice: Notice | null;
  next: string;
}) {
  const [mode, setMode] = useState(initialTab);
  const nextField = next ? <input type="hidden" name="next" value={next} /> : null;
  return <>
    <div className="store-account-tabs" role="tablist" aria-label="Account">
      <button type="button" role="tab" id="account-tab-login" aria-selected={mode === "login"} aria-controls={fixture ? undefined : "account-panel-login"} onClick={() => setMode("login")}>Log in</button>
      <button type="button" role="tab" id="account-tab-signup" aria-selected={mode === "signup"} aria-controls={fixture ? undefined : "account-panel-signup"} onClick={() => setMode("signup")}>Sign up</button>
    </div>
    <h1>{mode === "login" ? "Sign in to account" : "Create your account"}</h1>
    {notice && <p className={`store-account-note${notice.tone === "error" ? " store-account-error" : ""}`} role={notice.tone === "error" ? "alert" : "status"}>{notice.text}</p>}
    {fixture ? <>
      <p className="store-account-note"><strong>Fixture preview</strong>This demo customer only uses local sample data. No email is sent.</p>
      <form className="store-account-form" action="/api/v1/auth/store-fixture" method="post">
        <input type="hidden" name="persona" value="customer" />
        {nextField}
        <ArrowButton>Continue as demo customer</ArrowButton>
      </form>
    </> : <>
      <form className="store-account-form" action="/api/v1/auth/store-login" method="post" hidden={mode !== "login"} id="account-panel-login" role="tabpanel" aria-labelledby="account-tab-login">
        {nextField}
        <label className="store-account-label" htmlFor="account-email">Email address</label>
        <input id="account-email" name="email" type="email" autoComplete="email" placeholder="Email address" required maxLength={254} />
        <label className="store-account-label" htmlFor="account-password">Password</label>
        <input id="account-password" name="password" type="password" autoComplete="current-password" placeholder="Password" required maxLength={200} />
        <Link className="store-account-forgot" href="/account/forgot-password">Forgot password?</Link>
        <ArrowButton>Log in to account</ArrowButton>
      </form>
      <form className="store-account-form" action="/api/v1/auth/store-signup" method="post" hidden={mode !== "signup"} id="account-panel-signup" role="tabpanel" aria-labelledby="account-tab-signup">
        {nextField}
        <label className="store-account-label" htmlFor="signup-first">First name</label>
        <input id="signup-first" name="firstName" type="text" autoComplete="given-name" placeholder="First name" required maxLength={80} />
        <label className="store-account-label" htmlFor="signup-last">Last name</label>
        <input id="signup-last" name="lastName" type="text" autoComplete="family-name" placeholder="Last name" required maxLength={80} />
        <label className="store-account-label" htmlFor="signup-email">Email address</label>
        <input id="signup-email" name="email" type="email" autoComplete="email" placeholder="Email address" required maxLength={254} />
        <label className="store-account-label" htmlFor="signup-password">Password</label>
        <input id="signup-password" name="password" type="password" autoComplete="new-password" placeholder="Password" required minLength={8} maxLength={200} />
        <label className="store-account-label" htmlFor="signup-confirm">Confirm password</label>
        <input id="signup-confirm" name="confirmPassword" type="password" autoComplete="new-password" placeholder="Confirm password" required minLength={8} maxLength={200} />
        <label className="store-account-consent">
          <input name="marketing" type="checkbox" value="on" />
          <span>I’d like to be notified about new products, behind the scenes news and early access to sales. I can unsubscribe at any time.</span>
        </label>
        <ArrowButton>Sign up</ArrowButton>
        <p className="store-account-legal">By providing your email address, you agree to our <Link href="/policies/privacy">Privacy Policy</Link> and <Link href="/policies/terms">Terms &amp; Conditions</Link>.</p>
      </form>
    </>}
    {mode === "login" && <>
      <div className="store-account-member">
        <span>Not yet a member?</span>
        <button type="button" onClick={() => setMode("signup")}>Sign up</button>
      </div>
      <ul className="store-account-perks">{perks.map((perk) => <li key={perk}><span aria-hidden="true">→</span><span>{perk}</span></li>)}</ul>
    </>}
  </>;
}

function ArrowButton({ children }: { children: string }) {
  return <button className="store-account-submit" type="submit"><span className="store-account-submit-label">{children}</span><span className="store-account-submit-arrow" aria-hidden="true">→</span></button>;
}
