"use client";

import Link from "next/link";
import { COMPANIONS } from "@/lib/companions";

export function Hub() {
  const companions = Object.values(COMPANIONS);

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

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
          {companions.map((companion) => (
            <Link
              key={companion.id}
              href={`/${companion.id}`}
              className="group block p-6 rounded-[22px] transition-all hover:scale-105"
              style={{
                backgroundColor: 'var(--surface)',
                border: '1px solid var(--line)',
                minHeight: '84px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
              }}
            >
              <div className="flex items-center gap-4 mb-2">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: companion.iconTile }}
                />
                <h2 className="text-lg font-serif" style={{ color: 'var(--ink)' }}>
                  {companion.name}
                </h2>
              </div>
              <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
                {companion.tagline}
              </p>
            </Link>
          ))}
        </div>

        <div className="text-center text-sm mt-12" style={{ color: 'var(--ink-muted)' }}>
          <p>No saved conversations. Each visit is fresh. No database. Your questions stay with you.</p>
        </div>
      </div>
    </div>
  );
}
