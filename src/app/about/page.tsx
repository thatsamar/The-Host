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
            <p>Cinq brings you five advisors with taste, judgment and a point of view.</p>
            <p>A free night in Mexico City? Tony knows the neighborhood place most visitors never find.</p>
            <p>Trying on a vintage jacket on Brick Lane? Martine tells you if it suits you.</p>
            <p>Gio helps you decide whether that chair at Round Top belongs in your living room.</p>
            <p>Jack tells you if the pitch you’re excited about is as good as you think.</p>
            <p>And when a board meeting conflicts with your daughter’s dance performance, Goldie helps you figure out what to do.</p>
            <p>Cinq is built on my thirty years in hospitality, design and business, and what I’ve learned from people I trust.</p>
            <p>Cinq. Live better.</p>
          </div>

          <p className="mt-8 text-[17px] leading-snug sm:text-lg">
            Amar Lalvani
            <br />
            <span className="text-ink-muted">Founder</span>
          </p>

          <p className="mt-12 text-[13px] leading-relaxed text-ink-muted">
            Tony, Martine, Gio, Jack and Goldie are AI advisors. Each draws on a distinct body of knowledge and has been
            meticulously trained to bring a well-informed point of view. The decision is always yours.
          </p>
        </main>
      </div>
    </div>
  );
}
