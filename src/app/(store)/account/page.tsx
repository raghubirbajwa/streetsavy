import { readEnvironment } from "../../../config/env.ts";
import { storeSupabaseReady } from "../../../lib/supabase/store.ts";
import { listCustomerAddresses } from "../../../lib/auth/addresses.ts";
import { getStoreCustomer } from "../../../lib/auth/store-customer.ts";
import { AccountAuthCard } from "../../../components/store/account-auth-card.tsx";
import { AccountHome, accountSection } from "../../../components/store/account-home.tsx";
import { AccountScene } from "../../../components/store/account-scene.tsx";

export const dynamic = "force-dynamic";
export const metadata = { title: "Account", robots: { index: false, follow: false } };

function noticeFor(tab: "login" | "signup", query: Record<string, string | undefined>) {
  if (query.confirm === "1") return { tone: "status" as const, text: "Check your email to confirm your account, then sign in." };
  if (query.reset === "1") return { tone: "status" as const, text: "Password updated. Sign in with your new password." };
  if (query.error === "credentials") return { tone: "error" as const, text: "Those details don’t match an account. Check them and try again." };
  if (query.error === "mismatch") return { tone: "error" as const, text: "Passwords do not match." };
  if (query.error === "invalid") return { tone: "error" as const, text: tab === "signup" ? "Enter your name, a valid email, and a password of at least 8 characters." : "Enter a valid email and password." };
  if (query.error === "signup") return { tone: "error" as const, text: "Sign-up could not be completed. Try again, or sign in if you already have an account." };
  if (query.error === "fixture") return { tone: "error" as const, text: "This preview uses the demo customer. Email sign-in is turned off." };
  if (query.error === "recovery") return { tone: "error" as const, text: "That link expired. Request a new one." };
  if (query.error === "unavailable") return { tone: "error" as const, text: "Account sign-in is unavailable right now. Try again shortly." };
  if (query.error) return { tone: "error" as const, text: "Sign-in could not be completed. Try again." };
  return null;
}

export default async function AccountPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const query = await searchParams;
  const customer = await getStoreCustomer();
  if (customer) {
    const section = accountSection(query.section);
    const addresses = section === "addresses" ? await listCustomerAddresses() : [];
    const match = query.edit && query.edit !== "new" ? addresses.find((address) => address.id === query.edit) : undefined;
    const editing = section === "addresses" && query.edit === "new" ? "new" : match ?? null;
    const notice = query.error === "invalid"
      ? "Enter a full Indian delivery address: name, email, mobile, street, city, PIN, and state."
      : query.error === "unavailable"
        ? "Addresses are unavailable right now. Try again shortly."
        : null;
    return <AccountHome customer={customer} section={section} addresses={addresses} editing={editing} notice={notice} />;
  }
  const tab = query.tab === "signup" ? "signup" : "login";
  const next = query.next?.startsWith("/") && query.next.length <= 200 ? query.next : "";
  return <AccountScene>
    <AccountAuthCard fixture={!storeSupabaseReady() && readEnvironment().APP_MODE === "fixture"} initialTab={tab} notice={noticeFor(tab, query)} next={next} />
  </AccountScene>;
}
