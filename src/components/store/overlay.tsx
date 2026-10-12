"use client";
import { useEffect, useId, useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import "./purchase.css";
let scrollLocks = 0;
let previousOverflow = "";
export function StoreOverlay({ title, children, onClose, className = "", returnFocus }: { title: string; children: ReactNode; onClose: () => void; className?: string; returnFocus?: HTMLElement | null }) {
  const dialog = useRef<HTMLDialogElement>(null); const heading = useId(); const owner = useId(); const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    const node = dialog.current!; const origin = returnFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const otherOpened = (event: Event) => { if ((event as CustomEvent<{ owner: string }>).detail?.owner !== owner) { node.close(); close.current(); } };
    document.addEventListener("store:overlay-opening", otherOpened);
    document.dispatchEvent(new CustomEvent("store:overlay-opening", { detail: { owner } }));
    if (scrollLocks++ === 0) { previousOverflow = document.body.style.overflow; document.body.style.overflow = "hidden"; }
    node.showModal();
    return () => {
      document.removeEventListener("store:overlay-opening", otherOpened); node.close();
      if (--scrollLocks === 0) document.body.style.overflow = previousOverflow;
      // A replacing overlay owns focus; do not send it behind the new dialog.
      if (!document.querySelector("dialog[open][data-store-overlay]")) {
        const target = origin?.isConnected && origin !== document.body && !origin.matches(":disabled") ? origin : document.querySelector<HTMLElement>('.store-header button[aria-label^="Cart"]');
        target?.focus({ preventScroll: true });
      }
    };
  }, [owner, returnFocus]);
  function keepFocus(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Tab") return;
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('a[href],button,input,select,textarea,summary,[tabindex]')].filter((node) => !node.matches(":disabled") && node.tabIndex >= 0 && node.getClientRects().length > 0);
    const first = items[0], last = items[items.length - 1];
    if (!first || !last) { event.preventDefault(); return; }
    if (event.shiftKey && (document.activeElement === first || !event.currentTarget.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || !event.currentTarget.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
  }
  return <dialog ref={dialog} data-store-overlay="true" aria-labelledby={heading} className={`store-overlay ${className}`} onKeyDown={keepFocus} onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => { if (event.target === event.currentTarget) { const box = event.currentTarget.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose(); } }}><div className="store-overlay-heading"><h2 id={heading}>{title}</h2><button type="button" className="store-icon-button" aria-label={`Close ${title.toLowerCase()}`} onClick={onClose}>×</button></div>{children}</dialog>;
}
export default StoreOverlay;
