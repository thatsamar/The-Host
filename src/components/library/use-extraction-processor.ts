"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export const EXTRACTION_CHANGED_EVENT = "gio:extraction-changed";

export function notifyExtractionChanged() {
  window.dispatchEvent(new Event(EXTRACTION_CHANGED_EVENT));
}

export interface ExtractionProgress {
  waiting: number;
  done: number;
  failed: number;
  proposals: number;
  running: boolean;
  error: string | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Proposes memories from imported conversations, a step at a time, while the
 * app is open. Like library indexing, it pauses when the app closes and
 * resumes next time.
 */
export function useExtractionProcessor(): ExtractionProgress {
  const router = useRouter();
  const running = useRef(false);
  const [progress, setProgress] = useState<ExtractionProgress>({ waiting: 0, done: 0, failed: 0, proposals: 0, running: false, error: null });

  const run = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    let failures = 0;
    try {
      for (let rounds = 0; rounds < 1000; rounds++) {
        const res = await fetch("/api/import/extract", { cache: "no-store" });
        if (!res.ok) break;
        const stats = (await res.json()) as { waiting: number; done: number; failed: number };
        setProgress((p) => ({ ...p, ...stats, running: stats.waiting > 0 }));
        if (!stats.waiting) break;
        const step = await fetch("/api/import/extract", { method: "POST" });
        const body = (await step.json().catch(() => ({}))) as { status?: string; proposals?: number; error?: string };
        if (!step.ok || body.status === "failed") {
          setProgress((p) => ({ ...p, error: body.error ?? "Extraction failed" }));
          if (++failures >= 3) break;
          await sleep(5_000);
          continue;
        }
        failures = 0;
        if (body.proposals) {
          setProgress((p) => ({ ...p, proposals: p.proposals + (body.proposals ?? 0) }));
          router.refresh();
        }
        // Another tab holds every waiting chat.
        if (body.status === "idle") await sleep(15_000);
      }
    } catch {
      // Offline; the next trigger resumes.
    } finally {
      running.current = false;
      setProgress((p) => ({ ...p, running: false }));
    }
  }, [router]);

  useEffect(() => {
    const kick = () => void run();
    const initial = setTimeout(kick, 1500);
    const onVisible = () => document.visibilityState === "visible" && kick();
    window.addEventListener(EXTRACTION_CHANGED_EVENT, kick);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(initial);
      window.removeEventListener(EXTRACTION_CHANGED_EVENT, kick);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [run]);

  return progress;
}
