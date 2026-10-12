"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { addressSchema, quoteSchema, sessionSchema, receiptSchema, stateCodes, type Quote, type CheckoutSession, type Receipt } from "../../lib/checkout/contracts.ts";
import { formatMoney, sizeLabel } from "../../lib/store/purchase.ts";
import { useStore } from "./store-provider.tsx";
import "./checkout.css";
import { OrderFulfillment } from "./order-fulfillment.tsx";

async function api<T>(path:string,schema:z.ZodType<T>,body?:unknown,key?:string):Promise<T>{
  const response=await fetch(`/api/v1/${path}`,{method:body===undefined?"GET":"POST",cache:"no-store",signal:AbortSignal.timeout(30000),headers:{"Content-Type":"application/json",...(key?{"Idempotency-Key":key}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const data=await response.json();if(data.error)throw new Error(data.error.message??"Please retry.");return schema.parse(data.data);
}
type RazorpayResponse={razorpay_payment_id:string;razorpay_order_id:string;razorpay_signature:string};
declare global {interface Window {Razorpay?:new(options:Record<string,unknown>)=>{open:()=>void}}}
let checkoutScript:Promise<void>|undefined;
function openOrderDocument(orderId:string){
  // Payment/access changes need a fresh document and store context using the updated HttpOnly cookies.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign(`/orders/${orderId}`);
}
async function openPayment(session:CheckoutSession,onStatus:(message:string)=>void){
  if(session.fixture||!session.keyId||!session.razorpayOrderId||session.status!=="ready")throw new Error("Payment is still being prepared. Open the order status.");
  onStatus("Opening Razorpay payment…");
  if(!window.Razorpay){checkoutScript??=new Promise<void>((resolve,reject)=>{
    const script=document.createElement("script");
    const fail=()=>{clearTimeout(timer);checkoutScript=undefined;script.remove();reject(new Error("Payment window unavailable. Resume this order to retry."));};
    const timer=setTimeout(fail,15000);
    script.src="https://checkout.razorpay.com/v1/checkout.js";script.async=true;
    script.onload=()=>{clearTimeout(timer);resolve();};script.onerror=fail;document.head.appendChild(script);
  });await checkoutScript;}
  if(!window.Razorpay){checkoutScript=undefined;throw new Error("Payment window unavailable. Resume this order to retry.");}
  const Razorpay=window.Razorpay;
  await new Promise<void>((resolve)=>{
    let verifying=false;
    const go=()=>{openOrderDocument(session.orderId);resolve();};
    onStatus("Complete payment in the Razorpay window. Closing it leaves this order pending.");
    new Razorpay({key:session.keyId,order_id:session.razorpayOrderId,amount:session.amountPaise,currency:"INR",name:"YOUR BRAND",description:"Clothing order",modal:{ondismiss:()=>{if(!verifying)go();}},handler:async(value:RazorpayResponse)=>{
      verifying=true;onStatus("Verifying payment… Please wait for the server to confirm capture.");
      try{await api("payments/razorpay/verify",receiptSchema,{orderId:session.orderId,razorpayPaymentId:value.razorpay_payment_id,razorpayOrderId:value.razorpay_order_id,razorpaySignature:value.razorpay_signature});}
      catch{/* Receipt remains server-authoritative when verification is unavailable. */}finally{go();}
    }}).open();
  });
}
const stateNames=["Andaman and Nicobar Islands","Andhra Pradesh","Arunachal Pradesh","Assam","Bihar","Chandigarh","Chhattisgarh","Dadra and Nagar Haveli and Daman and Diu","Delhi","Goa","Gujarat","Haryana","Himachal Pradesh","Jammu and Kashmir","Jharkhand","Karnataka","Kerala","Ladakh","Lakshadweep","Madhya Pradesh","Maharashtra","Manipur","Meghalaya","Mizoram","Nagaland","Odisha","Punjab","Puducherry","Rajasthan","Sikkim","Tamil Nadu","Telangana","Tripura","Uttar Pradesh","Uttarakhand","West Bengal"];
function ModeNote({fixture}:{fixture:boolean}){return <p className="checkout-mode">{fixture?"FIXTURE CHECKOUT · No money, shipment or email. Delivery and tax values are samples. Use test details only.":"Review the final total before opening Razorpay. Prepaid INR payments."}</p>;}
export function CheckoutClient({fixture}:{fixture:boolean}){
  const store=useStore(),cart=store.cart;const[quote,setQuote]=useState<Quote|null>(null);const[busy,setBusy]=useState(false);const[error,setError]=useState("");const[reviewed,setReviewed]=useState(false);const[pending,setPending]=useState<CheckoutSession|null>(null);const[paymentNotice,setPaymentNotice]=useState("");const key=useRef("");const lock=useRef(false);const[now,setNow]=useState(()=>Date.now());
  useEffect(()=>{const tick=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(tick);},[]);
  // Invalidate before committing a render so a changed cart never exposes the old payable quote.
  if(quote&&cart&&cart.version!==quote.cartVersion){setQuote(null);setReviewed(false);setError("Your cart changed. Review a fresh quote.");}
  async function requestQuote(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();if(lock.current||!cart)return;lock.current=true;setBusy(true);setError("");setQuote(null);setReviewed(false);
    try{const address=addressSchema.parse(Object.fromEntries(new FormData(event.currentTarget)));setQuote(await api("checkout/quote",quoteSchema,{cartVersion:cart.version,address}));key.current=crypto.randomUUID();}
    catch(e){setError(e instanceof z.ZodError?e.issues.map(i=>`${i.path.join(".")}: ${i.message}`).join(" "):e instanceof Error?e.message:"Quote unavailable.");}
    finally{lock.current=false;setBusy(false);}
  }
  async function pay(){if(!quote||!reviewed||lock.current)return;lock.current=true;setBusy(true);setError("");
    try{const session=await api("checkout/sessions",sessionSchema,{quoteId:quote.quoteId},key.current);setPending(session);if(session.fixture||session.status!=="ready")openOrderDocument(session.orderId);else await openPayment(session,setPaymentNotice);}
    catch(e){setError(e instanceof Error?e.message:"Payment preparation failed. Retry this same request.");}finally{lock.current=false;setBusy(false);}
  }
  if(store.cartLoading&&!cart)return <p role="status">Loading checkout…</p>;
  if(cart?.pendingCheckout)return <section className="checkout-card"><h2>You have a pending order.</h2><p>Resolve its payment status before starting another checkout.</p><Link className="store-primary-button" href={`/orders/${cart.pendingCheckout.orderId}`}>Resume order</Link></section>;
  if(!cart?.lines.length)return <section className="checkout-card"><h2>Your cart is empty.</h2><Link className="store-primary-button" href="/collections/all">Explore clothing</Link></section>;
  if(cart.hasUnavailableItems)return <section className="checkout-card"><h2>Review your cart first.</h2><p>Remove unavailable items or reduce quantities.</p><Link href="/cart">Return to cart</Link></section>;
  const expired=quote?new Date(quote.expiresAt).getTime()<=now:false;
  return <><ModeNote fixture={fixture}/><div className="checkout-grid"><section className="checkout-card"><p className="purchase-kicker">01 / Delivery details</p><h2>Where should it go?</h2><form onSubmit={requestQuote} onChange={()=>{if(quote){setQuote(null);setReviewed(false);}}}><fieldset disabled={busy||!!pending}><div className="checkout-fields">{([['fullName','Full name','name','text'],['email','Email','email','email'],['phone','Mobile number','tel','tel'],['line1','Address line 1','address-line1','text'],['line2','Address line 2 (optional)','address-line2','text'],['city','City','address-level2','text'],['pincode','PIN code','postal-code','text']] as const).map(([name,label,complete,type])=><label key={name}>{label}<input name={name} type={type} autoComplete={`shipping ${complete}`} required={name!=="line2"} maxLength={name==='pincode'?6:name==='phone'?16:200} {...(name==='pincode'?{inputMode:'numeric' as const,pattern:'[1-9][0-9]{5}'}:{})}/></label>)}<label>State / union territory<select name="stateCode" required defaultValue=""><option value="" disabled>Select state</option>{stateCodes.map((code,i)=><option key={code} value={code}>{stateNames[i]}</option>)}</select></label><input type="hidden" name="country" value="IN"/></div><p>India only. Address details are not saved in browser storage.</p><button className="store-primary-button" disabled={busy} type="submit">{busy?"Preparing…":"Get delivery quote"}</button></fieldset></form></section><section className="checkout-card" aria-live="polite"><p className="purchase-kicker">02 / Review & pay</p><h2>Your order</h2><ul className="checkout-lines">{cart.lines.map(line=><li key={line.variantId}><span>{line.title}<small>{line.colorLabel} / {sizeLabel(line.size)} × {line.quantity}</small></span><strong>{line.lineSubtotalPaise===null?'Unavailable':formatMoney(line.lineSubtotalPaise)}</strong></li>)}</ul>{quote?<><p>{quote.deliveryLabel}</p><dl className="checkout-totals"><div><dt>Items</dt><dd>{formatMoney(quote.itemsPayablePaise)}</dd></div><div><dt>Delivery</dt><dd>{formatMoney(quote.shippingFeePaise)}</dd></div>{quote.taxBreakdown.map(tax=><div key={tax.label}><dt>{tax.label} ({tax.ratePercent}%)</dt><dd>{formatMoney(tax.includedPaise)}</dd></div>)}<div className="checkout-total"><dt>Total</dt><dd>{formatMoney(quote.totalPaise)}</dd></div></dl><p>{expired?"This quote expired. Get a fresh quote and review its total.":`Quote valid for ${Math.max(0,Math.ceil((new Date(quote.expiresAt).getTime()-now)/60000))} more minute(s). Stock is reserved only when you continue.`}</p><label className="checkout-confirm"><input type="checkbox" checked={reviewed} disabled={expired||busy||!!pending} onChange={e=>setReviewed(e.target.checked)}/>I have reviewed the address and total.</label><button className="store-primary-button" disabled={!reviewed||expired||busy||!!pending} onClick={()=>void pay()}>{busy?"Preparing payment…":fixture?"Continue to fixture payment":`Pay ${formatMoney(quote.totalPaise)}`}</button></>:<p>Enter your delivery details to see the final total.</p>}{paymentNotice&&<p role="status">{paymentNotice}</p>}{pending&&<p><Link href={`/orders/${pending.orderId}`}>Open pending order</Link></p>}{error&&<p className="purchase-error" role="alert">{error}</p>}</section></div></>;
}

export function OrderClient({id}:{id:string}){
  return <OrderDetails key={id} id={id}/>;
}
function OrderDetails({id}:{id:string}){
  const store=useStore();const[order,setOrder]=useState<Receipt|null>(null);const[paymentSession,setPaymentSession]=useState<CheckoutSession|null>(null);const[error,setError]=useState("");const[busy,setBusy]=useState(false);const[notice,setNotice]=useState("");const guard=useRef(false);const revision=useRef(0);
  useEffect(()=>{
    let disposed=false;
    void api(`orders/${id}`,receiptSchema).then(value=>{if(!disposed)setOrder(value);}).catch(e=>{if(!disposed)setError(e instanceof Error?e.message:"Order unavailable.");});
    return()=>{disposed=true;};
  },[id]);
  useEffect(()=>{
    if(order?.orderStatus!=="pending_payment")return;
    let disposed=false;let timer:ReturnType<typeof setTimeout>|undefined;let attempt=0;let operationId:string|undefined;
    const poll=async()=>{
      const observed=revision.current;
      try{
        if(guard.current)return;
        const receipt=await api(`orders/${id}`,receiptSchema);
        if(disposed||observed!==revision.current)return;
        setOrder(receipt);
        if(receipt.orderStatus!=="pending_payment")return;
        if(receipt.paymentStatus==="unpaid"&&!receipt.attentionReason){
          // Discover and observe the existing operation. Polling never creates another order or charge.
          const session=operationId?await api(`operations/${operationId}`,sessionSchema):await api(`orders/${id}/payment`,sessionSchema,{});
          if(disposed||observed!==revision.current)return;
          operationId=session.operationId;setPaymentSession(session);
        }
      }catch(e){if(!disposed&&observed===revision.current)setError(e instanceof Error?e.message:"Automatic status check unavailable. Use Refresh payment status.");}
      finally{
        if(!disposed){attempt++;if(attempt<8)timer=setTimeout(()=>void poll(),Math.min(1000*2**attempt,8000));else setNotice("Automatic checks paused. Your order is saved; use Refresh payment status to check again.");}
      }
    };
    timer=setTimeout(()=>void poll(),1000);
    return()=>{disposed=true;if(timer)clearTimeout(timer);};
  },[id,order?.orderStatus]);
  async function act(action:"reconcile"|"cancel"|"pay"|"captured"|"authorized"|"failed"|"timeout"){
    if(guard.current)return;guard.current=true;revision.current++;setBusy(true);setError("");setNotice("");
    try{
      if(action==="pay"){
        const latest=await api(`orders/${id}`,receiptSchema);setOrder(latest);
        if(!latest.canPay)throw new Error("Payment status changed. Review this order before trying again.");
        const session=await api(`orders/${id}/payment`,sessionSchema,{});setPaymentSession(session);
        await openPayment(session,setNotice);return;
      }
      if(action==="captured"||action==="reconcile")setNotice("Verifying payment… The receipt updates only after server confirmation.");
      const value=action==="reconcile"||action==="cancel"?await api(`orders/${id}/${action}`,receiptSchema,action==="cancel"?{reason:"Customer requested cancellation before payment"}:{}):await api("checkout/fixture",receiptSchema,{orderId:id,outcome:action});
      setOrder(value);setNotice(action==="timeout"?"The simulated provider recorded payment, but confirmation was lost. Refresh status to reconcile it.":"");
      if(value.orderStatus==="pending_payment"&&value.paymentStatus==="unpaid"&&!value.attentionReason)setPaymentSession(await api(`orders/${id}/payment`,sessionSchema,{}));
      if(value.capturedPaise>0)await store.refreshCart();
    }catch(e){setError(e instanceof Error?e.message:"Status unavailable. Keep this order reference.");setNotice("");}finally{guard.current=false;setBusy(false);}
  }
  if(!order)return <section className="checkout-card">{error?<><p role="alert">{error}</p><Link href="/track-order">Verify order access</Link></>:<p role="status">Loading your order…</p>}</section>;
  const preparing=order.orderStatus==="pending_payment"&&order.paymentStatus==="unpaid"&&!order.attentionReason&&paymentSession?.status==="processing";
  const title=order.attentionReason?"Your order needs review":order.paymentStatus==='refunded'?"Payment refunded":order.capturedPaise>0?"Payment received":order.orderStatus==='cancelled'||order.orderStatus==='closed'?"Checkout closed":order.paymentStatus==='authorized'?"Verifying payment":preparing?"Preparing payment":"Payment pending";
  const fixturePending=order.fixture&&order.orderStatus==="pending_payment"&&order.capturedPaise===0;
  return <><ModeNote fixture={order.fixture}/><div className="checkout-grid"><section className="checkout-card" aria-live="polite"><p className="purchase-kicker">{order.orderNumber}</p><h2>{title}</h2><p>{order.attentionReason?"Keep this reference. Do not make another payment; fulfillment is on hold while the store reviews the outcome.":order.capturedPaise>0?"Your receipt reflects the verified server payment status.":order.paymentStatus==='authorized'?"The provider authorized the payment. Confirmation waits for capture.":preparing?"The existing payment request is being prepared. This page checks its operation status automatically; do not create another order.":order.orderStatus==='pending_payment'?"Closing the payment window does not mean payment failed. Refresh status before trying again.":"Review a fresh quote to place a new order."}</p><dl className="checkout-totals"><div><dt>Total</dt><dd>{formatMoney(order.totalPaise)}</dd></div><div><dt>Received</dt><dd>{formatMoney(order.capturedPaise)}</dd></div>{order.refundedPaise>0&&<div><dt>Refunded</dt><dd>{formatMoney(order.refundedPaise)}</dd></div>}</dl>{order.reservationExpiresAt&&order.orderStatus==='pending_payment'&&<p>Reservation until {new Date(order.reservationExpiresAt).toLocaleTimeString()}. Stock is released only after payment status is checked.</p>}<div className="checkout-actions"><button className="store-primary-button" disabled={busy} onClick={()=>void act('reconcile')}>{busy?'Checking…':'Refresh payment status'}</button>{order.canPay&&!order.fixture&&<button className="store-primary-button" disabled={busy||preparing} onClick={()=>void act('pay')}>Resume Razorpay payment</button>}{order.canCancel&&order.capturedPaise===0&&<button className="store-text-button" disabled={busy} onClick={()=>void act('cancel')}>Cancel unpaid checkout</button>}</div>{fixturePending&&(order.canPay||order.paymentStatus==='authorized')&&<fieldset className="checkout-fixture-actions" disabled={busy}><legend>Fixture simulation — no real payment</legend><button onClick={()=>void act('captured')}>{order.paymentStatus==='authorized'?'Simulate capture of authorized payment':'Simulate captured payment'}</button>{order.canPay&&<><button onClick={()=>void act('authorized')}>Simulate authorization only</button><button onClick={()=>void act('failed')}>Simulate failed attempt</button><button onClick={()=>void act('timeout')}>Simulate lost confirmation</button></>}</fieldset>}{notice&&<p role="status">{notice}</p>}{error&&<p className="purchase-error" role="alert">{error}</p>}<p>Email status: {order.fixture?'No email is sent in fixture mode.':order.notificationStatus==='sent'?'Accepted by the email provider; delivery is not guaranteed.':order.notificationStatus==='failed'?'Email failed. Your payment and order remain saved.':order.notificationStatus==='unconfigured'?'Email is not configured. Save this order reference.':order.notificationStatus??'Not queued yet.'}</p><Link href="/collections/all">Continue shopping</Link></section><section className="checkout-card"><h2>Order details</h2><ul className="checkout-lines">{order.items.map(item=><li key={item.id}><span>{item.title}<small>{item.color} / {sizeLabel(item.size)} × {item.quantity}</small></span><strong>{formatMoney(item.linePayablePaise)}</strong></li>)}</ul><p>Delivery fee: {formatMoney(order.shippingFeePaise)}</p><h3>Delivery address</h3><address>{order.address.fullName}<br/>{order.address.line1}<br/>{order.address.line2&&<>{order.address.line2}<br/></>}{order.address.city}, {order.address.stateCode} {order.address.pincode}<br/>{order.address.phone}</address></section></div><OrderFulfillment orderId={id} canCancel={order.canCancel} captured={order.capturedPaise>0} orderStatus={order.orderStatus} onChanged={()=>{void api(`orders/${id}`,receiptSchema).then(setOrder);}} /></>;
}

export function OrderRecoveryClient({fixture}:{fixture:boolean}){
  const[busy,setBusy]=useState(false);const[requested,setRequested]=useState(false);const[details,setDetails]=useState({orderNumber:"",email:""});const[message,setMessage]=useState("");const[error,setError]=useState("");const[fixtureToken,setFixtureToken]=useState("");
  async function submit(event:React.FormEvent<HTMLFormElement>){event.preventDefault();if(busy)return;setBusy(true);setError("");const form=new FormData(event.currentTarget);
    try{if(!requested){const value={orderNumber:String(form.get('orderNumber')).trim(),email:String(form.get('email')).trim().toLowerCase()};const result=await api('orders/access/request',z.object({accepted:z.boolean(),message:z.string(),fixtureToken:z.string().optional()}),value);setDetails(value);setRequested(true);setMessage(result.message);setFixtureToken(result.fixtureToken??'');}
      else{const result=await api('orders/access/verify',z.object({orderId:z.string().uuid(),href:z.string()}),{...details,token:String(form.get('token')).trim()});openOrderDocument(result.orderId);}}
    catch(e){setError(e instanceof Error?e.message:'Unable to verify.');}finally{setBusy(false);}}
  return <section className="checkout-card checkout-recovery"><ModeNote fixture={fixture}/><p>Enter the order number and email used at checkout. Access is granted only after verification.</p><form onSubmit={submit}><fieldset disabled={busy}>{!requested?<div className="checkout-fields"><label>Order number<input name="orderNumber" required maxLength={60} autoComplete="off"/></label><label>Email<input name="email" type="email" required maxLength={254} autoComplete="email"/></label></div>:<><p role="status">{message}</p>{fixtureToken&&<p className="checkout-mode">Fixture code: <strong>{fixtureToken}</strong>. This development simulation does not verify a real inbox.</p>}<label>Verification code<input name="token" required inputMode="numeric" pattern="[0-9]{6,10}" autoComplete="one-time-code" maxLength={10}/></label></>}<button className="store-primary-button" type="submit">{busy?'Please wait…':requested?'Verify and open order':'Send verification code'}</button>{requested&&<button className="store-text-button" type="button" onClick={()=>{setRequested(false);setFixtureToken('');setMessage('');}}>Request a new code</button>}</fieldset></form>{error&&<p className="purchase-error" role="alert">{error}</p>}</section>;
}
