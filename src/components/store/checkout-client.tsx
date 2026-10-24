"use client";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { addressSchema, quoteSchema, sessionSchema, receiptSchema, stateCodes, stateNames, type Address, type Quote, type CheckoutSession, type Receipt } from "../../lib/checkout/contracts.ts";
import type { CartDTO, CartLine } from "../../lib/cart/contracts.ts";
import { formatMoney, mediaUrl, sizeLabel } from "../../lib/store/purchase.ts";
import { useStore } from "./store-provider.tsx";
import "./checkout.css";
import { OrderFulfillment } from "./order-fulfillment.tsx";
import { OtpCodeInput } from "./otp-code-input.tsx";

async function api<T>(path:string,schema:z.ZodType<T>,body?:unknown,key?:string):Promise<T>{
  const response=await fetch(`/api/v1/${path}`,{method:body===undefined?"GET":"POST",cache:"no-store",signal:AbortSignal.timeout(30000),headers:{"Content-Type":"application/json",...(key?{"Idempotency-Key":key}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const data=await response.json();if(data.error)throw new Error(data.error.message??"Please retry.");return schema.parse(data.data);
}
type RazorpayResponse={razorpay_payment_id:string;razorpay_order_id:string;razorpay_signature:string};
type RazorpayFailure={error?:{code?:string;description?:string;source?:string;step?:string;reason?:string;metadata?:{order_id?:string;payment_id?:string}}};
type RazorpayCheckout={open:()=>void;on:(event:"payment.failed",handler:(response:RazorpayFailure)=>void)=>void};
declare global {interface Window {Razorpay?:new(options:Record<string,unknown>)=>RazorpayCheckout}}
let checkoutScript:Promise<void>|undefined;
const wait=(ms:number)=>new Promise<void>((resolve)=>setTimeout(resolve,ms));
function openOrderDocument(orderId:string){
  // Payment/access changes need a fresh document and store context using the updated HttpOnly cookies.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign(`/orders/${orderId}`);
}
async function waitUntilReady(session:CheckoutSession,onStatus:(message:string)=>void):Promise<CheckoutSession>{
  if(session.status!=="processing")return session;
  onStatus("Preparing payment… This page checks status automatically; do not start another order.");
  let current=session;
  for(let attempt=0;attempt<8;attempt++){
    await wait(Math.min(1000*2**attempt,8000));
    current=await api(`operations/${current.operationId}`,sessionSchema);
    if(current.status!=="processing")return current;
  }
  return current;
}
async function openPayment(session:CheckoutSession,onStatus:(message:string)=>void,address?:Address|null){
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
    let finished=false;
    const go=()=>{if(finished)return;finished=true;openOrderDocument(session.orderId);resolve();};
    onStatus("Complete payment in the Razorpay window. Closing it leaves this order pending.");
    const checkout=new Razorpay({
      key:session.keyId,
      order_id:session.razorpayOrderId,
      amount:session.amountPaise,
      currency:"INR",
      name:"STREETSAVVY",
      description:`Clothing order · ${formatMoney(session.amountPaise)}`,
      image:`${window.location.origin}/brand/streetsavy-logo.png`,
      notes:{store_order_id:session.orderId},
      theme:{color:"#151515"},
      ...(address?{prefill:{name:address.fullName,email:address.email,contact:address.phone}}:{}),
      modal:{ondismiss:()=>{if(!verifying)go();}},
      handler:async(value:RazorpayResponse)=>{
        verifying=true;onStatus("Verifying payment… Please wait for the server to confirm capture.");
        try{await api("payments/razorpay/verify",receiptSchema,{orderId:session.orderId,razorpayPaymentId:value.razorpay_payment_id,razorpayOrderId:value.razorpay_order_id,razorpaySignature:value.razorpay_signature});}
        catch(error){
          onStatus(error instanceof Error?`${error.message} Open the order receipt to refresh status.`:"Verification is still pending. Open the order receipt to refresh status.");
          await wait(1800);
        }
        finally{go();}
      },
    });
    checkout.on("payment.failed",(response)=>{
      const detail=response.error?.description??response.error?.reason??"Payment failed.";
      onStatus(`${detail} This order is still pending. You can retry from the receipt.`);
      if(!verifying)go();
    });
    checkout.open();
  });
}
function ModeNote({fixture}:{fixture:boolean}){return <p className="checkout-mode">{fixture?"FIXTURE CHECKOUT · No money, shipment or email. Delivery and tax values are samples. Use test details only.":"Review the final total before opening Razorpay. Prepaid INR payments."}</p>;}
function PaymentBadges(){
  return <ul className="checkout-pay-badges" aria-label="Cards and UPI accepted in Razorpay"><li>Visa</li><li>Mastercard</li><li>RuPay</li><li>UPI</li></ul>;
}
function CheckoutLineThumb({line}:{line:CartLine}){
  return <div className="checkout-thumb">{line.image?<Image src={mediaUrl(line.image.publicKey)} alt={line.image.alt} width={line.image.width} height={line.image.height} sizes="64px"/>:<span aria-hidden="true">—</span>}<span className="checkout-qty">{line.quantity}</span></div>;
}
function CheckoutSummary({cart,quote,expired,now}:{cart:CartDTO;quote:Quote|null;expired:boolean;now:number}){
  const taxTotal=quote?quote.taxBreakdown.reduce((sum,tax)=>sum+tax.includedPaise,0):0;
  return <aside className="checkout-summary" aria-live="polite">
    <h2 className="checkout-visually-hidden">Your order</h2>
    <ul className="checkout-summary-lines">{cart.lines.map((line)=><li key={line.variantId} className="checkout-summary-line"><CheckoutLineThumb line={line}/><div className="checkout-summary-copy"><p>{line.title}</p><small>{line.colorLabel} / {sizeLabel(line.size)}</small></div><strong>{line.lineSubtotalPaise===null?"Unavailable":formatMoney(line.lineSubtotalPaise)}</strong></li>)}</ul>
    {quote?<><dl className="checkout-totals"><div><dt>Subtotal</dt><dd>{formatMoney(quote.itemsPayablePaise)}</dd></div><div><dt>Shipping</dt><dd>{quote.shippingFeePaise===0?"Free":formatMoney(quote.shippingFeePaise)}</dd></div>{quote.taxBreakdown.map((tax)=><div key={tax.label}><dt>{tax.label} ({tax.ratePercent}%)</dt><dd>{formatMoney(tax.includedPaise)}</dd></div>)}<div className="checkout-total"><dt>Total</dt><dd><span className="checkout-currency">INR</span> {formatMoney(quote.totalPaise)}</dd></div></dl>{taxTotal>0&&<p className="checkout-tax-note">Including {formatMoney(taxTotal)} in taxes</p>}<p className="checkout-quote-meta">{expired?"This quote expired. Continue from delivery to refresh the total.":`Quote valid for ${Math.max(0,Math.ceil((new Date(quote.expiresAt).getTime()-now)/60000))} more minute(s). Stock is reserved only when you pay.`}</p></>:<p className="checkout-summary-hint">Enter your delivery details to see the final total.</p>}
  </aside>;
}

const deliveryFields=[
  {name:"fullName",label:"Full name",complete:"name",type:"text",className:""} as const,
  {name:"email",label:"Email",complete:"email",type:"email",className:""} as const,
  {name:"phone",label:"Mobile number",complete:"tel",type:"tel",className:"checkout-phone"} as const,
  {name:"line1",label:"Address",complete:"address-line1",type:"text",className:"checkout-span-2"} as const,
  {name:"line2",label:"Apartment, suite, etc. (optional)",complete:"address-line2",type:"text",className:"checkout-span-2"} as const,
  {name:"city",label:"City",complete:"address-level2",type:"text",className:""} as const,
  {name:"pincode",label:"PIN code",complete:"postal-code",type:"text",className:""} as const,
];

export function CheckoutClient({fixture,savedAddress=null}:{fixture:boolean;savedAddress?:Address|null}){
  const store=useStore(),cart=store.cart;
  const[quote,setQuote]=useState<Quote|null>(null);
  const[address,setAddress]=useState<Address|null>(savedAddress);
  const[busy,setBusy]=useState(false);
  const[error,setError]=useState("");
  const[pending,setPending]=useState<CheckoutSession|null>(null);
  const[paymentNotice,setPaymentNotice]=useState("");
  const[useDeliveryAsBilling,setUseDeliveryAsBilling]=useState(true);
  const key=useRef("");
  const lock=useRef(false);
  const[now,setNow]=useState(()=>Date.now());
  useEffect(()=>{const tick=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(tick);},[]);
  // Invalidate before committing a render so a changed cart never exposes the old payable quote.
  if(quote&&cart&&cart.version!==quote.cartVersion){setQuote(null);setError("Your cart changed. Review a fresh quote.");}
  async function requestQuote(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();if(lock.current||!cart)return;lock.current=true;setBusy(true);setError("");setQuote(null);setPaymentNotice("");
    try{
      const next=addressSchema.parse(Object.fromEntries(new FormData(event.currentTarget)));
      setAddress(next);
      setQuote(await api("checkout/quote",quoteSchema,{cartVersion:cart.version,address:next}));
      key.current=crypto.randomUUID();
    }
    catch(e){setError(e instanceof z.ZodError?e.issues.map(i=>`${i.path.join(".")}: ${i.message}`).join(" "):e instanceof Error?e.message:"Quote unavailable.");}
    finally{lock.current=false;setBusy(false);}
  }
  async function pay(){
    if(!quote||lock.current)return;lock.current=true;setBusy(true);setError("");setPaymentNotice("");
    try{
      let session=await api("checkout/sessions",sessionSchema,{quoteId:quote.quoteId},key.current);
      setPending(session);
      if(session.fixture){openOrderDocument(session.orderId);return;}
      if(session.status==="processing"){
        session=await waitUntilReady(session,setPaymentNotice);
        setPending(session);
      }
      if(session.status==="ready"){await openPayment(session,setPaymentNotice,address);return;}
      setPaymentNotice(session.status==="held"
        ? "This payment needs review. Open the order receipt instead of starting another payment."
        : "Payment is still being prepared. Open the order receipt and wait — do not start another order.");
    }
    catch(e){setError(e instanceof Error?e.message:"Payment preparation failed. Retry this same request.");}
    finally{lock.current=false;setBusy(false);}
  }
  if(store.cartLoading&&!cart)return <p className="checkout-empty" role="status">Loading checkout…</p>;
  if(cart?.pendingCheckout)return <section className="checkout-empty checkout-card"><h2>You have a pending order.</h2><p>Resolve its payment status before starting another checkout.</p><Link className="store-primary-button" href={`/orders/${cart.pendingCheckout.orderId}`}>Resume order</Link></section>;
  if(!cart?.lines.length)return <section className="checkout-empty checkout-card"><h2>Your cart is empty.</h2><Link className="store-primary-button" href="/collections/all">Explore clothing</Link></section>;
  if(cart.hasUnavailableItems)return <section className="checkout-empty checkout-card"><h2>Review your cart first.</h2><p>Remove unavailable items or reduce quantities.</p><Link href="/cart">Return to cart</Link></section>;
  const expired=quote?new Date(quote.expiresAt).getTime()<=now:false;
  const canPay=!!quote&&!expired&&!busy&&!pending;
  return <>
    <div className="checkout-main">
      <h1 className="checkout-visually-hidden">Checkout</h1>
      <ModeNote fixture={fixture}/>
      <section className="checkout-block">
        <h2>Delivery</h2>
        <form onSubmit={requestQuote} onChange={()=>{if(quote){setQuote(null);setError("");}}}>
          <fieldset disabled={busy||!!pending}>
            <div className="checkout-fields">
              {deliveryFields.map((field)=><label key={field.name} className={field.className}>{field.label}{field.name==="phone"?<span className="checkout-phone-field"><span aria-hidden="true">+91</span><input name={field.name} type={field.type} autoComplete={`shipping ${field.complete}`} required maxLength={16} defaultValue={savedAddress?.[field.name]??""} inputMode="numeric"/></span>:<input name={field.name} type={field.type} autoComplete={`shipping ${field.complete}`} required={field.name!=="line2"} maxLength={field.name==="pincode"?6:200} defaultValue={savedAddress?.[field.name]??""} {...(field.name==="pincode"?{inputMode:"numeric" as const,pattern:"[1-9][0-9]{5}"}:{})}/>}</label>)}
              <label className="checkout-span-2">State / union territory<select name="stateCode" required defaultValue={savedAddress?.stateCode??""}><option value="" disabled>Select state</option>{stateCodes.map((code,i)=><option key={code} value={code}>{stateNames[i]}</option>)}</select></label>
              <input type="hidden" name="country" value="IN"/>
            </div>
            <p className="checkout-hint">India only. Address details are not saved in browser storage.</p>
            {!quote&&<button className="store-primary-button" disabled={busy} type="submit">{busy?"Preparing…":"Continue to payment"}</button>}
          </fieldset>
        </form>
      </section>
      <section className="checkout-block">
        <h2>Shipping method</h2>
        {quote
          ? <div className="checkout-shipping-choice"><span>{quote.deliveryLabel}</span><strong>{quote.shippingFeePaise===0?"Free":formatMoney(quote.shippingFeePaise)}</strong></div>
          : <p className="checkout-shipping-placeholder">Enter a delivery address to view available shipping methods.</p>}
      </section>
      {quote&&<section className="checkout-block">
        <div className="checkout-pay-heading"><h2>Pay with card / UPI</h2><PaymentBadges/></div>
        <p className="checkout-hint">All transactions are secure and encrypted. Card and UPI details are collected in Razorpay Checkout — they never touch this page.</p>
        <label className="checkout-confirm"><input type="checkbox" checked={useDeliveryAsBilling} onChange={(event)=>setUseDeliveryAsBilling(event.target.checked)} disabled={busy||!!pending}/>Use delivery address as billing address</label>
        <button className="checkout-pay-now" type="button" disabled={!canPay} onClick={()=>void pay()}>{busy?"Preparing payment…":fixture?"Continue to fixture payment":"Pay now"}</button>
        <p className="checkout-guest-note">Paying as a guest. <Link href="/account">Sign in</Link> to save addresses for next time.</p>
      </section>}
      {paymentNotice&&<p role="status">{paymentNotice}</p>}
      {pending&&<p><Link href={`/orders/${pending.orderId}`}>Open pending order</Link></p>}
      {error&&<p className="purchase-error" role="alert">{error}</p>}
      <p className="checkout-legal"><Link href="/policies/terms">Terms and policies</Link> <Link href="/policies/privacy">Privacy</Link></p>
    </div>
    <CheckoutSummary cart={cart} quote={quote} expired={expired} now={now}/>
  </>;
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
        await openPayment(session,setNotice,latest.address);return;
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
  const[busy,setBusy]=useState(false);const[requested,setRequested]=useState(false);const[details,setDetails]=useState({orderNumber:"",email:""});const[message,setMessage]=useState("");const[error,setError]=useState("");const[fixtureToken,setFixtureToken]=useState("");const[token,setToken]=useState("");
  async function submit(event:React.FormEvent<HTMLFormElement>){event.preventDefault();if(busy)return;if(requested&&token.length!==6)return;setBusy(true);setError("");const form=new FormData(event.currentTarget);
    try{if(!requested){const value={orderNumber:String(form.get('orderNumber')).trim(),email:String(form.get('email')).trim().toLowerCase()};const result=await api('orders/access/request',z.object({accepted:z.boolean(),message:z.string(),fixtureToken:z.string().optional()}),value);setDetails(value);setRequested(true);setMessage(result.message);setFixtureToken(result.fixtureToken??'');}
      else{const result=await api('orders/access/verify',z.object({orderId:z.string().uuid(),href:z.string()}),{...details,token});openOrderDocument(result.orderId);}}
    catch(e){setError(e instanceof Error?e.message:'Unable to verify.');}finally{setBusy(false);}}
  return <section className="checkout-card checkout-recovery"><ModeNote fixture={fixture}/><p>Enter the order number and email used at checkout. Access is granted only after verification.</p><form onSubmit={submit}><fieldset disabled={busy}>{!requested?<div className="checkout-fields"><label>Order number<input name="orderNumber" required maxLength={60} autoComplete="off"/></label><label>Email<input name="email" type="email" required maxLength={254} autoComplete="email"/></label></div>:<><p role="status">{message}</p>{fixtureToken&&<p className="checkout-mode">Fixture code: <strong>{fixtureToken}</strong>. This development simulation does not verify a real inbox.</p>}<OtpCodeInput value={token} disabled={busy} autoFocus onChange={setToken}/></>}<button className="store-primary-button" type="submit" disabled={requested&&token.length!==6}>{busy?'Please wait…':requested?'Verify and open order':'Send verification code'}</button>{requested&&<button className="store-text-button" type="button" onClick={()=>{setRequested(false);setFixtureToken('');setMessage('');setToken('');}}>Request a new code</button>}</fieldset></form>{error&&<p className="purchase-error" role="alert">{error}</p>}</section>;
}
