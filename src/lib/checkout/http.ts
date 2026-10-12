import "server-only";
import { randomBytes, randomInt, randomUUID, createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { NextResponse, type NextRequest } from "next/server";
import { readEnvironment, integrationConfig, EnvironmentError } from "../../config/env.ts";
import { adminRpc } from "../admin/db.ts";
import { ApiError, readJson } from "../http/admin.ts";
import { allowAuthAttempt, sameOrigin } from "../http/security.ts";
import { guestToken } from "../cart/http.ts";
import { cartService, GUEST_COOKIE_NAME, hashGuestToken } from "../cart/service.ts";
import { requestSupabase } from "../supabase/server.ts";
import { checkoutService } from "./service.ts";
import { sessionInputSchema, recoveryRequestSchema, recoveryVerifySchema } from "./contracts.ts";
import { shippingQuote, validSignature } from "./providers.ts";
import { returnsService } from "../fulfillment/returns-service.ts";
import { shippingService } from "../fulfillment/shipping-service.ts";

const failures:Record<string,[number,string]>={
  SESSION_REQUIRED:[401,"Your cart session expired. Add your items again."],CART_EMPTY:[409,"Your cart is empty."],QUOTE_STALE:[409,"Your cart, prices or delivery quote changed. Review a fresh quote before paying."],CHECKOUT_IN_PROGRESS:[409,"An order is already pending. Open your cart to resume that order."],STOCK_CONFLICT:[409,"An option is no longer available in that quantity. Review your cart."],PRICE_UNAVAILABLE:[409,"The current price is unavailable."],PACKAGING_UNSUPPORTED:[422,"This cart cannot fit one configured parcel. Reduce quantities or contact support."],TAX_UNCONFIGURED:[503,"Checkout is unavailable until the store configures its tax policy."],UNSERVICEABLE_PIN:[422,"Delivery is unavailable for this PIN. Try another address."],INTEGRATION_UNCONFIGURED:[503,"Checkout is not configured yet. Your cart is saved."],PAYMENT_MISMATCH:[409,"Payment details need review. Do not make another payment."],INVALID_SIGNATURE:[403,"Payment verification was rejected."],NOT_FOUND:[404,"This order is unavailable in this session. Use Track order to verify access."],FORBIDDEN:[403,"This action is unavailable."],IDEMPOTENCY_CONFLICT:[409,"This payment request changed. Resume the existing order."],UPSTREAM_UNKNOWN:[202,"Payment status is uncertain. Keep this order and refresh its status."],UPSTREAM_UNAVAILABLE:[503,"The provider is unavailable. Your cart is saved; please retry."],UPSTREAM_REJECTED:[502,"The provider rejected the request."],INVALID_PAYLOAD:[422,"Check the supplied details."],RATE_LIMIT:[429,"Too many requests. Wait a minute and try again."],OTP_INVALID:[400,"The code is invalid or expired. Request a new code."],RECONCILIATION_REQUIRED:[409,"Payment status needs review. Do not make another payment."],OPERATION_BUSY:[202,"Payment is being prepared. Keep this order open."],LEASE_LOST:[503,"The operation is still being reconciled. Try again shortly."]};
export async function checkoutResponse(work:()=>Promise<unknown>){
  const requestId=randomUUID();const headers={"Cache-Control":"private, no-store, max-age=0","X-Robots-Tag":"noindex, nofollow","X-Request-Id":requestId};
  try{const result=await work();if(result instanceof Response){for(const[k,v]of Object.entries(headers))result.headers.set(k,v);return result;}return NextResponse.json({data:result,meta:{requestId}},{headers});}
  catch(error){
    if(error instanceof z.ZodError)return NextResponse.json({error:{code:"INVALID_FIELDS",message:"Check the supplied details.",fieldErrors:error.issues.map(i=>({path:i.path.join("."),message:i.message}))},requestId},{status:422,headers});
    const code=error instanceof EnvironmentError?"INTEGRATION_UNCONFIGURED":error instanceof Error&&Object.hasOwn(failures,error.message)?error.message:"UNAVAILABLE";
    const[status,message]=failures[code]??[503,"Checkout is temporarily unavailable. Your order and cart are saved."];
    if(error instanceof ApiError)return NextResponse.json({error:{code:error.code,message:error.message},requestId},{status:error.status,headers});
    return NextResponse.json({error:{code,message},requestId},{status,headers});
  }
}
export function entry(request:NextRequest,action:string){
  if(!sameOrigin(request))throw new Error("FORBIDDEN");
  if(!allowAuthAttempt(`m4:${action}:${hashGuestToken(guestToken(request))??"anonymous"}`))throw new Error("RATE_LIMIT");
}
export async function verifiedUserId(){
  if(readEnvironment().APP_MODE==="fixture")return null;
  const client=await requestSupabase();const{data,error}=await client.auth.getUser();return !error&&data.user?data.user.id:null;
}
export async function checkoutAction(request:NextRequest,action:string){
  entry(request,action);const input=await readJson(request,8192);
  if(action==="quote")return checkoutService.quote(guestToken(request),input);
  if(action==="sessions"){
    const value=sessionInputSchema.parse(input);const result=await checkoutService.start(guestToken(request),value.quoteId,request.headers.get("idempotency-key")??"");
    return NextResponse.json({data:result},{status:result.status==="ready"?201:202});
  }
  if(action==="fixture")return checkoutService.simulate(guestToken(request),input);
  throw new Error("NOT_FOUND");
}
export async function orderAction(request:NextRequest,id:string,action:string){
  entry(request,action);const user=await verifiedUserId();
  if(action==="payment"){z.object({}).strict().parse(await readJson(request,2048));return checkoutService.resume(id,guestToken(request),user);}
  if(action==="reconcile"){z.object({}).strict().parse(await readJson(request,2048));return checkoutService.refresh(id,guestToken(request),user);}
  if(action==="cancel"){const input=await readJson(request,4096);await returnsService.cancelCustomer(id,guestToken(request),input,user);return checkoutService.receipt(id,guestToken(request),user);}
  throw new Error("NOT_FOUND");
}

type Challenge={hash:string;email:string;orderNumber:string;expires:number;attempts:number};
const challenges=new Map<string,Challenge>();
const digest=(value:string)=>createHash("sha256").update(value).digest("hex");
const challengeCookie="clothing_fixture_recovery";
export async function recoveryAction(request:NextRequest,action:string){
  entry(request,`recovery:${action}`);if(!allowAuthAttempt(`m4:recovery-global:${action}`))throw new Error("RATE_LIMIT");
  const env=readEnvironment();const input=await readJson(request,4096);
  if(action==="request"){
    const value=recoveryRequestSchema.parse(input);
    if(env.APP_MODE==="fixture"){
      for(const[key,row]of challenges)if(row.expires<Date.now())challenges.delete(key);
      const id=randomBytes(32).toString("base64url"),token=String(randomInt(100000,1000000));
      challenges.set(digest(id),{hash:digest(token),email:value.email,orderNumber:value.orderNumber,expires:Date.now()+600000,attempts:0});
      const result=NextResponse.json({data:{accepted:true,fixtureToken:token,message:"Fixture code only — no email sent."}});
      result.cookies.set(challengeCookie,id,{httpOnly:true,sameSite:"lax",secure:env.APP_URL.startsWith("https:"),maxAge:600,path:"/"});return result;
    }
    // Never query orders here. Every valid address takes the same provider path and response.
    const client=await requestSupabase();await client.auth.signInWithOtp({email:value.email,options:{shouldCreateUser:true}});
    return {accepted:true,message:"If delivery is available, a verification code will arrive. Check your email."};
  }
  if(action!=="verify")throw new Error("NOT_FOUND");
  const value=recoveryVerifySchema.parse(input);let userId:string|null=null;
  if(env.APP_MODE==="fixture"){
    const key=digest(request.cookies.get(challengeCookie)?.value??"");const challenge=challenges.get(key);
    if(!challenge||challenge.expires<Date.now()||++challenge.attempts>5)throw new Error("OTP_INVALID");
    if(challenge.email!==value.email||challenge.orderNumber!==value.orderNumber||!timingSafeEqual(Buffer.from(challenge.hash,"hex"),Buffer.from(digest(value.token),"hex")))throw new Error("OTP_INVALID");
    challenges.delete(key);
  }else{
    const client=await requestSupabase();const verified=await client.auth.verifyOtp({email:value.email,token:value.token,type:"email"});
    if(verified.error)throw new Error("OTP_INVALID");
    const current=await client.auth.getUser();if(current.error||!current.data.user?.email_confirmed_at||current.data.user.email?.toLowerCase()!==value.email)throw new Error("OTP_INVALID");userId=current.data.user.id;
  }
  const guest=await cartService.create(guestToken(request));
  const id=z.string().uuid().parse(await adminRpc("checkout_recover",{p_order_number:value.orderNumber,p_email:value.email,p_token_hash:hashGuestToken(guest.token),p_user_id:userId}));
  const result=NextResponse.json({data:{orderId:id,href:`/orders/${id}`}});result.cookies.set(GUEST_COOKIE_NAME,guest.token,{httpOnly:true,sameSite:"lax",secure:env.APP_URL.startsWith("https:"),expires:guest.expiresAt,path:"/"});result.cookies.delete(challengeCookie);return result;
}
export async function rawBytes(request:Request,limit=262144){
  const reader=request.body?.getReader();if(!reader)throw new Error("INVALID_PAYLOAD");const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const{value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw new ApiError(413,"BODY_TOO_LARGE","Request body is too large.");}chunks.push(value);}}finally{reader.releaseLock();}
  return Buffer.concat(chunks);
}
export async function razorpayWebhook(request:NextRequest){
  const env=readEnvironment();if(env.APP_MODE==="fixture")throw new Error("NOT_FOUND");
  const config=integrationConfig("razorpayWebhook",env);const bytes=await rawBytes(request);
  if(!validSignature(bytes,request.headers.get("x-razorpay-signature"),config.RAZORPAY_WEBHOOK_SECRET))throw new Error("INVALID_SIGNATURE");
  const eventId=request.headers.get("x-razorpay-event-id");if(eventId!==null)z.string().min(1).max(200).parse(eventId);
  return checkoutService.receiveWebhook(bytes,eventId);
}
export async function runCheckoutJobs(request:NextRequest){
  const env=readEnvironment();
  if(env.APP_MODE==="fixture")entry(request,"fixture-jobs");
  else{const configured=integrationConfig("jobs",env).JOBS_SECRET;const supplied=request.headers.get("authorization")??"";if(!timingSafeEqual(createHash("sha256").update(supplied).digest(),createHash("sha256").update(`Bearer ${configured}`).digest()))throw new Error("FORBIDDEN");}
  const checkout=await checkoutService.runJobs();const shipping=await shippingService.runJobs();const refunds=await returnsService.runJobs();
  return {claimed:checkout.claimed+shipping.claimed+refunds.claimed,done:checkout.done+shipping.done+refunds.done,failed:checkout.failed+shipping.failed+refunds.failed,checkout,shipping,refunds};
}
export async function serviceability(request:NextRequest){
  entry(request,"serviceability");const value=z.object({pincode:z.string().regex(/^[1-9]\d{5}$/),variantId:z.string().uuid().optional(),quantity:z.number().int().min(1).max(10).optional()}).strict().parse(await readJson(request,2048));
  // Product guidance is nonbinding. A full cart quote checks its actual warehouse/parcel.
  if(readEnvironment().APP_MODE==="live")throw new Error("INTEGRATION_UNCONFIGURED");
  const quote=await shippingQuote({pickupPincode:"560001",deliveryPincode:value.pincode,weightG:500,lengthCm:40,widthCm:30,heightCm:15});
  return {serviceable:quote.serviceable,message:quote.serviceable?"Fixture estimate only. Your complete cart and address are checked at checkout.":"Fixture delivery unavailable for this PIN."};
}
