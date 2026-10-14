import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

const isHub = process.env.COMPANION === "hub";

export const metadata: Metadata = isHub ? { title: "About Cinq" } : {};

export default function About() {
  // Only the Cinq hub has an About page; advisor deployments keep their 404.
  if (!isHub) notFound();

  return (
    <div className="min-h-dvh bg-ground px-5 pb-16 pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-6">
      <div className="mx-auto w-full max-w-[34rem]">
        <Link href="/" className="text-sm text-ink-muted transition-colors hover:text-ink">
          ← Back
        </Link>

        <main className="mt-10 font-serif text-ink sm:mt-14">
          <h1 className="text-4xl font-normal leading-none tracking-tight sm:text-5xl">About Cinq</h1>

          <div className="mt-8 space-y-5 text-[17px] leading-relaxed sm:text-lg">
            <p>Cinq gives you five advisors with taste, judgment and a point of view.</p>
            <p>Have a free night in Mexico City? Tony tells you the spots most visitors never find.</p>
            <p>Trying on a vintage jacket on Brick Lane? Martine will tell you if it suits you.</p>
            <p>Found a chair at Round Top? Show Gio a picture. He’ll tell you if it belongs in your living room.</p>
            <p>Looking at a wine list? Show Alden. He’ll help you choose what’s worth ordering.</p>
            <p>Board meeting on the night of your daughter’s dance recital? Goldie helps you sort out what matters and make the call.</p>
            <p>I shaped Cinq’s advisors from what I’ve learned over thirty years in hospitality, design, travel and business, and from people I’ve met and admired.</p>
            <p>A lot of what they know, I learned the hard way. I’d like you to have it sooner.</p>
            <p>Cinq. Keep good company.</p>
          </div>

          <p className="mt-8 text-[17px] leading-snug sm:text-lg">
            Amar Lalvani
            <br />
            <span className="text-ink-muted">Founder</span>
          </p>

          <p className="mt-12 text-[13px] leading-relaxed text-ink-muted">
            Tony, Martine, Gio, Alden and Goldie are AI advisors. They’ll give you an honest opinion. The decision is always
            yours.
          </p>
        </main>
      </div>
    </div>
  );
}
