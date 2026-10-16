import type { ReactNode } from "react";

export function StoreInfoHeroPage({ kicker, title, children }: { kicker: string; title: string; children: ReactNode }) {
  return (
    <main id="main" className="store-info-page">
      <div className="store-info-hero" aria-hidden="true" />
      <div className="store-info store-info-body">
        <p className="store-kicker">{kicker}</p>
        <h1>{title}</h1>
        {children}
      </div>
    </main>
  );
}
