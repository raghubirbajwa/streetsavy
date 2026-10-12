import Link from "next/link";
export const metadata = { title: "About" };
export default function About() { return <main id="main" className="store-info"><p className="store-kicker">YOUR BRAND</p><h1>The everyday edit.</h1><p>Easy layers, relaxed shapes and pieces that work together.</p><p>This is a preview of YOUR BRAND. The catalog contains sample products and neutral image placeholders. The brand story and actual product photography are still to come.</p><Link className="store-cta" href="/collections/everyday-uniform">Explore the edit <span aria-hidden="true">↗</span></Link></main>; }
