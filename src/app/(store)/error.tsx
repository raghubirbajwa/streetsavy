"use client";
import Link from "next/link";
export default function StoreError({ reset }: { reset: () => void }) { return <main id="main" className="store-info"><p className="store-kicker">PLEASE TRY AGAIN</p><h1>We couldn’t load this section.</h1><p>Your cart is kept on the server. Try loading the page again.</p><button onClick={reset}>Try again</button><div className="store-info-links"><Link href="/collections">Explore collections</Link></div></main>; }
