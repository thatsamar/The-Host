"use client";

import { useCallback, useSyncExternalStore } from "react";
import { emptyJournal, parseJournal, storageKey, type Journal } from "./store";

// One cached snapshot per key, so React sees a stable value between changes.
const cache = new Map<string, { raw: string | null; journal: Journal }>();
const listeners = new Set<() => void>();
const SERVER = emptyJournal();

function read(key: string): Journal {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {}
  const hit = cache.get(key);
  if (hit && hit.raw === raw) return hit.journal;
  const journal = parseJournal(raw);
  cache.set(key, { raw, journal });
  return journal;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another tab changed it.
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** This companion's journal, from this browser, and a way to change it. */
export function useJournal(companionId: string) {
  const key = storageKey(companionId);
  const journal = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => SERVER,
  );
  const change = useCallback(
    (fn: (j: Journal) => Journal) => {
      const next = fn(read(key));
      const raw = JSON.stringify(next);
      try {
        window.localStorage.setItem(key, raw);
        cache.set(key, { raw, journal: next });
      } catch {
        // Storage is full or blocked (a private window): keep it for this visit.
        cache.set(key, { raw: cache.get(key)?.raw ?? null, journal: next });
      }
      for (const l of listeners) l();
    },
    [key],
  );
  const clear = useCallback(() => {
    try {
      window.localStorage.removeItem(key);
    } catch {}
    cache.delete(key);
    for (const l of listeners) l();
  }, [key]);
  return { journal, change, clear };
}
