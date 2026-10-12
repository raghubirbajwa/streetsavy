"use client";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { MEDIA_LIMITS } from "../../lib/media/contracts.ts";
import type { AdminMedia, MediaAttachment, ProductMediaState } from "../../lib/media/contracts.ts";

type Props = { productId?: string; productVersion?: number; onProductVersionChange?: (version: number) => void; onDirtyChange?: (dirty: boolean) => void };
async function api<T>(path: string, method = "GET", data?: unknown): Promise<T> {
  const response = await fetch(`/api/v1/admin/media${path}`, { method, headers: data === undefined ? {} : { "Content-Type": "application/json" }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message ?? result.error?.code ?? "Media request failed. Try again.");
  return result.data as T;
}

function MediaCard({ media, allMedia, busy, act, attach, attached, onDirty }: { media: AdminMedia; allMedia: AdminMedia[]; busy: boolean; act: (task: () => Promise<unknown>) => Promise<void>; attach?: () => void; attached: boolean; onDirty: (id: string, dirty: boolean) => void }) {
  const [alt, setAlt] = useState(media.alt); const [source, setSource] = useState(media.source); const [license, setLicense] = useState(media.license);
  const [focalX, setFocalX] = useState(media.focalX); const [focalY, setFocalY] = useState(media.focalY); const [poster, setPoster] = useState(media.posterMediaId ?? "");
  const dirty = alt !== media.alt || source !== media.source || license !== media.license || focalX !== media.focalX || focalY !== media.focalY || poster !== (media.posterMediaId ?? "");
  useEffect(() => { onDirty(media.id, dirty); }, [onDirty, media.id, dirty]);
  // A saved card can leave the current search; it must not leave publishing locked.
  useEffect(() => () => { onDirty(media.id, false); }, [onDirty, media.id]);
  const save = (event: FormEvent) => { event.preventDefault(); void act(() => api(`/${media.id}`, "PATCH", { version: media.version, alt, source, license, focalX, focalY, posterMediaId: poster || null })); };
  return <article className="panel media-card">
    {media.previewUrl ? (media.type === "image" ? <Image unoptimized src={media.previewUrl} alt={media.alt || "Uploaded image awaiting alternative text"} width={media.width ?? 240} height={media.height ?? 240} style={{ width: "100%", height: 190, objectFit: "contain", background: "#efefed" }} /> : <video src={media.previewUrl} controls preload="metadata" style={{ width: "100%", maxHeight: 220 }} />) : <p className="notice">Preview available after validation.</p>}
    <p><strong>{media.status}</strong> · {Math.ceil(media.sizeBytes / 1024)} KB{media.width ? ` · ${media.width} × ${media.height}` : ""}{media.durationSeconds ? ` · ${media.durationSeconds.toFixed(1)}s` : ""}</p>
    {media.lastError && <p className="notice error" role="status">Validation status: {media.lastError}</p>}
    <form onSubmit={save}>
      <label>Alternative text<input value={alt} onChange={(event) => setAlt(event.target.value)} required maxLength={500} disabled={busy} /></label>
      <label>Source / creator<input value={source} onChange={(event) => setSource(event.target.value)} required maxLength={500} disabled={busy} /></label>
      <label>Permission / license<input value={license} onChange={(event) => setLicense(event.target.value)} required maxLength={500} disabled={busy} /></label>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}><label>Focal X (0–1)<input type="number" min="0" max="1" step="0.05" value={focalX} onChange={(event) => setFocalX(Number(event.target.value))} required disabled={busy} /></label><label>Focal Y (0–1)<input type="number" min="0" max="1" step="0.05" value={focalY} onChange={(event) => setFocalY(Number(event.target.value))} required disabled={busy} /></label></div>
      {media.type === "video" && <label>Poster image<select value={poster} onChange={(event) => setPoster(event.target.value)} disabled={busy}><option value="">Choose a validated poster</option>{allMedia.filter((row) => row.type === "image" && ["ready", "published"].includes(row.status)).map((row) => <option key={row.id} value={row.id}>{row.alt || row.id}</option>)}</select></label>}
      <button type="submit" disabled={busy || ["validating", "publishing", "deleting"].includes(media.status)}>Save media details</button>
    </form>
    <div className="actions" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
      {attach && <button className="secondary" type="button" disabled={busy || attached || !["ready", "published", "publishing"].includes(media.status)} onClick={attach}>{attached ? "Attached" : "Attach to product"}</button>}
      {["uploading", "validating"].includes(media.status) && <button className="secondary" type="button" disabled={busy} onClick={() => void act(() => api(`/${media.id}/complete`, "POST", {}))}>Retry validation</button>}
      <button className="secondary" type="button" disabled={busy || attached || ["published", "publishing", "validating"].includes(media.status)} onClick={() => void act(() => api(`/${media.id}`, "DELETE", { version: media.version }))}>Delete unused file</button>
    </div>
  </article>;
}

