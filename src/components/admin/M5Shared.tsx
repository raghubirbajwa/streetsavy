"use client";
import { useRef, useState } from "react";

export class OperationRequestError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}
export async function m5Request<T>(path: string, method = "GET", body?: unknown, key?: string): Promise<T> {
  let response: Response;
  try { response = await fetch(`/api/v1/${path}`, {
    method, cache: "no-store", signal: AbortSignal.timeout(30000),
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(key ? { "Idempotency-Key": key } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }); } catch {
    throw new OperationRequestError("NETWORK_UNKNOWN", method === "GET" ? "Order information could not be loaded. Check your connection and refresh." : "The result could not be confirmed because the connection was interrupted. Refresh the saved status before continuing.");
  }
  let payload;
  try { payload = await response.json(); } catch {
    throw new OperationRequestError("UNAVAILABLE", "The result could not be confirmed. Refresh the saved status before continuing.");
  }
  if (!response.ok || payload.error) throw new OperationRequestError(payload.error?.code ?? "UNAVAILABLE", payload.error?.message ?? "The result could not be confirmed. Refresh the saved status before continuing.");
  return payload.data as T;
}
export function readable(value: string | null | undefined) {
  if (!value) return "None";
  if (value === "ONE_SIZE") return "One size";
  return value.replaceAll("_", " ").replace(/^./, letter => letter.toUpperCase());
}
export function when(value: string | null | undefined) { return value ? new Date(value).toLocaleString("en-IN") : "Not recorded"; }
export function useM5Action() {
  const lock = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  async function run(work: () => Promise<void>, message = "Saved. Review the current status below.") {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    try { await work(); setNotice(message); }
    catch (error) { setError(error instanceof Error ? error.message : "The result could not be confirmed. Refresh the saved status."); }
    finally { lock.current = false; setBusy(false); }
  }
  return { busy, error, notice, run };
}
/** Retain a key for the same intent after network errors; a changed payload is a new intent. */
export function useM5Keys() {
  const keys = useRef(new Map<string, string>());
  return (action: string, body: unknown) => {
    const intent = `${action}:${JSON.stringify(body)}`;
    const prior = keys.current.get(intent);
    if (prior) return prior;
    const key = crypto.randomUUID(); keys.current.set(intent, key); return key;
  };
}
export function M5Feedback({ busy, error, notice }: { busy: boolean; error: string; notice: string }) {
  return <div className="m5-feedback" aria-live="polite" aria-busy={busy}>{busy && <p role="status">Saving and checking the result…</p>}{notice && <p className="notice" role="status">{notice}</p>}{error && <div className="notice error" role="alert"><p>{error}</p><p>Your entered details are kept. Refresh status to inspect any saved operation before submitting a new request.</p></div>}</div>;
}
