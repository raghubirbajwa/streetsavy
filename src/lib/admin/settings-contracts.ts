import { z } from "zod";
const text = (max: number) => z.string().trim().max(max);
export const settingsValueSchema = z.object({
  shippingMode: z.enum(["flat", "free_above", "provider"]), shippingFeePaise: z.number().int().min(0).max(10000000),
  freeShippingThresholdPaise: z.number().int().min(0).max(100000000), taxInclusive: z.literal(true),
  taxRatePercent: z.number().min(0).max(100).nullable(), returnWindowDays: z.number().int().min(0).max(365),
  shippingPolicy: text(10000), returnPolicy: text(10000), privacyPolicy: text(10000), termsPolicy: text(10000),
  supportEmail: z.union([z.literal(""), z.string().email().max(254)]), supportPhone: text(30),
  policiesPublished: z.boolean(), contactPublished: z.boolean(),
}).strict().superRefine((value, ctx) => {
  if (value.policiesPublished && [value.shippingPolicy, value.returnPolicy, value.privacyPolicy, value.termsPolicy].some((s) => !s.trim())) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Complete all four policies before publishing.", path: ["policiesPublished"] });
  if (value.contactPublished && !value.supportEmail && !value.supportPhone) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Add approved public contact information first.", path: ["contactPublished"] });
});
export type StoreSettings = z.infer<typeof settingsValueSchema>;
export const defaultSettings: StoreSettings = {
  shippingMode: "provider", shippingFeePaise: 0, freeShippingThresholdPaise: 0, taxInclusive: true, taxRatePercent: null,
  returnWindowDays: 0, shippingPolicy: "", returnPolicy: "", privacyPolicy: "", termsPolicy: "", supportEmail: "", supportPhone: "", policiesPublished: false, contactPublished: false,
};
export const warehouseValueSchema = z.object({
  name: text(120).min(1), pickupLocation: text(100).min(1), contactName: text(120).min(1), email: z.string().email().max(254), phone: text(30).min(5),
  line1: text(200).min(1), line2: text(200), city: text(100).min(1), state: text(100).min(1), pincode: z.string().regex(/^\d{6}$/), country: z.literal("IN"), active: z.boolean(),
}).strict();
export type WarehouseValue = z.infer<typeof warehouseValueSchema>;
export const packagingValueSchema = z.object({
  label: text(100).min(1), lengthCm: z.number().positive().max(300), widthCm: z.number().positive().max(300), heightCm: z.number().positive().max(300),
  tareWeightG: z.number().int().positive().max(100000), maxContentsWeightG: z.number().int().positive().max(100000), maxItems: z.number().int().positive().max(1000), priority: z.number().int().min(0).max(9999), active: z.boolean(),
}).strict();
export type PackagingValue = z.infer<typeof packagingValueSchema>;
const identity = { id: z.string().uuid().nullable(), expectedVersion: z.number().int().nonnegative() };
export const settingsActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("saveSettings"), expectedVersion: z.number().int().nonnegative(), value: settingsValueSchema }).strict(),
  z.object({ action: z.literal("saveWarehouse"), ...identity, value: warehouseValueSchema }).strict(),
  z.object({ action: z.literal("savePackaging"), ...identity, value: packagingValueSchema }).strict(),
]);
export const settingsStateSchema = z.object({
  version: z.number().int(), value: settingsValueSchema,
  warehouses: z.array(z.object({ id: z.string().uuid(), version: z.number().int(), value: warehouseValueSchema })),
  packaging: z.array(z.object({ id: z.string().uuid(), version: z.number().int(), value: packagingValueSchema })),
  audit: z.array(z.object({ id: z.string().uuid(), action: z.string(), entityType: z.string(), createdAt: z.string(), diff: z.record(z.unknown()) })),
});
export type SettingsState = z.infer<typeof settingsStateSchema>;
