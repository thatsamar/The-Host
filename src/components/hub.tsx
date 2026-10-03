"use client";

import { COMPANIONS } from "@/lib/companions";

const ADVISOR_URLS: Record<string, string> = {
  tony: "https://tony-ten-bay.vercel.app",
  martini: "https://the-host-8xye.vercel.app",
  gio: "https://gio-chi.vercel.app",
  jack: "https://jack-fawn-iota.vercel.app",
  goldie: "https://untangled-hazel.vercel.app",
};

interface Card {
  id: string;
  category: string;
  promiseLine: string;
  advisorName: string;
  iconTile: string;
  url: string;
}

const CATEGORIES: Card[] = [
  {
    id: "tony",
    category: "Travel",
    promiseLine: "Travel like it matters.",
    advisorName: "Tony",
    iconTile: "#3E9C8A",
    url: ADVISOR_URLS.tony,
  },
  {
    id: "martini",
    category: "Style",
    promiseLine: "Dress like you.",
    advisorName: "Martini",
    iconTile: "#D9667F",
    url: ADVISOR_URLS.martini,
  },
  {
    id: "gio",
    category: "Design",
    promiseLine: "See with a designer's eye.",
    advisorName: "Gio",
    iconTile: "#E0A04A",
    url: ADVISOR_URLS.gio,
  },
  {
    id: "jack",
    category: "Truth",
    promiseLine: "The Truth You Need.",
    advisorName: "Jack",
    iconTile: "#8A7B6B",
    url: ADVISOR_URLS.jack,
  },
  {
    id: "goldie",
    category: "Strategy",
    promiseLine: "Untangle what's complicated.",
    advisorName: "Goldie",
    iconTile: "#7B8DD9",
    url: ADVISOR_URLS.goldie,
  },
];

export function Hub() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6" style={{ backgroundColor: 'var(--ground)' }}>
      <div className="max-w-3xl w-full">
        <div className="text-center mb-12 relative">
          <div
            className="absolute inset-0 rounded-full blur-3xl -z-10 mx-auto"
            style={{
              backgroundColor: 'var(--ink)',
              opacity: 0.06,
              width: '280px',
              height: '280px',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
            }}
          />
          <h1 className="text-5xl md:text-6xl font-light tracking-tight font-serif leading-tight" style={{ color: 'var(--ink)' }}>
            Inner Circle
          </h1>
        </div>

        <div className="grid grid-cols-1 gap-2 mb-16">
          {CATEGORIES.map((card) => (
            <a
              key={card.id}
              href={card.url}
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
                  backgroundColor: 'transparent',
                  border: `1.5px solid ${card.iconTile}`,
                  width: '10px',
                  height: '10px',
                }}
              />
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-serif leading-tight" style={{ color: 'var(--ink)' }}>
                  {card.category}
                </h2>
                <p className="text-sm leading-relaxed mt-0.5" style={{ color: 'var(--ink-muted)' }}>
                  {card.promiseLine}
                </p>
                <p className="text-xs leading-relaxed mt-1" style={{ color: 'var(--ink-muted)' }}>
                  {card.advisorName}
                </p>
              </div>
            </a>
          ))}
        </div>

        <div className="text-center text-xs mt-16 pt-8 font-light" style={{ borderTop: '1px solid var(--line)', color: 'var(--ink-muted)' }}>
          <p className="leading-relaxed">Speak freely. Every conversation starts anew. Nothing is retained.</p>
        </div>
      </div>
    </div>
  );
}
