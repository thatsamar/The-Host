"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export const LIBRARY_CHANGED_EVENT = "gio:library-changed";

/** Tell the processor there may be new work (after an upload or re-index). */
export function notifyLibraryChanged() {
  window.dispatchEvent(new Event(LIBRARY_CHANGED_EVENT));
}

type QueueItem = { id: string; status: string; lease_until: string | null };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Indexing runs in steps driven from the open app: this hook asks the server
 * to index the next queued file, one step at a time, until the queue is empty.
 * Closing the app pauses indexing; it resumes where it left off next time.
 */
export function useLibraryProcessor() {
  const router = useRouter();
  const running = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);

  const run = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    let failures = 0;
    try {
      for (let rounds = 0; rounds < 500; rounds++) {
        const res = await fetch("/api/library/process", { cache: "no-store" });
        if (!res.ok) break;
        const { queue } = (await res.json()) as { queue: QueueItem[] };
        if (!queue.length) break;

        const now = Date.now();
        const next = queue.find(
          (f) => f.status === "pending" || !f.lease_until || new Date(f.lease_until).getTime() < now,
        );
        if (!next) {
          // Another tab or device is working on everything left.
          await sleep(15_000);
          router.refresh();
          continue;
        }

        const step = await fetch("/api/library/process", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileId: next.id }),
        });
        const body = (await step.json().catch(() => ({}))) as { error?: string; busy?: boolean };
        if (step.status === 503) {
          setNotice(body.error ?? "Indexing is unavailable.");
          break;
        }
        router.refresh();
        if (!step.ok) {
          if (++failures >= 3) break;
          await sleep(5_000);
          continue;
        }
        failures = 0;
        setNotice(null);
        if (body.busy) await sleep(15_000);
      }
    } catch {
      // Offline or navigating away; the next trigger picks it up again.
    } finally {
      running.current = false;
    }
  }, [router]);

  useEffect(() => {
    const kick = () => void run();
    // Resume anything left queued from an earlier visit.
    const initial = setTimeout(kick, 500);
    const onVisible = () => document.visibilityState === "visible" && kick();
    window.addEventListener(LIBRARY_CHANGED_EVENT, kick);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(initial);
      window.removeEventListener(LIBRARY_CHANGED_EVENT, kick);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [run]);

  return { notice };
}
