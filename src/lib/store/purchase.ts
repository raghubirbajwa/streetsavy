import type { PublicProduct } from "../validation/catalog.ts";
export type Variant = PublicProduct["variants"][number];
export type Selection = { colorKey: string; size: Variant["size"] | null };
export const sizeOrder: Variant["size"][] = ["XS", "S", "M", "L", "XL", "XXL", "ONE_SIZE"];
export function initialSelection(product: PublicProduct, variantId?: string): Selection {
  const variant = product.variants.find((row) => row.id === variantId);
  return variant ? { colorKey: variant.colorKey, size: variant.size } : { colorKey: product.variants[0]?.colorKey ?? "", size: null };
}
export function selectColor(product: PublicProduct, selection: Selection, colorKey: string): Selection {
  if (!product.variants.some((row) => row.colorKey === colorKey)) return selection;
  return { colorKey, size: product.variants.some((row) => row.colorKey === colorKey && row.size === selection.size && row.available) ? selection.size : null };
}
export function selectedVariant(product: PublicProduct, selection: Selection) {
  return product.variants.find((row) => row.colorKey === selection.colorKey && row.size === selection.size) ?? null;
}
export function productColors(variants: Variant[]) { return [...new Map(variants.map((v) => [v.colorKey, { key: v.colorKey, label: v.colorLabel, hex: v.colorHex }])).values()]; }
export function productMedia(product: PublicProduct, colorKey: string) {
  // Never substitute photography assigned to a different colour.
  return product.media.filter((media) => media.colorKey === null || media.colorKey === colorKey).sort((a, b) => Number(b.isCover) - Number(a.isCover) || Number(b.colorKey === colorKey) - Number(a.colorKey === colorKey) || a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
}
export function formatMoney(paise: number) { return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: paise % 100 ? 2 : 0 }).format(paise / 100); }
export function mediaUrl(key: string) { return `/api/v1/media/${key.split("/").map(encodeURIComponent).join("/")}`; }
export function sizeLabel(size: string) { return size === "ONE_SIZE" ? "One size" : size; }
