import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JournalView } from "@/components/journal";
import { copyOf, currentCompanion } from "@/lib/companions";

export const metadata: Metadata = { title: `Matchbook · ${currentCompanion().name}` };

export default function MatchbookPage() {
  const companion = currentCompanion();
  if (!companion.journal) notFound();
  return <JournalView companion={copyOf(companion)} page="matchbook" />;
}
