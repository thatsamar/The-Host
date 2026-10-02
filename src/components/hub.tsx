"use client";

import { COMPANIONS } from "@/lib/companions";

const ADVISOR_URLS: Record<string, string> = {
  tony: "https://tony.vercel.app",
  martini: "https://martini.vercel.app",
  gio: "https://gio.vercel.app",
  jack: "https://jack.vercel.app",
  untangled: "https://untangled.vercel.app",
};

export function Hub() {
  const ordered = ["tony", "martini", "gio", "jack", "untangled"].map((id) => COMPANIONS[id as keyof typeof COMPANIONS]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6" style={{ backgroundColor: 'var(--ground)' }}>
      <div className="max-w-3xl w-full">
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-light mb-4 tracking-tight font-serif" style={{ color: 'var(--ink)' }}>
            In your corner
          </h1>
          <p className="text-lg" style={{ color: 'var(--ink-muted)' }}>
            Five advisors for the things you decide.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 mb-12">
          {ordered.map((companion) => (
            <a
              key={companion.id}
              href={ADVISOR_URLS[companion.id]}
              className="group block p-6 rounded-[22px] transition-all hover:scale-105 active:scale-100"
              style={{
                backgroundColor: 'var(--surface)',
                border: '1px solid var(--line)',
                minHeight: '84px',
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
