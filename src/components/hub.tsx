"use client";

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
  url: string;
}

const CATEGORIES: Card[] = [
  {
    id: "tony",
    category: "Travel",
    promiseLine: "Travel like it matters.",
    advisorName: "Tony",
    url: ADVISOR_URLS.tony,
  },
  {
    id: "martini",
    category: "Style",
    promiseLine: "Dress like you.",
    advisorName: "Martini",
    url: ADVISOR_URLS.martini,
  },
  {
    id: "gio",
    category: "Design",
    promiseLine: "See with a designer's eye.",
    advisorName: "Gio",
    url: ADVISOR_URLS.gio,
  },
  {
    id: "jack",
    category: "Truth",
    promiseLine: "The truth you need.",
    advisorName: "Jack",
    url: ADVISOR_URLS.jack,
  },
  {
    id: "goldie",
    category: "Strategy",
    promiseLine: "Untangle what's complicated.",
    advisorName: "Goldie",
    url: ADVISOR_URLS.goldie,
  },
];

export function Hub() {
  return (
    <div className="w-screen min-h-screen flex flex-col items-center justify-between p-4 sm:p-6" style={{ backgroundColor: 'var(--ground)' }}>
      <div className="w-full max-w-sm">
        {/* Stacked Wordmark */}
        <div className="text-center mb-6 sm:mb-8">
          <h1 className="text-4xl sm:text-5xl font-light font-serif leading-none tracking-tight" style={{ color: 'var(--ink)' }}>
            <div>Inner</div>
            <div>Circle</div>
          </h1>
        </div>

        {/* Cards */}
        <div className="grid grid-cols-1 gap-3 sm:gap-3 mb-auto">
          {CATEGORIES.map((card) => (
            <a
              key={card.id}
              href={card.url}
              className="group block p-3 sm:p-4 rounded-lg sm:rounded-xl transition-all hover:shadow-sm active:shadow-xs"
              style={{
                backgroundColor: 'var(--surface)',
                border: '1px solid var(--line)',
                minHeight: '72px',
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: '1rem',
                boxShadow: '0 1px 2px rgba(0, 0, 0, 0.02)',
                paddingTop: '0.875rem',
              }}
            >
              {/* Left: Category and Promise */}
              <div className="flex-1 min-w-0">
                <h2 className="text-base sm:text-lg font-serif font-medium leading-tight" style={{ color: 'var(--ink)' }}>
                  {card.category}
                </h2>
                <p className="text-sm sm:text-sm leading-snug mt-0.5" style={{ color: 'var(--ink-muted)' }}>
                  {card.promiseLine}
                </p>
              </div>
              {/* Right: Advisor Name */}
              <div className="flex-shrink-0 text-right">
                <p className="text-xs sm:text-sm font-serif" style={{ color: 'var(--ink-muted)' }}>
                  {card.advisorName}
                </p>
              </div>
            </a>
          ))}
        </div>

        {/* Footer - hide on very short screens */}
        <div className="text-center text-xs mt-4 pt-4 font-light hidden sm:block" style={{ borderTop: '1px solid var(--line)', color: 'var(--ink-muted)' }}>
          <p className="leading-relaxed">Speak freely. Every conversation starts anew.</p>
        </div>
      </div>
    </div>
  );
}
