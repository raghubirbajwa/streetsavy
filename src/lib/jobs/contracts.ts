import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.null(), z.boolean(), z.number().finite(), z.string(), z.array(jsonValueSchema), z.record(jsonValueSchema),
]));
export const jobPayloadSchema = z.record(jsonValueSchema);
export const jobSchema = z.object({
  id: z.string().uuid(), type: z.string(), dedupe_key: z.string(), payload: jobPayloadSchema,
  state: z.enum(["queued", "running", "retry", "done", "dead"]),
  attempts: z.number().int().nonnegative(), max_attempts: z.number().int().min(1).max(25),
  run_after: z.string(), locked_until: z.string().nullable(), lease_token: z.string().uuid().nullable(),
  last_error: z.string().nullable(),
});
export type Job = z.infer<typeof jobSchema>;

export const operationSchema = z.object({
  id: z.string().uuid(), scope: z.string(), actor_or_session_key: z.string(), idempotency_key: z.string(),
  request_hash: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(["queued", "running", "succeeded", "failed", "unknown"]),
  provider_reference: z.string().nullable(), result_json: jsonValueSchema.nullable(),
  lease_token: z.string().uuid().nullable(), locked_until: z.string().nullable(),
  attempts: z.number().int().nonnegative(), last_error: z.string().nullable(),
});
export type ExternalOperation = z.infer<typeof operationSchema>;

export const safeErrorCodeSchema = z.enum([
  "INTEGRATION_UNCONFIGURED", "UPSTREAM_UNAVAILABLE", "UPSTREAM_REJECTED", "UPSTREAM_UNKNOWN",
  "INVALID_PAYLOAD", "LEASE_EXPIRED", "RECONCILIATION_REQUIRED", "INTERNAL_ERROR",
]);
export type SafeErrorCode = z.infer<typeof safeErrorCodeSchema>;
const rpcCodes = new Set([
  ...safeErrorCodeSchema.options, "IDEMPOTENCY_CONFLICT", "LEASE_LOST", "OPERATION_BUSY",
  "OPERATION_NOT_FOUND", "WEBHOOK_NOT_FOUND",
]);

export class OperationsError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "OperationsError";
    this.code = code;
  }
}

/** Never retain an upstream exception, database details/hint, payload or stack as a cause. */
export function safeOperationsError(error: unknown): OperationsError {
  if (error !== null && typeof error === "object" && "message" in error
      && typeof error.message === "string" && rpcCodes.has(error.message)) {
    return new OperationsError(error.message);
  }
  return new OperationsError("INTERNAL_ERROR");
}

/** Hash the validated request BEFORE any redaction; object property order is insignificant. */
export function operationRequestHash(payload: Readonly<Record<string, unknown>>): string {
  const parsed = jobPayloadSchema.safeParse(payload);
  if (!parsed.success) throw new OperationsError("INVALID_PAYLOAD");
  const canonical = (value: JsonValue): string => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value !== null && typeof value === "object") {
      return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key]!)}`).join(",")}}`;
    }
    return JSON.stringify(value);
  };
  return createHash("sha256").update(canonical(parsed.data)).digest("hex");
}

/** Build minimal jobs from identifiers. Provider responses/addresses/credentials never go here. */
export function referencePayload(values: Readonly<Record<string, string>>): Record<string, string> {
  const payload: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (!/^[a-zA-Z][a-zA-Z0-9]*(Id|Key)$/.test(key)
      || /(token|secret|password|credential|apiKey)/i.test(key)
      || !/^[a-zA-Z0-9_.:-]{1,200}$/.test(value)) throw new OperationsError("INVALID_PAYLOAD");
    payload[key] = value;
  }
  return payload;
}
