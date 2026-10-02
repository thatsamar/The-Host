"use client";

import { COMPANIONS } from "@/lib/companions";
import type { CompanionId } from "@/lib/companions/types";
import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";

const ADVISOR_URLS: Record<string, string> = {
  tony: "https://tony-ten-bay.vercel.app",
  martini: "https://the-host-8xye.vercel.app",
  gio: "https://gio-chi.vercel.app",
  jack: "https://jack-fawn-iota.vercel.app",
  goldie: "https://untangled-hazel.vercel.app",
};

const HUB_URL = "https://thehub-chi.vercel.app";

interface AdvisorNavProps {
  currentAdvisorId: string;
}

export function AdvisorNav({ currentAdvisorId }: AdvisorNavProps) {
  const [isOpen, setIsOpen] = useState(false);
  const currentAdvisor = COMPANIONS[currentAdvisorId as CompanionId];
  const otherAdvisors = Object.values(COMPANIONS).filter((a) => a.id !== currentAdvisorId);

  return (
    <div className="border-b" style={{ borderColor: "var(--line)", backgroundColor: "var(--surface)" }}>
      <div className="max-w-3xl mx-auto px-6 py-3">
        <div className="flex items-center justify-between">
          <a
            href={HUB_URL}
            className="text-sm hover:opacity-70 transition-opacity"
            style={{ color: "var(--ink-muted)" }}
          >
            ← Back to hub
          </a>

          <div className="flex items-center gap-4">
            <span className="text-sm font-serif" style={{ color: "var(--ink)" }}>
              {currentAdvisor?.name}
            </span>

            {otherAdvisors.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => setIsOpen(!isOpen)}
                  className="flex items-center gap-1 px-3 py-1 rounded text-sm transition-colors"
                  style={{
                    backgroundColor: "var(--ground)",
                    color: "var(--ink-muted)",
                  }}
                >
                  Switch
                  <ChevronDownIcon size={16} />
                </button>

                {isOpen && (
                  <div
                    className="absolute right-0 mt-2 rounded-lg shadow-lg z-10 min-w-48"
                    style={{
                      backgroundColor: "var(--surface)",
                      border: "1px solid var(--line)",
                    }}
                  >
                    {otherAdvisors.map((advisor) => (
                      <a
                        key={advisor.id}
                        href={ADVISOR_URLS[advisor.id]}
                        className="block px-4 py-2 text-sm hover:bg-opacity-50 transition-colors first:rounded-t-lg last:rounded-b-lg"
                        style={{ color: "var(--ink)" }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = "var(--ground)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = "transparent";
                        }}
                      >
                        {advisor.name} — {advisor.tagline}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
