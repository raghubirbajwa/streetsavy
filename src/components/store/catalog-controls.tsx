"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import type { FormEvent } from "react";
import { catalogHref, resetCatalogFilters, serializeCatalogQuery } from "../../lib/catalog/query.ts";
import type { CatalogFacets, CatalogQuery, CatalogSort } from "../../lib/catalog/query.ts";
import { StoreOverlay } from "./overlay.tsx";
import styles from "./catalog.module.css";

const money = (value: number | null) => value === null ? "" : String(value / 100);
const displayMoney = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value / 100);

function readPrice(value: FormDataEntryValue | null): number | null {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,2})?$/.test(value)) throw new Error("Enter a positive price in rupees with up to two decimal places.");
  const [whole = "0", fraction = ""] = value.split(".");
  const paise = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(paise)) throw new Error("That price is too large. Enter a smaller amount.");
  return paise;
}

function FilterFields({ query, facets, onChange, prefix, priceError }: { query: CatalogQuery; facets: CatalogFacets; onChange: (next: CatalogQuery) => void; prefix: string; priceError: boolean }) {
  function toggle(key: "category" | "size" | "color", value: string) {
    onChange({ ...query, [key]: query[key].includes(value) ? query[key].filter((item) => item !== value) : [...query[key], value], page: 1, notices: [] });
  }
  return <div className={styles.fields}>
    {([{ key: "category", title: "Category", options: facets.categories }, { key: "size", title: "Size", options: facets.sizes.map((value) => ({ value, label: value === "ONE_SIZE" ? "One size" : value })) }, { key: "color", title: "Colour", options: facets.colors }] as const).map((group) => <fieldset key={group.key}>
      <legend>{group.title}</legend>
      <div className={styles.checks}>{group.options.map(({ value, label }) => <label key={value}>
        <input type="checkbox" name={group.key} value={value} checked={query[group.key].includes(value)} onChange={() => toggle(group.key, value)} />
        <span>{label}</span>
      </label>)}</div>
    </fieldset>)}
    <fieldset>
      <legend>Price in INR</legend>
      <div className={styles.prices}>
        <label htmlFor={`${prefix}-min-price`}>Minimum ₹<input id={`${prefix}-min-price`} name="minPriceRs" key={`min-${query.minPrice}`} defaultValue={money(query.minPrice)} inputMode="decimal" placeholder="Any" aria-invalid={priceError || undefined} aria-describedby={priceError ? `${prefix}-price-error` : undefined} /></label>
        <label htmlFor={`${prefix}-max-price`}>Maximum ₹<input id={`${prefix}-max-price`} name="maxPriceRs" key={`max-${query.maxPrice}`} defaultValue={money(query.maxPrice)} inputMode="decimal" placeholder="Any" aria-invalid={priceError || undefined} aria-describedby={priceError ? `${prefix}-price-error` : undefined} /></label>
      </div>
    </fieldset>
    <fieldset><legend>Availability</legend><div className={styles.checks}><label><input type="checkbox" name="inStock" checked={query.inStock} onChange={(event) => onChange({ ...query, inStock: event.target.checked, page: 1, notices: [] })} /><span>In stock only</span></label></div></fieldset>
  </div>;
}

