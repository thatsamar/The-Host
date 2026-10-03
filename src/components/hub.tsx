"use client";

import { InnerCircleLogo } from "./inner-circle-logo";

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
  advisorName: string;
  url: string;
}

const CATEGORIES: Card[] = [
  {
    id: "tony",
    category: "Travel",
    advisorName: "Tony",
    url: ADVISOR_URLS.tony,
  },
  {
    id: "martini",
    category: "Style",
    advisorName: "Martini",
    url: ADVISOR_URLS.martini,
  },
  {
    id: "gio",
    category: "Design",
    advisorName: "Gio",
    url: ADVISOR_URLS.gio,
  },
  {
    id: "jack",
    category: "Truth",
    advisorName: "Jack",
    url: ADVISOR_URLS.jack,
  },
  {
    id: "goldie",
    category: "Strategy",
    advisorName: "Goldie",
    url: ADVISOR_URLS.goldie,
  },
];

export function Hub() {
  return (
    <div className="w-screen min-h-screen flex flex-col items-center justify-between p-4 sm:p-6" style={{ backgroundColor: 'var(--ground)' }}>
      <div className="w-full max-w-sm pt-3 sm:pt-4">
        {/* Logo */}
        <div className="text-center mb-6 sm:mb-8" style={{ color: 'var(--ink)' }}>
          <InnerCircleLogo size={100} />
        </div>

        {/* Cards - pure navigation */}
        <div className="grid grid-cols-1 gap-2 sm:gap-2">
          {CATEGORIES.map((card) => (
            <a
              key={card.id}
              href={card.url}
              className="group block p-3 sm:p-3 rounded-lg sm:rounded-xl transition-all hover:shadow-sm active:shadow-xs"
              style={{
                backgroundColor: 'var(--surface)',
                border: '1px solid var(--line)',
                minHeight: '48px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '1rem',
                boxShadow: '0 1px 2px rgba(0, 0, 0, 0.02)',
              }}
            >
              {/* Left: Category Name */}
              <h2 className="text-base sm:text-base font-serif font-medium leading-tight" style={{ color: 'var(--ink)' }}>
                {card.category}
              </h2>
              {/* Right: Advisor Name */}
              <p className="text-sm sm:text-sm font-serif flex-shrink-0" style={{ color: 'var(--ink-muted)' }}>
                {card.advisorName}
              </p>
            </a>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="text-center text-xs sm:text-sm font-light" style={{ color: 'var(--ink-muted)' }}>
        <p>Speak freely. Every conversation starts anew.</p>
      </div>
    </div>
  );
}
