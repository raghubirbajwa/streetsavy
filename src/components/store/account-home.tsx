import Link from "next/link";
import { stateLabel, type SavedAddress } from "../../lib/auth/addresses.ts";
import { stateCodes, stateNames } from "../../lib/checkout/contracts.ts";
import type { StoreCustomer } from "../../lib/auth/store-customer.ts";
import "./account-home.css";

export type AccountSection = "orders" | "addresses";
export type { SavedAddress };

export function accountSection(value: string | undefined): AccountSection {
  if (value === "addresses") return value;
  return "orders";
}

const ordersPanel = { title: "My orders", count: "0 orders", detail: "You haven’t placed any orders yet." };

export function AccountHome({ customer, section, addresses = [], editing = null, notice = null }: {
  customer: StoreCustomer;
  section: AccountSection;
  addresses?: SavedAddress[];
  editing?: SavedAddress | "new" | null;
  notice?: string | null;
}) {
  const welcome = [customer.firstName, customer.lastName].filter(Boolean).join(" ") || "Signed in";
  return <main id="main" className="store-account-home">
    <div className="store-account-home-rail">
      <p className="store-account-home-kicker">Welcome</p>
      <p className="store-account-home-name">{welcome}</p>
      <nav className="store-account-home-nav" aria-label="Account">
        <Link href="/wishlist">Wishlist</Link>
        <Link href="/account" aria-current={section === "orders" ? "page" : undefined}>My orders</Link>
        <Link href="/account?section=addresses" aria-current={section === "addresses" ? "page" : undefined}>My shipping addresses</Link>
        <form action="/api/v1/auth/store-logout" method="post"><button type="submit">Sign out</button></form>
      </nav>
      <section className="store-account-home-details" aria-labelledby="account-details-title">
        <h2 id="account-details-title">My details</h2>
        <dl>
          <div><dt>First name</dt><dd>{customer.firstName ?? "—"}</dd></div>
          <div><dt>Last name</dt><dd>{customer.lastName ?? "—"}</dd></div>
          <div><dt>Email address</dt><dd>{customer.email ?? "—"}</dd></div>
        </dl>
      </section>
    </div>
    <section className="store-account-home-panel" aria-labelledby="account-panel-title">
      {section === "addresses"
        ? <AddressPanel addresses={addresses} editing={editing} notice={notice} />
        : <>
          <h1 id="account-panel-title">{ordersPanel.title}</h1>
          <p className="store-account-home-count">{ordersPanel.count}</p>
          <p className="store-account-home-empty">{ordersPanel.detail}</p>
        </>}
    </section>
    <p className="store-account-home-help">Can’t find what you’re looking for? <Link href="/contact">Contact us</Link></p>
  </main>;
}

function AddressPanel({ addresses, editing, notice }: { addresses: SavedAddress[]; editing: SavedAddress | "new" | null; notice: string | null }) {
  const current = editing && editing !== "new" ? editing : null;
  return <>
    <h1 id="account-panel-title">My shipping addresses</h1>
    {notice ? <p className="store-account-address-note" role="alert">{notice}</p> : null}
    {editing ? <form className="store-account-address-form" action="/api/v1/account/addresses" method="post">
      {current ? <input type="hidden" name="id" value={current.id} /> : null}
      <input type="hidden" name="country" value="IN" />
      <label htmlFor="address-name">Full name</label>
      <input id="address-name" name="fullName" type="text" autoComplete="name" required maxLength={120} defaultValue={current?.fullName ?? ""} />
      <label htmlFor="address-email">Email</label>
      <input id="address-email" name="email" type="email" autoComplete="email" required maxLength={254} defaultValue={current?.email ?? ""} />
      <label htmlFor="address-phone">Mobile number</label>
      <input id="address-phone" name="phone" type="tel" autoComplete="tel" required maxLength={16} defaultValue={current?.phone ?? ""} />
      <label htmlFor="address-line1">Address line 1</label>
      <input id="address-line1" name="line1" type="text" autoComplete="address-line1" required maxLength={200} defaultValue={current?.line1 ?? ""} />
      <label htmlFor="address-line2">Address line 2 (optional)</label>
      <input id="address-line2" name="line2" type="text" autoComplete="address-line2" maxLength={200} defaultValue={current?.line2 ?? ""} />
      <label htmlFor="address-city">City</label>
      <input id="address-city" name="city" type="text" autoComplete="address-level2" required maxLength={100} defaultValue={current?.city ?? ""} />
      <label htmlFor="address-pin">PIN code</label>
      <input id="address-pin" name="pincode" type="text" inputMode="numeric" autoComplete="postal-code" required maxLength={6} pattern="[1-9][0-9]{5}" defaultValue={current?.postcode ?? ""} />
      <label htmlFor="address-state">State / union territory</label>
      <select id="address-state" name="stateCode" required defaultValue={current?.stateCode ?? ""}>
        <option value="" disabled>Select state</option>
        {stateCodes.map((code, index) => <option key={code} value={code}>{stateNames[index]}</option>)}
      </select>
      <div className="store-account-address-actions">
        <button type="submit">Save address</button>
        <Link href="/account?section=addresses">Cancel</Link>
      </div>
    </form> : <>
      {addresses.map((address) => <div className="store-account-address" key={address.id}>
        <div className="store-account-address-lines">
          {address.isDefault ? <p className="store-account-address-label">Default address</p> : null}
          {address.fullName ? <p>{address.fullName}</p> : null}
          <p>{address.line1}</p>
          {address.line2 ? <p>{address.line2}</p> : null}
          <p>{[address.city, stateLabel(address.stateCode)].filter(Boolean).join(", ")}</p>
          <p>{address.postcode}</p>
        </div>
        <Link href={`/account?section=addresses&edit=${address.id}`}>Edit</Link>
      </div>)}
      <hr className="store-account-address-rule" />
      <Link className="store-account-add" href="/account?section=addresses&edit=new">Add address</Link>
    </>}
  </>;
}
