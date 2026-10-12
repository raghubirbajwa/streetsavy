import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { adminRpc } from "../admin/db.ts";
import { addCartItemSchema, cartRpcResultSchema, emptyCart, updateCartItemSchema, type CartDTO, type CartErrorCode } from "./contracts.ts";

export const GUEST_COOKIE_NAME = "clothing_guest";
export const GUEST_SESSION_DAYS = 30;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
export function hashGuestToken(token: string | undefined): string | null {
  return token && tokenPattern.test(token) ? createHash("sha256").update(token).digest("hex") : null;
}
export const newGuestToken = () => randomBytes(32).toString("base64url");

const statuses: Record<CartErrorCode, number> = { SESSION_REQUIRED: 401, VERSION_CONFLICT: 409, CHECKOUT_IN_PROGRESS: 409, OUT_OF_STOCK: 409, STOCK_CONFLICT: 409, PRODUCT_UNAVAILABLE: 409, PRICE_UNAVAILABLE: 409, QUANTITY_LIMIT: 422, CART_LIMIT: 422, NOT_FOUND: 404, INVALID_PAYLOAD: 422 };
const messages: Record<CartErrorCode, string> = {
  SESSION_REQUIRED: "Your cart session has expired. Start a new cart and add the item again.",
  VERSION_CONFLICT: "Your cart changed in another tab. Review the current cart before trying again.",
  CHECKOUT_IN_PROGRESS: "A checkout is already pending. Resolve that order before changing this cart.",
  OUT_OF_STOCK: "This option is currently sold out.", STOCK_CONFLICT: "The requested quantity is no longer available. Review your cart.",
  PRODUCT_UNAVAILABLE: "This item is no longer available. Choose another item.", QUANTITY_LIMIT: "Choose no more than 10 of each option.",
  PRICE_UNAVAILABLE: "The current total is unavailable. Reduce quantities or remove items before continuing.",
  CART_LIMIT: "Your cart can contain up to 50 different options.", NOT_FOUND: "This item is no longer in your cart.", INVALID_PAYLOAD: "Check the item and quantity and try again.",
};
export class CartError extends Error {
  readonly status: number;
  readonly code: CartErrorCode;
  readonly currentCart: CartDTO;
  constructor(code: CartErrorCode, currentCart: CartDTO) { super(messages[code]); this.name = "CartError"; this.status = statuses[code]; this.code = code; this.currentCart = currentCart; }
}

export type CartRpc = <T = unknown>(name: string, args: Record<string, unknown>) => Promise<T>;
export function createCartService(rpc: CartRpc = adminRpc) {
  async function call(action: string, token: string | undefined, payload: Record<string, unknown> = {}, candidate: string | null = null) {
    const parsed = cartRpcResultSchema.safeParse(await rpc("guest_cart", { p_action: action, p_token_hash: hashGuestToken(token), p_new_token_hash: hashGuestToken(candidate ?? undefined), p_payload: payload }));
    if (!parsed.success) throw new Error("Cart response validation failed");
    const result = parsed.data;
    if (result.error) throw new CartError(result.error, result.cart);
    return result;
  }
  return {
    async get(token: string | undefined): Promise<CartDTO> { if (!hashGuestToken(token)) return emptyCart(); return (await call("get", token)).cart; },
    async create(token: string | undefined) {
      const candidate = newGuestToken();
      const result = await call("create", token, {}, candidate);
      if (!result.sessionExpiresAt) throw new Error("Cart session expiry is missing");
      return { cart: result.cart, token: result.createdSession ? candidate : token!, expiresAt: new Date(result.sessionExpiresAt) };
    },
    async add(token: string | undefined, input: unknown) { return (await call("add", token, addCartItemSchema.parse(input))).cart; },
    async update(token: string | undefined, variantId: string, input: unknown) {
      return (await call("set", token, { ...updateCartItemSchema.parse(input), variantId: z.string().uuid().parse(variantId) })).cart;
    },
    async remove(token: string | undefined, variantId: string, cartVersion: number) {
      const payload = z.object({ variantId: z.string().uuid(), cartVersion: z.number().int().positive().max(2_147_483_647) }).strict().parse({ variantId, cartVersion });
      return (await call("remove", token, payload)).cart;
    },
  };
}
export const cartService = createCartService();
