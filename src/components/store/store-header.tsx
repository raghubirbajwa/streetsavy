"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { StoreOverlay } from "./overlay.tsx";
import { useStore } from "./store-provider.tsx";

type Navigation = { label: string; href: string }[];
function Icon({ name }: { name: "menu" | "search" | "heart" | "bag" | "user" }) {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">{name === "menu" ? <path d="M3 7h18M3 17h18" /> : name === "search" ? <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></> : name === "heart" ? <path d="M20.8 4.6c-2.1-2.1-5.6-1.8-8.8 1.6C8.8 2.8 5.3 2.5 3.2 4.6c-2.2 2.2-1.6 5.9.5 8L12 21l8.3-8.4c2.1-2.1 2.7-5.8.5-8Z" /> : name === "user" ? <><circle cx="12" cy="8" r="3.25" /><path d="M5.2 19.5c.9-3.2 3.2-4.8 6.8-4.8s5.9 1.6 6.8 4.8" /></> : <><path d="M5 7h14l1 14H4L5 7Z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></>}</svg>;
}
type HeaderProps = { navigation: Navigation; signedIn?: boolean; accountInitial?: string };
export function StoreHeader(props: HeaderProps) {
  const pathname = usePathname();
  // Navigation gives the mobile menu a new owner, so it starts closed.
  return <HeaderForPath key={pathname} {...props} pathname={pathname} />;
}
function HeaderForPath({ navigation, pathname, signedIn = false, accountInitial }: HeaderProps & { pathname: string }) {
  const [menu, setMenu] = useState(false);
  const [onHero, setOnHero] = useState(pathname === "/");
  const { openCart, cartCount, cartLoading, wishlistIds, wishlistReady } = useStore();
  useEffect(() => {
    if (pathname !== "/") { setOnHero(false); return; }
    const hero = document.getElementById("store-home-hero");
    if (!hero) { setOnHero(false); return; }
    const header = document.querySelector(".store-header");
    const headerHeight = header instanceof HTMLElement ? header.offsetHeight : 80;
    const observer = new IntersectionObserver(
      ([entry]) => setOnHero(entry?.isIntersecting ?? false),
      { rootMargin: `-${headerHeight}px 0px 0px 0px`, threshold: 0 },
    );
    observer.observe(hero);
    return () => observer.disconnect();
  }, [pathname]);
  return <>
    <header className={`store-header store-header--overlay${onHero ? " store-header--on-hero" : ""}`}>
      <div className="store-header-inner">
        <button className="store-icon-button store-menu-toggle" aria-label="Open navigation" aria-expanded={menu} onClick={() => setMenu(true)}><Icon name="menu" /></button>
        <Link className="store-wordmark" href="/"><img src="/brand/streetsavy-logo.png" alt="StreetSavy" /></Link>
        <nav className="store-desktop-nav" aria-label="Main navigation">{navigation.map((item) => <Link href={item.href} key={item.href} aria-current={pathname === item.href ? "page" : undefined}>{item.label}</Link>)}</nav>
        <div className="store-header-actions">
          <Link className="store-icon-button" href="/account" aria-label={accountInitial ? `Account, signed in as ${accountInitial}` : signedIn ? "Account, signed in" : "Account"} aria-current={pathname.startsWith("/account") ? "page" : undefined}>{accountInitial ? <span className="store-account-initial" aria-hidden="true">{accountInitial}</span> : <Icon name="user" />}</Link>
          <Link className="store-icon-button" href="/search" aria-label="Search"><Icon name="search" /></Link>
          <Link className="store-icon-button store-wishlist-link" href="/wishlist" aria-label={`Wishlist${wishlistReady && wishlistIds.length ? `, ${wishlistIds.length} saved` : ""}`}><Icon name="heart" /></Link>
          <button className="store-icon-button" onClick={openCart} aria-label={`Cart${cartLoading ? ", loading" : `, ${cartCount} items`}`}><Icon name="bag" /><span className="store-cart-count" aria-hidden="true">{cartCount}</span></button>
        </div>
      </div>
    </header>
    {menu && <StoreOverlay title="Explore YOUR BRAND" onClose={() => setMenu(false)} className="store-navigation-panel">
      <nav aria-label="Mobile navigation" className="store-mobile-nav">{navigation.map((item) => <Link key={item.href} href={item.href} onClick={() => setMenu(false)}>{item.label}<span aria-hidden="true">↗</span></Link>)}<Link href="/account" onClick={() => setMenu(false)}>Account<span aria-hidden="true">↗</span></Link><Link href="/search" onClick={() => setMenu(false)}>Search<span aria-hidden="true">↗</span></Link><Link href="/wishlist" onClick={() => setMenu(false)}>Wishlist<span aria-hidden="true">↗</span></Link></nav>
      <div className="store-menu-support"><Link href="/track-order" onClick={() => setMenu(false)}>Track order</Link><Link href="/contact" onClick={() => setMenu(false)}>Contact</Link></div>
    </StoreOverlay>}
  </>;
}