export function CatalogControls({ query: currentQuery, facets, path, total, search = false }: { query: CatalogQuery; facets: CatalogFacets; path: string; total: number; search?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setOptimisticQuery] = useOptimistic(currentQuery, (_previous, next: CatalogQuery) => next);
  const desktopForm = useRef<HTMLFormElement>(null);
  const [draft, setDraft] = useState<CatalogQuery | null>(null);
  const [priceError, setPriceError] = useState("");
  const signature = `${path}?${serializeCatalogQuery(currentQuery)}`;
  const [stateOwner, setStateOwner] = useState(signature);
  if (stateOwner !== signature) {
    // URL commits discard the prior draft without remounting the open desktop filters.
    setStateOwner(signature); setDraft(null); setPriceError("");
  }
  useEffect(() => {
    // Uncontrolled price inputs also follow a committed URL, including Back/Reset.
    for (const [name, value] of [["minPriceRs", currentQuery.minPrice], ["maxPriceRs", currentQuery.maxPrice]] as const) {
      const field = desktopForm.current?.elements.namedItem(name);
      if (field instanceof HTMLInputElement) field.value = money(value);
    }
  }, [signature, currentQuery.minPrice, currentQuery.maxPrice]);

  function commit(next: CatalogQuery) {
    setPriceError("");
    startTransition(() => { setOptimisticQuery({ ...next, page: 1 }); router.push(catalogHref(path, next, 1), { scroll: false }); });
  }
  function withFormPrices(form: HTMLFormElement, base: CatalogQuery): CatalogQuery | null {
    try {
      const data = new FormData(form);
      const next = { ...base, minPrice: readPrice(data.get("minPriceRs")), maxPrice: readPrice(data.get("maxPriceRs")), page: 1, notices: [] };
      setPriceError(""); return next;
    } catch (error) { setPriceError(error instanceof Error ? error.message : "Check the price range."); return null; }
  }
  function apply(event: FormEvent<HTMLFormElement>, base: CatalogQuery) {
    event.preventDefault();
    const next = withFormPrices(event.currentTarget, base);
    if (next) { setDraft(null); commit(next); }
  }
  const selected = query.category.length + query.size.length + query.color.length + Number(query.inStock) + Number(query.minPrice !== null || query.maxPrice !== null);
  const chips = (["category", "size", "color"] as const).flatMap((key) => query[key].map((value) => ({ key: `${key}:${value}`, label: key === "size" ? (value === "ONE_SIZE" ? "One size" : value) : (key === "category" ? facets.categories : facets.colors).find((option) => option.value === value)?.label ?? value, next: { ...query, [key]: query[key].filter((item) => item !== value) } })));
  if (query.inStock) chips.push({ key: "inStock", label: "In stock", next: { ...query, inStock: false } });
  if (query.minPrice !== null || query.maxPrice !== null) chips.push({ key: "price", label: `${query.minPrice === null ? "Any" : displayMoney(query.minPrice)} – ${query.maxPrice === null ? "Any" : displayMoney(query.maxPrice)}`, next: { ...query, minPrice: null, maxPrice: null } });
  const hiddenSearchFields = [...new URLSearchParams(serializeCatalogQuery({ ...query, q: "", page: 1 }))];
  return <div className={styles.controls} aria-busy={pending}>
    {search && <form className={styles.search} action="/search" role="search">
      <label htmlFor="catalog-search">Search the collection<input id="catalog-search" type="search" name="q" key={query.q} defaultValue={query.q} placeholder="Try tees, washed or cargos" /></label>
      {hiddenSearchFields.map(([key, value], index) => <input key={`${key}-${index}`} type="hidden" name={key} value={value} />)}
      <button type="submit">Search</button>
    </form>}
    <div className={styles.toolbar}>
      <p role="status" aria-live="polite">{pending ? "Updating pieces…" : `${total} ${total === 1 ? "piece" : "pieces"}`}</p>
      <button type="button" className={styles.mobileFilter} onClick={() => { setPriceError(""); setDraft({ ...query }); }}>Filters{selected ? ` (${selected})` : ""}</button>
      <label className={styles.sort}>Sort by<select value={query.sort} onChange={(event) => commit({ ...query, sort: event.target.value as CatalogSort })}>
        <option value="featured">Featured</option><option value="newest">Newest</option><option value="price-asc">Price: low to high</option><option value="price-desc">Price: high to low</option>
      </select></label>
    </div>
    <details className={styles.desktopFilters}>
      <summary>Filters{selected ? ` (${selected})` : ""}<span aria-hidden="true">+</span></summary>
      <form ref={desktopForm} onSubmit={(event) => apply(event, query)} onBlur={(event) => {
        if (!["minPriceRs", "maxPriceRs"].includes(event.target.getAttribute("name") ?? "")) return;
        const next = withFormPrices(event.currentTarget, query);
        if (next && (next.minPrice !== query.minPrice || next.maxPrice !== query.maxPrice)) commit(next);
      }}>
        <FilterFields query={query} facets={facets} onChange={(next) => { const prices = desktopForm.current ? withFormPrices(desktopForm.current, next) : next; if (prices) commit(prices); }} prefix="desktop" priceError={!!priceError} />
        {priceError && <p id="desktop-price-error" className={styles.error} role="alert">{priceError}</p>}
        <button type="submit" className={styles.priceApply}>Apply price range</button>
      </form>
    </details>
    {chips.length > 0 && <div className={styles.chips} aria-label="Active filters">{chips.map((chip) => <Link key={chip.key} href={catalogHref(path, chip.next, 1)} scroll={false} aria-label={`Remove ${chip.label} filter`}>{chip.label}<span aria-hidden="true">×</span></Link>)}<Link className={styles.reset} href={catalogHref(path, resetCatalogFilters(query))} scroll={false}>Reset filters</Link></div>}
    {draft && <StoreOverlay title="Filter pieces" onClose={() => { setDraft(null); setPriceError(""); }} className={styles.filterOverlay!}>
      <form onSubmit={(event) => apply(event, draft)} className={styles.mobileForm}>
        <FilterFields query={draft} facets={facets} onChange={setDraft} prefix="mobile" priceError={!!priceError} />
        {priceError && <p id="mobile-price-error" className={styles.error} role="alert">{priceError}</p>}
        <div className={styles.applyBar}><button type="button" className="secondary" onClick={(event) => { event.currentTarget.form?.reset(); setPriceError(""); setDraft(resetCatalogFilters(draft)); }}>Reset</button><button type="submit">Apply filters</button></div>
      </form>
    </StoreOverlay>}
  </div>;
}
