import { z } from "zod";

const clean = (max: number) => z.string().trim().min(1).max(max).refine((s) => !/[\u0000-\u001f\u007f]/.test(s), "Remove control characters.");
export const stateCodes = ["AN","AP","AR","AS","BR","CH","CG","DH","DL","GA","GJ","HR","HP","JK","JH","KA","KL","LA","LD","MP","MH","MN","ML","MZ","NL","OD","PB","PY","RJ","SK","TN","TS","TR","UP","UK","WB"] as const;
export const stateNames = ["Andaman and Nicobar Islands","Andhra Pradesh","Arunachal Pradesh","Assam","Bihar","Chandigarh","Chhattisgarh","Dadra and Nagar Haveli and Daman and Diu","Delhi","Goa","Gujarat","Haryana","Himachal Pradesh","Jammu and Kashmir","Jharkhand","Karnataka","Kerala","Ladakh","Lakshadweep","Madhya Pradesh","Maharashtra","Manipur","Meghalaya","Mizoram","Nagaland","Odisha","Punjab","Puducherry","Rajasthan","Sikkim","Tamil Nadu","Telangana","Tripura","Uttar Pradesh","Uttarakhand","West Bengal"] as const;
export const addressSchema = z.object({
  fullName: clean(120), phone: z.string().trim().transform((s) => s.replace(/[ ()-]/g, "").replace(/^(?:\+91|91)(?=[6-9]\d{9}$)/, "")).pipe(z.string().regex(/^[6-9]\d{9}$/, "Enter a ten-digit Indian mobile number.")),
  email: z.string().trim().email().max(254).transform((s) => s.toLowerCase()),
  line1: clean(200), line2: z.string().trim().max(200).refine((s) => !/[\u0000-\u001f\u007f]/.test(s)).optional(), city: clean(100),
  stateCode: z.enum(stateCodes), pincode: z.string().regex(/^[1-9]\d{5}$/, "Enter a six-digit Indian PIN."), country: z.literal("IN"),
}).strict();
export type Address = z.infer<typeof addressSchema>;
export const paise = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const quoteInputSchema = z.object({cartVersion:z.number().int().positive(),address:addressSchema}).strict();
export const quoteSchema = z.object({quoteId:z.string().uuid(),cartVersion:z.number().int().positive(),expiresAt:z.string(),itemsPayablePaise:paise,shippingFeePaise:paise,taxBreakdown:z.array(z.object({label:z.string(),ratePercent:z.number(),includedPaise:paise})),totalPaise:paise,currency:z.literal("INR"),deliveryLabel:z.string(),fixture:z.boolean()}).strict();
export type Quote = z.infer<typeof quoteSchema>;
export const sessionInputSchema = z.object({quoteId:z.string().uuid()}).strict();
export const sessionSchema = z.object({orderId:z.string().uuid(),paymentAttemptId:z.string().uuid(),operationId:z.string().uuid(),status:z.enum(["ready","processing","held"]),keyId:z.string().nullable(),razorpayOrderId:z.string().nullable(),amountPaise:paise,currency:z.literal("INR"),reservationExpiresAt:z.string(),fixture:z.boolean()}).strict();
export type CheckoutSession = z.infer<typeof sessionSchema>;
export const receiptSchema = z.object({
  id:z.string().uuid(),orderNumber:z.string(),orderStatus:z.string(),paymentStatus:z.string(),fulfillmentStatus:z.string(),attentionReason:z.string().nullable(),
  address:addressSchema,items:z.array(z.object({id:z.string().uuid(),title:z.string(),color:z.string(),size:z.string(),quantity:z.number().int().positive(),unitPricePaise:paise,linePayablePaise:paise})),
  itemsPayablePaise:paise,shippingFeePaise:paise,taxBreakdown:quoteSchema.shape.taxBreakdown,totalPaise:paise,capturedPaise:paise,refundedPaise:paise,currency:z.literal("INR"),
  reservationExpiresAt:z.string().nullable(),createdAt:z.string(),notificationStatus:z.string().nullable(),canPay:z.boolean(),canCancel:z.boolean(),fixture:z.boolean(),
}).strict();
export type Receipt = z.infer<typeof receiptSchema>;
export const verifyInputSchema=z.object({orderId:z.string().uuid(),razorpayPaymentId:clean(100),razorpayOrderId:clean(100),razorpaySignature:z.string().regex(/^[a-f0-9]{64}$/i)}).strict();
export const recoveryRequestSchema=z.object({orderNumber:clean(60),email:z.string().trim().email().max(254).transform(s=>s.toLowerCase())}).strict();
export const recoveryVerifySchema=recoveryRequestSchema.extend({token:z.string().regex(/^\d{6,10}$/)}).strict();
export const fixturePaymentSchema=z.object({orderId:z.string().uuid(),outcome:z.enum(["captured","authorized","failed","timeout"])}).strict();
