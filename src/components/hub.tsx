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
    advisorName: "Martine", // matches companion.name in martini.ts
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
    category: "Reality check",
    advisorName: "Jack",
    url: ADVISOR_URLS.jack,
  },
  {
    id: "goldie",
    category: "Sounding board",
    advisorName: "Goldie",
    url: ADVISOR_URLS.goldie,
  },
];

export function Hub() {
  const bgColor = "#FAF9F6";
  const textDark = "#191816";
  const textMuted = "#55514D";
  const borderColor = "#C9C4BC";

  return (
    <div className="w-screen min-h-screen flex flex-col items-center justify-between p-4 sm:p-6" style={{ backgroundColor: bgColor }}>
      <div className="w-full max-w-sm" style={{ paddingTop: 'max(0.5rem, 0.5vh + env(safe-area-inset-top))' }}>
        {/* Wordmark and Definitions */}
        <div className="text-center" style={{ marginBottom: '1.75rem' }}>
          <h1 className="font-serif text-5xl sm:text-6xl font-normal leading-none tracking-tight" style={{ color: textDark, marginBottom: '0.875rem' }}>
            Cinq
          </h1>
          <div className="font-serif text-sm sm:text-base font-normal leading-relaxed" style={{ color: textMuted }}>
            <p style={{ marginBottom: '0.5rem' }}>
              /sɛ̃k/ <span style={{ fontStyle: 'italic' }}>n. pl.</span> five trusted advisors.
            </p>
            <p>
              /sɪŋk/ <span style={{ fontStyle: 'italic' }}>v.</span> to make life better.
            </p>
          </div>
        </div>

        {/* Cards - pure navigation */}
        <div className="grid grid-cols-1 gap-3 sm:gap-3">
          {CATEGORIES.map((card) => (
            <a
              key={card.id}
              href={card.url}
              className="group block p-4 sm:p-4 rounded-2xl transition-all hover:shadow-sm active:shadow-xs"
              style={{
                backgroundColor: 'transparent',
                border: `1px solid ${borderColor}`,
                minHeight: '56px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '1rem',
              }}
            >
              {/* Left: Category Name */}
              <h2 className="text-lg sm:text-lg font-serif font-normal leading-tight" style={{ color: textDark }}>
                {card.category}
              </h2>
              {/* Right: Advisor Name with Chevron */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <p className="text-sm sm:text-sm font-serif" style={{ color: textMuted }}>
                  {card.advisorName}
                </p>
                <span style={{ color: textMuted }}>›</span>
              </div>
            </a>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="text-center text-xs sm:text-sm font-light" style={{ color: textMuted }}>
        <p>Speak freely. Every conversation starts anew.</p>
      </div>
    </div>
  );
}
