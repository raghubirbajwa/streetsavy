"use client";

import { useSyncExternalStore } from "react";
import { decodeWishlist, encodeWishlist, validWishlistId, wishlistStorageKey } from "../../lib/store/wishlist.ts";

type WishlistSnapshot = { ids: string[]; ready: boolean; error: string };
const serverSnapshot: WishlistSnapshot = { ids: [], ready: false, error: "" };
const storageError = "Saved pieces will last only for this visit because browser storage is unavailable.";
let snapshot = serverSnapshot;
let storageWorks = true;
const listeners = new Set<() => void>();

function publish(ids: string[], error = snapshot.error) {
  if (snapshot.ready && snapshot.error === error && encodeWishlist(snapshot.ids) === encodeWishlist(ids)) return;
  snapshot = { ids, ready: true, error };
  for (const listener of listeners) listener();
}

function readStoredIds() {
  if (storageWorks) {
    try { return decodeWishlist(localStorage.getItem(wishlistStorageKey)); }
    catch { storageWorks = false; }
  }
  return snapshot.ids;
}

function changed(event: StorageEvent) {
  if (event.key !== wishlistStorageKey && event.key !== null) return;
  publish(decodeWishlist(event.newValue));
}

function subscribe(listener: () => void) {
  // This browser subscription hydrates storage after React's matching server snapshot.
  if (listeners.size === 0) {
    window.addEventListener("storage", changed);
    const ids = readStoredIds();
    publish(ids, storageWorks ? "" : storageError);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", changed);
  };
}

function changeWishlist(transform: (ids: string[]) => string[]) {
  const next = transform(readStoredIds()).filter(validWishlistId).slice(0, 100);
  if (storageWorks) {
    try { localStorage.setItem(wishlistStorageKey, encodeWishlist(next)); }
    catch { storageWorks = false; }
  }
  publish(next, storageWorks ? "" : storageError);
}

function toggleWishlist(id: string) {
  if (!validWishlistId(id)) return;
  changeWishlist((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]);
}

function removeWishlist(ids: string[]) {
  const removed = new Set(ids);
  changeWishlist((current) => current.filter((id) => !removed.has(id)));
}

const getSnapshot = () => snapshot;
const getServerSnapshot = () => serverSnapshot;

export function useWishlistStore() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return { wishlistIds: state.ids, wishlistReady: state.ready, wishlistError: state.error, toggleWishlist, removeWishlist };
}
