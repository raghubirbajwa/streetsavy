import Link from "next/link";
export default function ProductNotFound(){return <main id="main" className="store-simple-page"><p className="purchase-kicker">Product unavailable</p><h1>We couldn’t find that piece.</h1><p>It may no longer be part of the collection.</p><Link href="/collections/all" className="store-primary-button">Explore clothing ↗</Link></main>;}
