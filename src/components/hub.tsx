"use client";

import { COMPANIONS } from "@/lib/companions";

const ADVISOR_URLS: Record<string, string> = {
  tony: "https://tony-ten-bay.vercel.app",
  martini: "https://the-host-8xye.vercel.app",
  gio: "https://gio-chi.vercel.app",
  jack: "https://jack-fawn-iota.vercel.app",
  goldie: "https://untangled-hazel.vercel.app",
};

export function Hub() {
  const ordered = ["tony", "martini", "gio", "jack", "goldie"].map((id) => COMPANIONS[id as keyof typeof COMPANIONS]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6" style={{ backgroundColor: 'var(--ground)' }}>
      <div className="max-w-3xl w-full">
        <div className="text-center mb-6">
          <h1 className="text-4xl md:text-5xl font-light tracking-tight font-serif" style={{ color: 'var(--ink)' }}>
            In your corner
          </h1>
        </div>

        <div className="grid grid-cols-1 gap-4 mb-6">
          {ordered.map((companion) => (
            <a
              key={companion.id}
              href={ADVISOR_URLS[companion.id]}
              className="group block p-4 rounded-[22px] transition-all hover:scale-105 active:scale-100"
              style={{
                backgroundColor: 'var(--surface)',
                border: '1px solid var(--line)',
                minHeight: '68px',
                display: 'flex',
                alignItems: 'center',
                gap: '1rem',
              }}
            >
              <div
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: companion.iconTile }}
              />
              <div className="flex-1">
                <h2 className="text-lg font-serif" style={{ color: 'var(--ink)' }}>
                  {companion.name}
                </h2>
                <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
                  For {companion.tagline.toLowerCase()}
                </p>
              </div>
            </a>
          ))}
        </div>

        <div className="text-center text-sm mt-12" style={{ color: 'var(--ink-muted)' }}>
          <p>No saved conversations. Each visit is fresh. No database. Your questions stay with you.</p>
        </div>
      </div>
    </div>
  );
}
