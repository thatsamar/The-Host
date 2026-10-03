"use client";

import { COMPANIONS } from "@/lib/companions";
import type { CompanionId } from "@/lib/companions/types";

const HUB_URL = "https://thehub-chi.vercel.app";

interface AdvisorNavProps {
  currentAdvisorId: string;
}

export function AdvisorNav({ currentAdvisorId }: AdvisorNavProps) {
  const currentAdvisor = COMPANIONS[currentAdvisorId as CompanionId];

  return (
    <div className="border-b" style={{ borderColor: "var(--line)", backgroundColor: "var(--surface)" }}>
      <div className="max-w-3xl mx-auto px-6 py-3">
        <div className="flex items-center justify-between">
          <a
            href={HUB_URL}
            className="text-sm hover:opacity-70 transition-opacity"
            style={{ color: "var(--ink-muted)" }}
          >
            ← Back
          </a>

          <span className="text-sm font-serif" style={{ color: "var(--ink)" }}>
            {currentAdvisor?.name}
          </span>
        </div>
      </div>
    </div>
  );
}
