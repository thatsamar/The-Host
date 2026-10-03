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
        <div className="text-center mb-8">
          <h1 className="text-5xl md:text-6xl font-light tracking-tight font-serif leading-tight" style={{ color: 'var(--ink)' }}>
            In your corner
          </h1>
        </div>

        <div className="grid grid-cols-1 gap-3 mb-16">
          {ordered.map((companion) => (
            <a
              key={companion.id}
              href={ADVISOR_URLS[companion.id]}
              className="group block p-4 rounded-2xl transition-all hover:shadow-sm active:shadow-xs"
              style={{
                backgroundColor: 'var(--surface)',
                border: '1px solid var(--line)',
                minHeight: '60px',
                display: 'flex',
                alignItems: 'center',
                gap: '1.25rem',
                boxShadow: '0 1px 2px rgba(0, 0, 0, 0.02)',
              }}
            >
              <div
                className="rounded-full flex-shrink-0 transition-transform group-hover:scale-110"
                style={{
                  backgroundColor: companion.iconTile,
                  width: '8px',
                  height: '8px',
                }}
              />
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-serif leading-tight" style={{ color: 'var(--ink)' }}>
                  {companion.name}
                </h2>
                <p className="text-sm leading-relaxed mt-0.5" style={{ color: 'var(--ink-muted)' }}>
                  {companion.tagline}
                </p>
              </div>
            </a>
          ))}
        </div>

        <div className="text-center text-xs mt-16 pt-8 font-light" style={{ borderTop: '1px solid var(--line)', color: 'var(--ink-muted)' }}>
          <p className="leading-relaxed">Speak freely. Every visit starts fresh.</p>
        </div>
      </div>
    </div>
  );
}
