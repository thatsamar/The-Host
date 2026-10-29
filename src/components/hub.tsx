"use client";

import Link from "next/link";
import { useState } from "react";

// Alden’s address comes from NEXT_PUBLIC_ALDEN_URL on the hub project, set
// once his deployment exists; until then his card says he’s coming soon.
const ADVISOR_URLS: Record<string, string | undefined> = {
  tony: "https://tony-ten-bay.vercel.app",
  martini: "https://the-host-8xye.vercel.app",
  gio: "https://gio-chi.vercel.app",
  alden: process.env.NEXT_PUBLIC_ALDEN_URL || undefined,
  goldie: "https://untangled-hazel.vercel.app",
};

interface Card {
  id: string;
  category: string;
  advisorName: string;
  url?: string;
}

const CATEGORIES: Card[] = [
  {
    id: "tony",
    category: "Travel",
    advisorName: "Amar",
    url: ADVISOR_URLS.tony,
  },
  {
    id: "martini",
    category: "Style",
    advisorName: "Martine",
    url: ADVISOR_URLS.martini,
  },
  {
    id: "gio",
    category: "Design",
    advisorName: "Gio",
    url: ADVISOR_URLS.gio,
  },
  {
    id: "alden",
    category: "Wine, cocktails & spirits",
    advisorName: "Alden",
    url: ADVISOR_URLS.alden,
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
  const [showSms, setShowSms] = useState(false);

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
          {CATEGORIES.map((card) => {
            const style = {
              backgroundColor: "transparent",
              border: `1px solid ${borderColor}`,
              minHeight: "56px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "1rem",
            } as const;
            const content = (
              <>
                {/* Left: Category Name */}
                <h2 className="text-lg sm:text-lg font-serif font-normal leading-tight" style={{ color: textDark }}>
                  {card.category}
                </h2>
                {/* Right: Advisor Name with Chevron, or a note while there’s no address yet */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <p className="text-sm sm:text-sm font-serif" style={{ color: textMuted }}>
                    {card.url ? card.advisorName : `${card.advisorName} · Coming soon`}
                  </p>
                  {card.url && <span style={{ color: textMuted }}>›</span>}
                </div>
              </>
            );
            return card.url ? (
              <a
                key={card.id}
                href={card.url}
                className="group block p-4 sm:p-4 rounded-2xl transition-all hover:shadow-sm active:shadow-xs"
                style={style}
              >
                {content}
              </a>
            ) : (
              <div key={card.id} className="block p-4 sm:p-4 rounded-2xl" style={style}>
                {content}
              </div>
            );
          })}
        </div>

        <div className="text-center" style={{ marginTop: '1.5rem' }}>
          <Link href="/about" className="font-serif text-sm underline-offset-4 hover:underline" style={{ color: textMuted }}>
            About Cinq
          </Link>
        </div>

        {/* SMS signup */}
        <div className="rounded-2xl p-4 sm:p-4" style={{ border: `1px solid ${borderColor}`, marginTop: '1.5rem' }}>
          <h2 className="text-lg font-serif font-normal leading-tight" style={{ color: textDark, marginBottom: '0.25rem' }}>
            Cinq by text
          </h2>
          <p className="font-serif text-sm leading-relaxed" style={{ color: textMuted, marginBottom: '0.75rem' }}>
            Get answers from the five advisors by SMS/MMS during the pilot.
          </p>
          <button
            type="button"
            onClick={() => setShowSms(!showSms)}
            className="font-serif text-sm rounded-full px-4 py-2 transition-all hover:shadow-sm active:shadow-xs"
            style={{ border: `1px solid ${borderColor}`, color: textDark, backgroundColor: "transparent" }}
          >
            {showSms ? "Hide signup details" : "Sign up for SMS updates"}
          </button>
          {showSms && (
            <div className="font-serif text-sm leading-relaxed" style={{ color: textMuted, marginTop: '0.75rem' }}>
              <p style={{ marginBottom: '0.5rem' }}>
                By signing up, you agree to receive SMS/MMS messages from Cinq at the number you text from, including answers from our five AI advisors. Message frequency varies with your usage. Message and data rates may apply.
              </p>
              <p style={{ marginBottom: '0.5rem' }}>
                To join the pilot, text START to our toll-free number \u2014 coming soon; the number will be added here once Twilio setup is complete. Reply STOP to opt out at any time, HELP for help.
              </p>
              <p>
                <Link href="/privacy" className="underline underline-offset-4 hover:underline">Privacy Policy</Link>
                {" \u00b7 "}
                <Link href="/terms" className="underline underline-offset-4 hover:underline">Terms of Service</Link>
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="text-center text-xs sm:text-sm font-light" style={{ color: textMuted }}>
        <p>Speak freely. Every conversation starts anew.</p>
        <p style={{ marginTop: '0.25rem' }}>
          <Link href="/privacy" className="underline underline-offset-4 hover:underline">Privacy</Link>
          {" \u00b7 "}
          <Link href="/terms" className="underline underline-offset-4 hover:underline">Terms</Link>
        </p>
      </div>
    </div>
  );
}
