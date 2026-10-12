"use client";
import { useState } from "react";
import type { ReactNode } from "react";

export function useAdminMutation<T>(endpoint: string, onSaved: (data: T) => void) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [details,setDetails] = useState<string[]>([]);
  const [success, setSuccess] = useState("");
  const [conflict, setConflict] = useState(false);
  async function mutate(body: unknown, message = "Changes saved.") {
    setPending(true); setError(""); setDetails([]); setSuccess(""); setConflict(false);
    try {
      const response = await fetch(`/api/v1/admin/${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
      const result = await response.json();
      if (!response.ok) {
        setConflict(response.status === 409 && result.error?.code === "VERSION_CONFLICT");
        setError(result.error?.message ?? "Changes could not be saved. Your edits are still here.");
        const fields=result.error?.fieldErrors;
        setDetails(Array.isArray(fields) ? fields.map((issue:{path:string;message:string})=>`${issue.path}: ${issue.message}`):Object.entries(fields??{}).flatMap(([key,values])=>(Array.isArray(values)?values:[values]).map(value=>`${key}: ${String(value)}`)));
        return;
      }
      onSaved(result.data as T); setSuccess(message);
    } catch { setError("Could not connect. Your edits are still here; try saving again."); }
    finally { setPending(false); }
  }
  return { pending, mutate, feedback: <><div aria-live="polite">{success && <p className="notice">{success}</p>}</div>{error && <div role="alert" className="error"><p>{error}</p>{details.length>0 && <ul>{details.map((detail,i)=><li key={i}>{detail}</li>)}</ul>}{conflict && <><p>Your unsaved edits have been preserved. Review the latest version before saving again.</p><button type="button" className="secondary" onClick={() => location.reload()}>Reload latest and discard local edits</button></>}</div>}</> };
}
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}
export function OrderedProducts({ ids, products, onChange }: { ids: string[]; products: { id: string; title: string; status: string }[]; onChange: (ids: string[]) => void }) {
  function move(index: number, step: number) { const next = [...ids]; [next[index], next[index + step]] = [next[index + step]!, next[index]!]; onChange(next); }
  return <div><ol className="ordered-list">{ids.map((id, i) => <li key={id}><span>{products.find((p) => p.id === id)?.title ?? "Unavailable product"}</span><span className="form-actions"><button type="button" className="secondary" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move product ${i + 1} up`}>↑</button><button type="button" className="secondary" disabled={i === ids.length - 1} onClick={() => move(i, 1)} aria-label={`Move product ${i + 1} down`}>↓</button><button type="button" className="secondary" onClick={() => onChange(ids.filter((x) => x !== id))}>Remove</button></span></li>)}</ol><Field label="Add a product"><select value="" onChange={(event) => { if (event.target.value) onChange([...ids, event.target.value]); }}><option value="">Choose a product</option>{products.filter((p) => !ids.includes(p.id)).map((p) => <option key={p.id} value={p.id}>{p.title} · {p.status}</option>)}</select></Field></div>;
}
