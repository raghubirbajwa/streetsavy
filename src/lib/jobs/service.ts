import "server-only";
import { z } from "zod";
import { integrationConfig } from "../../config/env.ts";
import type { Environment } from "../../config/env.ts";
import {
  jobSchema, operationSchema, operationRequestHash, referencePayload, safeErrorCodeSchema,
  safeOperationsError, OperationsError,
} from "./contracts.ts";
import type { SafeErrorCode } from "./contracts.ts";

type RpcName = "enqueue_job" | "claim_jobs" | "complete_job" | "fail_job" | "extend_job_lease"
  | "begin_operation" | "claim_operation" | "finish_operation" | "reclaim_expired_jobs" | "reclaim_expired_operations";
/** Inject a private service-role client's rpc method in future workers; never a browser client. */
export type OperationsTransport = (
  name: RpcName, args: Readonly<Record<string, unknown>>,
) => Promise<{ data: unknown; error: unknown }>;

export function createOperationsService(env: Environment, transport: OperationsTransport) {
  // Intentionally no fixture worker: fixture mode cannot open a real DB or report fake provider success.
  integrationConfig("supabase", env);
  async function call<T>(name: RpcName, args: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
    let response: Awaited<ReturnType<OperationsTransport>>;
    try { response = await transport(name, args); }
    catch (error) { throw safeOperationsError(error); }
    if (response.error) throw safeOperationsError(response.error);
    const result = schema.safeParse(response.data);
    if (!result.success) throw new OperationsError("INTERNAL_ERROR");
    return result.data;
  }
  return {
    enqueue(type: string, dedupeKey: string, references: Record<string, string>, maxAttempts = 5) {
      return call("enqueue_job", {
        p_type: type, p_dedupe_key: dedupeKey, p_payload: referencePayload(references), p_max_attempts: maxAttempts,
      }, jobSchema);
    },
    claim(limit = 10, leaseSeconds = 60) {
      return call("claim_jobs", { p_limit: limit, p_lease_seconds: leaseSeconds }, z.array(jobSchema));
    },
    complete(id: string, leaseToken: string) {
      return call("complete_job", { p_id: id, p_lease_token: leaseToken }, jobSchema);
    },
    fail(id: string, leaseToken: string, code: SafeErrorCode) {
      const parsed = safeErrorCodeSchema.safeParse(code);
      if (!parsed.success) throw new OperationsError("INVALID_PAYLOAD");
      return call("fail_job", { p_id: id, p_lease_token: leaseToken, p_error_code: parsed.data }, jobSchema);
    },
    extendLease(id: string, leaseToken: string, leaseSeconds = 60) {
      return call("extend_job_lease", { p_id: id, p_lease_token: leaseToken, p_lease_seconds: leaseSeconds }, jobSchema);
    },
    begin(scope: string, actorKey: string, idempotencyKey: string, request: Record<string, unknown>) {
      return call("begin_operation", {
        p_scope: scope, p_actor_or_session_key: actorKey, p_idempotency_key: idempotencyKey,
        p_request_hash: operationRequestHash(request),
      }, operationSchema);
    },
    claimOperation(id: string, leaseSeconds = 60) {
      return call("claim_operation", { p_id: id, p_lease_seconds: leaseSeconds }, operationSchema);
    },
    finishOperation(id: string, leaseToken: string, status: "succeeded" | "failed" | "unknown", code?: SafeErrorCode) {
      if (code !== undefined && !safeErrorCodeSchema.safeParse(code).success) throw new OperationsError("INVALID_PAYLOAD");
      return call("finish_operation", {
        p_id: id, p_lease_token: leaseToken, p_status: status, p_error_code: code ?? null,
      }, operationSchema);
    },
    async reclaimExpired(limit = 100) {
      const count = z.number().int().nonnegative();
      // Independent operations become unknown, never automatically eligible for another remote create.
      const operations = await call("reclaim_expired_operations", { p_limit: limit }, count);
      const jobs = await call("reclaim_expired_jobs", { p_limit: limit }, count);
      return { jobs, operations };
    },
  };
}