export function MediaManager({ productId, productVersion, onProductVersionChange, onDirtyChange }: Props) {
  const [media, setMedia] = useState<AdminMedia[]>([]); const [product, setProduct] = useState<ProductMediaState | null>(null);
  const [items, setItems] = useState<MediaAttachment[]>([]); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [error, setError] = useState("");
  const [galleryDirty, setGalleryDirty] = useState(false); const galleryDirtyRef = useRef(false);
  const [dirtyMedia, setDirtyMedia] = useState<Record<string, boolean>>({});
  const hasMetadataEdits = Object.values(dirtyMedia).some(Boolean); const metadataDirtyRef = useRef(false);
  useEffect(() => { metadataDirtyRef.current = hasMetadataEdits; }, [hasMetadataEdits]);
  const [showLibrary, setShowLibrary] = useState(!productId); const [search, setSearch] = useState("");
  const mediaDirty = useCallback((id: string, dirty: boolean) => setDirtyMedia(previous => previous[id] === dirty ? previous : { ...previous, [id]: dirty }), []);
  useEffect(() => { onDirtyChange?.(galleryDirty || Object.values(dirtyMedia).some(Boolean) || busy); }, [galleryDirty, dirtyMedia, busy, onDirtyChange]);
  const load = useCallback(async (resetGallery = false) => {
    setMedia(await api<AdminMedia[]>(""));
    if (productId && resetGallery) { const next = await api<ProductMediaState>(`/attachments?productId=${encodeURIComponent(productId)}`); setProduct(next); setItems(next.items); galleryDirtyRef.current = false; setGalleryDirty(false); }
  }, [productId]);
  useEffect(() => { if (!galleryDirtyRef.current && !metadataDirtyRef.current) void load(true).catch((failure) => setError(failure instanceof Error ? failure.message : "Media could not load.")); }, [load, productVersion]);
  const act = async (task: () => Promise<unknown>, refreshGallery = false) => {
    setBusy(true); setError(""); setMessage("");
    try { await task(); await load(refreshGallery); setMessage("Saved."); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Media request failed."); }
    finally { setBusy(false); }
  };
  const editItems = (update: (previous: MediaAttachment[]) => MediaAttachment[]) => {
    setItems(update); galleryDirtyRef.current = true; setGalleryDirty(true);
  };
  const upload = async (file: File) => {
    await act(async () => {
      const kind = file.type === "video/mp4" ? "video" : "image";
      const ticket = await api<{ mediaId: string; uploadUrl: string; requiredHeaders: Record<string, string> }>("/uploads", "POST", { fileName: file.name, contentType: file.type, sizeBytes: file.size, kind });
      setMessage("Uploading to private staging…");
      const response = await fetch(ticket.uploadUrl, { method: "PUT", headers: ticket.requiredHeaders, body: file, credentials: ticket.uploadUrl.startsWith("/") ? "same-origin" : "omit" });
      if (!response.ok) throw new Error("Upload could not finish. Choose the file again to create a new upload.");
      setMessage("Upload complete — validating file.");
      await api(`/${ticket.mediaId}/complete`, "POST", {});
    });
  };
  const saveAttachments = () => act(async () => {
    if (!product || !productId) return;
    const result = await api<{ version: number }>("/attachments", "PUT", { productId, version: product.version, items });
    galleryDirtyRef.current = false; setGalleryDirty(false);
    onProductVersionChange?.(result.version);
  }, true);
  const move = (index: number, direction: -1 | 1) => editItems((previous) => {
    const next = [...previous]; const target = index + direction;
    if (target < 0 || target >= next.length) return previous;
    [next[index], next[target]] = [next[target]!, next[index]!]; return next;
  });
  return <section aria-label="Media manager">
    <div className="panel"><h2>Media library</h2><p>Images: JPEG, PNG, WebP or AVIF, up to {MEDIA_LIMITS.imageBytes / 1024 / 1024} MB. Video: MP4 with H.264/AAC, up to 50 MB, 30 seconds and 1920 pixels per side. Add a validated poster before publishing video.</p>
      <label>Upload media<input type="file" accept="image/jpeg,image/png,image/webp,image/avif,video/mp4" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ""; }} /></label>
      <p className="muted small">Files stay private until validated and published with a product. Supply accurate alternative text and record your permission to use each asset.</p>
      {!productId && <button className="secondary" type="button" disabled={busy} onClick={() => void act(() => api("/cleanup", "POST", {}))}>Clean expired unused uploads</button>}
    </div>
    {message && <p role="status" className="notice">{message}</p>}{error && <p role="alert" className="notice error">{error}</p>}
    {product && <div className="panel"><h3>Product gallery</h3><p>Choose the order, colour and cover. Saving changes returns the product to draft until it is published again.</p>
      {galleryDirty && <p className="notice">Gallery changes are not saved yet. Save them before publishing.</p>}
      {items.length === 0 && <p>No media is attached yet.</p>}
      {items.map((item, index) => <div key={item.mediaId} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <button className="secondary" type="button" disabled={busy || hasMetadataEdits} onClick={() => { setSearch(item.mediaId); setShowLibrary(true); }}>Edit details</button>
        <span style={{ flex: "1 1 170px", overflowWrap: "anywhere" }}>{index + 1}. {media.find((row) => row.id === item.mediaId)?.alt || "Untitled media"}</span>
        <label>Colour<select value={item.colorKey ?? ""} disabled={busy} onChange={(event) => editItems((previous) => previous.map((row, position) => position === index ? { ...row, colorKey: event.target.value || null } : row))}><option value="">Shared image</option>{product.colors.map((color) => <option key={color.key} value={color.key}>{color.label}</option>)}</select></label>
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}><input type="checkbox" style={{ width: "auto" }} checked={item.isCover} disabled={busy} onChange={(event) => editItems((previous) => previous.map((row, position) => position === index ? { ...row, isCover: event.target.checked } : row))} />Cover</label>
        <button className="secondary" type="button" aria-label={`Move image ${index + 1} up`} disabled={busy || index === 0} onClick={() => move(index, -1)}>↑</button><button className="secondary" type="button" aria-label={`Move image ${index + 1} down`} disabled={busy || index === items.length - 1} onClick={() => move(index, 1)}>↓</button>
        <button className="secondary" type="button" disabled={busy} onClick={() => editItems((previous) => previous.filter((_, position) => position !== index))}>Detach</button>
      </div>)}<button type="button" disabled={busy || !galleryDirty} onClick={() => void saveAttachments()}>Save product gallery</button> <button className="secondary" type="button" disabled={busy || hasMetadataEdits} onClick={() => void load(true).catch(() => setError("Could not reload the saved gallery."))}>{galleryDirty ? "Discard gallery edits and reload" : "Reload saved gallery"}</button>
    </div>}
    <div className="actions" style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "16px 0" }}>
      {productId && <button type="button" className="secondary" disabled={busy || hasMetadataEdits} onClick={() => setShowLibrary(previous => !previous)}>{showLibrary ? "Hide library" : "Choose from library"}</button>}
      <button type="button" className="secondary" disabled={busy || hasMetadataEdits} onClick={() => void load(false).catch(() => setError("Could not refresh the library."))}>Refresh library</button>
    </div>
    {showLibrary && <><label>Search media<input type="search" value={search} disabled={hasMetadataEdits} onChange={event => setSearch(event.target.value)} placeholder="Alternative text or media ID" /></label>
      {hasMetadataEdits && <p className="notice">Save media details before changing the library view.</p>}
      <p className="muted small">Showing up to 12 matching assets. Search to narrow the library.</p>
      {media.length === 0 && <p>No uploaded media yet.</p>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 270px), 1fr))", gap: 16 }}>
        {media.filter(row => `${row.alt} ${row.id} ${row.type} ${row.source}`.toLowerCase().includes(search.toLowerCase())).slice(0, 12).map((row) => <MediaCard key={`${row.id}:${row.version}`} media={row} allMedia={media} busy={busy} act={act} onDirty={mediaDirty} attached={items.some((item) => item.mediaId === row.id)} {...(productId ? { attach: () => editItems((previous) => [...previous, { mediaId: row.id, colorKey: null, isCover: previous.length === 0 }]) } : {})} />)}
      </div>
    </>}
  </section>;
}
export default MediaManager;
