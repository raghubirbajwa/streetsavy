"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
export default function AdminNav({owner}:{owner:boolean}) {
  const pathname=usePathname();
  const links=[["/admin","Overview"],["/admin/products","Products"],["/admin/orders","Orders"],["/admin/returns","Returns"],["/admin/size-guides","Size guides"],["/admin/media","Media"],["/admin/collections","Collections"],["/admin/content","Homepage"],["/admin/operations","Operations"],...(owner?[["/admin/settings","Settings"]]:[])];
  return <nav aria-label="Admin navigation">{links.map(([href,label])=><Link key={href} href={href!} aria-current={(href === "/admin" ? pathname===href:pathname.startsWith(href!)) ? "page":undefined}>{label}</Link>)}</nav>;
}
