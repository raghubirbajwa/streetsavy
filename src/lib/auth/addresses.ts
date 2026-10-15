import "server-only";
import { addressSchema, stateCodes, stateNames, type Address } from "../checkout/contracts.ts";
import { storeSupabase, storeSupabaseReady } from "../supabase/store.ts";

export type SavedAddress = {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  line1: string;
  line2: string;
  city: string;
  postcode: string;
  stateCode: string;
  country: string;
  isDefault: boolean;
};

export function stateLabel(code: string): string {
  const index = stateCodes.indexOf(code as (typeof stateCodes)[number]);
  return index >= 0 ? stateNames[index] : "";
}

/** Default India address that checkout can place into the delivery form. */
export function checkoutPrefill(addresses: SavedAddress[]): Address | null {
  const row = addresses.find((address) => address.isDefault);
  if (!row?.fullName || !row.phone || !row.email || !row.stateCode || !/^[1-9]\d{5}$/.test(row.postcode)) return null;
  const parsed = addressSchema.safeParse({
    fullName: row.fullName,
    phone: row.phone,
    email: row.email,
    line1: row.line1,
    ...(row.line2 ? { line2: row.line2 } : {}),
    city: row.city,
    stateCode: row.stateCode,
    pincode: row.postcode,
    country: "IN",
  });
  return parsed.success ? parsed.data : null;
}

/** Addresses visible to the signed-in shopper. Row level security hides every other row. */
export async function listCustomerAddresses(): Promise<SavedAddress[]> {
  if (!storeSupabaseReady()) return [];
  const supabase = await storeSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("customer_addresses")
    .select("id, full_name, email, phone, line1, line2, city, postcode, state_code, country, is_default")
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return data.map((row) => ({
    id: row.id,
    fullName: row.full_name ?? "",
    email: row.email ?? "",
    phone: row.phone ?? "",
    line1: row.line1,
    line2: row.line2 ?? "",
    city: row.city,
    postcode: row.postcode,
    stateCode: row.state_code ?? "",
    country: row.country,
    isDefault: row.is_default,
  }));
}
