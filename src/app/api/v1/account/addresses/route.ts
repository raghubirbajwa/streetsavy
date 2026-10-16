import { NextResponse } from "next/server";
import { z } from "zod";
import { readEnvironment } from "../../../../../config/env.ts";
import { addressSchema } from "../../../../../lib/checkout/contracts.ts";
import { storeSupabase } from "../../../../../lib/supabase/store.ts";
import { allowAuthAttempt, readAuthForm, sameOrigin, AuthFormError } from "../../../../../lib/http/security.ts";

export const dynamic = "force-dynamic";

function go(path: string) {
  const response = NextResponse.redirect(new URL(path, readEnvironment().APP_URL), 303);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response("Request origin denied.", { status: 403 });
  if (!allowAuthAttempt("save-address")) return new Response("Too many attempts. Try again shortly.", { status: 429, headers: { "Retry-After": "60" } });
  let form: URLSearchParams;
  try { form = await readAuthForm(request); } catch (error) {
    const failure = error instanceof AuthFormError ? error : new AuthFormError(400);
    return new Response(failure.message, { status: failure.status, headers: { "Cache-Control": "private, no-store" } });
  }
  const id = z.string().uuid().safeParse(form.get("id"));
  const back = id.success ? `/account?section=addresses&edit=${id.data}` : "/account?section=addresses&edit=new";
  const parsed = addressSchema.safeParse({
    fullName: form.get("fullName"),
    email: form.get("email"),
    phone: form.get("phone"),
    line1: form.get("line1"),
    line2: form.get("line2") ?? "",
    city: form.get("city"),
    stateCode: form.get("stateCode"),
    pincode: form.get("pincode"),
    country: "IN",
  });
  if (!parsed.success) return go(`${back}&error=invalid`);
  const supabase = await storeSupabase();
  if (!supabase) return go(`${back}&error=unavailable`);
  const { data, error: userError } = await supabase.auth.getUser();
  if (userError || !data.user) return go("/account?tab=login");
  const saved = await supabase.rpc("save_customer_address", {
    p_full_name: parsed.data.fullName,
    p_email: parsed.data.email,
    p_phone: parsed.data.phone,
    p_line1: parsed.data.line1,
    p_city: parsed.data.city,
    p_postcode: parsed.data.pincode,
    p_state_code: parsed.data.stateCode,
    ...(parsed.data.line2 ? { p_line2: parsed.data.line2 } : {}),
    ...(id.success ? { p_id: id.data } : {}),
  });
  if (saved.error) return go(`${back}&error=invalid`);
  return go("/account?section=addresses");
}
