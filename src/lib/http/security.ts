import "server-only";
import { readEnvironment } from "../../config/env.ts";

export function sameOrigin(request: Request): boolean {
  return request.headers.get("origin") === new URL(readEnvironment().APP_URL).origin;
}

// Local defense in depth. Supabase Auth also applies its own provider limits.
// Replace with a shared deployment limiter before multi-instance launch.
const buckets = new Map<string, { attempts: number; expiresAt: number }>();
export function allowAuthAttempt(key: string): boolean {
  const now = Date.now();
  for (const [entry, value] of buckets) if (value.expiresAt <= now) buckets.delete(entry);
  const bucket = buckets.get(key) ?? { attempts: 0, expiresAt: now + 60_000 };
  bucket.attempts += 1;
  buckets.set(key, bucket);
  return bucket.attempts <= 20;
}

const authFormLimitBytes = 4096;
export class AuthFormError extends Error {
  readonly status: 400 | 413 | 415;
  constructor(status: AuthFormError["status"]) {
    super(status === 413 ? "Request body is too large." : status === 415 ? "Unsupported form encoding." : "Malformed form body.");
    this.name = "AuthFormError";
    this.status = status;
  }
}

/** Native auth forms only. Enforce the byte cap while reading, independently of headers. */
export async function readAuthForm(request: Request): Promise<URLSearchParams> {
  if (!/^application\/x-www-form-urlencoded(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(request.headers.get("content-type") ?? "")) {
    throw new AuthFormError(415);
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) throw new AuthFormError(400);
    if (Number(declaredLength) > authFormLimitBytes) throw new AuthFormError(413);
  }
  const reader = request.body?.getReader();
  if (!reader) return new URLSearchParams();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > authFormLimitBytes) throw new AuthFormError(413);
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error instanceof AuthFormError ? error : new AuthFormError(400);
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    // URLSearchParams silently replaces invalid percent/UTF-8 sequences. Reject
    // those first so malformed credentials cannot acquire a different meaning.
    for (const pair of body.split("&")) {
      const separator = pair.indexOf("=");
      const parts = separator === -1 ? [pair] : [pair.slice(0, separator), pair.slice(separator + 1)];
      for (const part of parts) decodeURIComponent(part.replace(/\+/g, " "));
    }
    const form = new URLSearchParams(body);
    const seen = new Set<string>();
    for (const key of form.keys()) {
      if (seen.has(key)) throw new AuthFormError(400);
      seen.add(key);
    }
    return form;
  } catch {
    throw new AuthFormError(400);
  }
}
