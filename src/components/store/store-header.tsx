"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { StoreOverlay } from "./overlay.tsx";
import { useStore } from "./store-provider.tsx";

type Navigation = { label: string; href: string }[];
function Icon({ name }: { name: "menu" | "search" | "heart" | "bag" }) {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">{name === "menu" ? <path d="M3 7h18M3 17h18" /> : name === "search" ? <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></> : name === "heart" ? <path d="M20.8 4.6c-2.1-2.1-5.6-1.8-8.8 1.6C8.8 2.8 5.3 2.5 3.2 4.6c-2.2 2.2-1.6 5.9.5 8L12 21l8.3-8.4c2.1-2.1 2.7-5.8.5-8Z" /> : <><path d="M5 7h14l1 14H4L5 7Z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></>}</svg>;
}
type HeaderProps = { navigation: Navigation; announcement: { text: string; href: string } | null; preview: boolean };
export function StoreHeader(props: HeaderProps) {
  const pathname = usePathname();
  // Navigation gives the mobile menu a new owner, so it starts closed.
  return <HeaderForPath key={pathname} {...props} pathname={pathname} />;
}
function HeaderForPath({ navigation, announcement, preview, pathname }: HeaderProps & { pathname: string }) {
  const [menu, setMenu] = useState(false);
  const { openCart, cartCount, cartLoading, wishlistIds, wishlistReady } = useStore();
  return <>
    {announcement && <div className="store-announcement"><Link href={announcement.href}>{announcement.text}<span aria-hidden="true"> ↗</span></Link>{preview && <span className="store-preview-label">FIXTURE PREVIEW</span>}</div>}
    <header className="store-header">
      <div className="store-header-inner">
        <button className="store-icon-button store-menu-toggle" aria-label="Open navigation" aria-expanded={menu} onClick={() => setMenu(true)}><Icon name="menu" /></button>
        <Link className="store-wordmark" href="/" aria-label="YOUR BRAND home">YOUR BRAND<span aria-hidden="true">✳</span></Link>
        <nav className="store-desktop-nav" aria-label="Main navigation">{navigation.map((item) => <Link href={item.href} key={item.href} aria-current={pathname === item.href ? "page" : undefined}>{item.label}</Link>)}</nav>
        <div className="store-header-actions">
          <Link className="store-icon-button" href="/search" aria-label="Search"><Icon name="search" /></Link>
          <Link className="store-icon-button store-wishlist-link" href="/wishlist" aria-label={`Wishlist${wishlistReady && wishlistIds.length ? `, ${wishlistIds.length} saved` : ""}`}><Icon name="heart" /></Link>
          <button className="store-icon-button" onClick={openCart} aria-label={`Cart${cartLoading ? ", loading" : `, ${cartCount} items`}`}><Icon name="bag" /><span className="store-cart-count" aria-hidden="true">{cartCount}</span></button>
        </div>
      </div>
    </header>
    {menu && <StoreOverlay title="Explore YOUR BRAND" onClose={() => setMenu(false)} className="store-navigation-panel">
      <nav aria-label="Mobile navigation" className="store-mobile-nav">{navigation.map((item) => <Link key={item.href} href={item.href} onClick={() => setMenu(false)}>{item.label}<span aria-hidden="true">↗</span></Link>)}<Link href="/search" onClick={() => setMenu(false)}>Search<span aria-hidden="true">↗</span></Link><Link href="/wishlist" onClick={() => setMenu(false)}>Wishlist<span aria-hidden="true">↗</span></Link></nav>
      <div className="store-menu-support"><Link href="/track-order" onClick={() => setMenu(false)}>Track order</Link><Link href="/contact" onClick={() => setMenu(false)}>Contact</Link></div>
    </StoreOverlay>}
  </>;
}
