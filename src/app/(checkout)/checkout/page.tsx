import { readEnvironment } from "../../../config/env.ts";
import { checkoutPrefill, listCustomerAddresses } from "../../../lib/auth/addresses.ts";
import { getStoreCustomer } from "../../../lib/auth/store-customer.ts";
import { CheckoutClient } from "../../../components/store/checkout-client.tsx";

export const dynamic = "force-dynamic";

export default async function CheckoutPage() {
  const customer = await getStoreCustomer();
  const savedAddress = customer ? checkoutPrefill(await listCustomerAddresses()) : null;
  return (
    <main id="main" className="checkout-scene">
      <CheckoutClient fixture={readEnvironment().APP_MODE === "fixture"} savedAddress={savedAddress} />
    </main>
  );
}
