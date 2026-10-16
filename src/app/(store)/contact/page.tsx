import Link from "next/link";
import { StoreInfoHeroPage } from "../../../components/store/store-info-hero-page.tsx";
import { publicStoreSettings } from "../../../lib/catalog/storefront.ts";

export const metadata = { title: "Contact" };

export default async function Contact() {
  const settings = await publicStoreSettings();
  return (
    <StoreInfoHeroPage kicker="HERE TO HELP" title="Contact">
      {settings?.contact ? (
        <>
          <p>Get in touch using the store’s published contact details.</p>
          {settings.contact.email && <p><a href={`mailto:${settings.contact.email}`}>{settings.contact.email}</a></p>}
          {settings.contact.phone && <p><a href={`tel:${settings.contact.phone.replace(/[^+\d]/g, "")}`}>{settings.contact.phone}</a></p>}
        </>
      ) : (
        <p>Support contact details have not been published yet. This preview does not send support messages.</p>
      )}
      <div className="store-info-links">
        <Link href="/size-guide">Size guide</Link>
        <Link href="/policies/returns">Returns information</Link>
        <Link href="/track-order">Track order</Link>
      </div>
    </StoreInfoHeroPage>
  );
}
