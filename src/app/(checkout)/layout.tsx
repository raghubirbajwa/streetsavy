import type { Metadata } from "next";
import { StoreProvider } from "../../components/store/store-provider.tsx";
import { CheckoutHeader } from "../../components/store/checkout-header.tsx";
import { getStoreCustomer } from "../../lib/auth/store-customer.ts";
import "../(store)/store.css";
import "../../components/store/checkout.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Checkout — YOUR BRAND", robots: { index: false, follow: false } };

export default async function CheckoutLayout({ children }: { children: React.ReactNode }) {
  const customer = await getStoreCustomer();
  return (
    <div className="store checkout-shell">
      <StoreProvider>
        <CheckoutHeader {...(customer?.email ? { email: customer.email } : {})} />
        {children}
      </StoreProvider>
    </div>
  );
}
