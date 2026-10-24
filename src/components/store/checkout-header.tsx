import Link from "next/link";

export function CheckoutHeader({ email }: { email?: string }) {
  return (
    <header className="checkout-header">
      <Link className="checkout-header-back" href="/cart">Back to cart</Link>
      <Link className="store-wordmark checkout-header-logo" href="/">
        <img src="/brand/streetsavy-logo.png" alt="StreetSavy" />
      </Link>
      {email
        ? <p className="checkout-header-account">{email}</p>
        : <Link className="checkout-header-account" href="/account">Sign in</Link>}
    </header>
  );
}
