import type { Companion } from "@/lib/companions/types";

// Where a retired advisor's old address leads. It names the advisor who lived
// here and sends people to Cinq; it never shows another advisor in their place.
export const CINQ_URL = "https://fresh2-pi.vercel.app";

export function Retired({ companion }: { companion: Pick<Companion, "name"> }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-ground px-6 text-center font-serif text-ink">
      <h1 className="text-3xl font-normal leading-tight tracking-tight sm:text-4xl">
        {companion.name} is no longer one of Cinq’s advisors.
      </h1>
      <p className="max-w-[28rem] text-[17px] leading-relaxed text-ink-muted">
        Nothing you asked {companion.name} was saved, so there’s nothing to move.
      </p>
      <a href={CINQ_URL} className="text-[17px] underline underline-offset-4">
        Meet Cinq’s advisors
      </a>
    </main>
  );
}
