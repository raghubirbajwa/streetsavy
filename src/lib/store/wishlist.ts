export const wishlistStorageKey = "clothing-store:wishlist:v1";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validWishlistId(id: string) { return uuid.test(id); }
export function decodeWishlist(raw: string | null): string[] {
  if (!raw || raw.length > 20000) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1 || !("productIds" in value) || !Array.isArray(value.productIds)) return [];
    return [...new Set(value.productIds.filter((id): id is string => typeof id === "string" && validWishlistId(id)).map((id) => id.toLowerCase()))].slice(0, 100);
  } catch { return []; }
}
export function encodeWishlist(ids: string[]) { return JSON.stringify({ version: 1, productIds: [...new Set(ids.filter(validWishlistId).map((id) => id.toLowerCase()))].slice(0, 100) }); }
