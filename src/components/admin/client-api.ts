export class AdminRequestError extends Error {
  constructor(public code: string, message: string, public details: string[], public currentVersion?: number) { super(message); }
}
export async function adminRequest<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(url, { method, headers: body === undefined ? {} : { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) {
    const error = payload.error ?? {};
    const details = Array.isArray(error.fieldErrors) ? error.fieldErrors.map((issue: { path: string; message: string }) => `${issue.path}: ${issue.message}`) : Object.entries(error.fieldErrors ?? {}).flatMap(([key, values]) => (Array.isArray(values) ? values : [values]).map(value => `${key}: ${String(value)}`));
    const messages: Record<string,string> = { VERSION_CONFLICT: "Someone saved a newer version. Your edits are still here; compare the latest version before saving again.", PUBLISH_INCOMPLETE: "Complete these items before publishing.", SKU_OR_SLUG_CONFLICT: "That SKU, colour/size combination, or slug is already in use.", STOCK_CONFLICT: "Stock has changed or the adjustment would reduce stock below the reserved quantity.", INVALID_PAYLOAD: "Please check the fields below." };
    throw new AdminRequestError(error.code ?? "UNAVAILABLE", messages[error.code] ?? error.message ?? "The action failed. Your edits have been kept.", details, error.currentVersion);
  }
  return payload.data as T;
}
