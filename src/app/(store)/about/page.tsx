import Link from "next/link";
import { StoreInfoHeroPage } from "../../../components/store/store-info-hero-page.tsx";

export const metadata = { title: "About" };

export default function About() {
  return (
    <StoreInfoHeroPage kicker="YOUR BRAND" title="The everyday edit.">
      <p>Easy layers, relaxed shapes and pieces that work together.</p>
      <p>This is a preview of YOUR BRAND. The catalog contains sample products and neutral image placeholders. The brand story and actual product photography are still to come.</p>
      <Link className="store-cta" href="/collections/everyday-uniform">Explore the edit <span aria-hidden="true">↗</span></Link>
    </StoreInfoHeroPage>
  );
}
