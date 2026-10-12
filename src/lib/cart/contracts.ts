import { z } from "zod";
import { catalogUuidSchema, clothingSizeSchema, moneyPaiseSchema } from "../validation/catalog.ts";

export const CART_QUANTITY_LIMIT = 10;
export const CART_LINE_LIMIT = 50;
const version = z.number().int().positive().max(2_147_483_647);
export const cartQuantitySchema = z.number().int().min(1).max(CART_QUANTITY_LIMIT);
export const addCartItemSchema = z.object({ variantId: catalogUuidSchema, quantity: cartQuantitySchema, cartVersion: version }).strict();
export const updateCartItemSchema = z.object({ quantity: cartQuantitySchema, cartVersion: version }).strict();
export const cartLineSchema = z.object({
  variantId: catalogUuidSchema, productId: catalogUuidSchema, slug: z.string().nullable(), title: z.string(),
  colorKey: z.string(), colorLabel: z.string(), size: clothingSizeSchema, quantity: cartQuantitySchema,
  unitPricePaise: moneyPaiseSchema.nullable(), lineSubtotalPaise: moneyPaiseSchema.nullable(),
  available: z.boolean(), unavailableReason: z.enum(["product_unavailable", "variant_unavailable", "out_of_stock", "insufficient_stock", "price_unavailable"]).nullable(),
  image: z.object({ publicKey: z.string(), alt: z.string(), width: z.number().int().positive(), height: z.number().int().positive() }).strict().nullable(),
}).strict();
export const cartSchema = z.object({
  id: catalogUuidSchema.nullable(), version: z.number().int().nonnegative(), currency: z.literal("INR"),
  lines: z.array(cartLineSchema).max(CART_LINE_LIMIT), itemCount: z.number().int().nonnegative(), subtotalPaise: moneyPaiseSchema.nullable(),
  hasUnavailableItems: z.boolean(),
  pendingCheckout: z.object({ orderId: catalogUuidSchema, status: z.literal("pending_payment"), href: z.string() }).strict().nullable(),
}).strict();
export type CartLine = z.infer<typeof cartLineSchema>;
export type CartDTO = z.infer<typeof cartSchema>;
export const emptyCart = (): CartDTO => ({ id: null, version: 0, currency: "INR", lines: [], itemCount: 0, subtotalPaise: 0, hasUnavailableItems: false, pendingCheckout: null });

export const cartErrorCodeSchema = z.enum(["SESSION_REQUIRED", "VERSION_CONFLICT", "CHECKOUT_IN_PROGRESS", "OUT_OF_STOCK", "STOCK_CONFLICT", "PRODUCT_UNAVAILABLE", "PRICE_UNAVAILABLE", "QUANTITY_LIMIT", "CART_LIMIT", "NOT_FOUND", "INVALID_PAYLOAD"]);
export type CartErrorCode = z.infer<typeof cartErrorCodeSchema>;
export const cartRpcResultSchema = z.object({
  cart: cartSchema,
  error: cartErrorCodeSchema.optional(),
  sessionExpiresAt: z.string().datetime({ offset: true }).optional(),
  createdSession: z.boolean().optional(),
}).strict();
