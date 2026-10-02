import type { Metadata } from "next";
import { COMPANIONS } from "@/lib/companions";
import { notFound } from "next/navigation";

interface Props {
  children: React.ReactNode;
  params: Promise<{ companionId: string }>;
}

export async function generateStaticParams() {
  return Object.keys(COMPANIONS).map((id) => ({ companionId: id }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { companionId } = await params;
  const companion = COMPANIONS[companionId as keyof typeof COMPANIONS];

  if (!companion) {
    return {};
  }

  return {
    title: companion.name,
    description: companion.description,
    appleWebApp: { capable: true, title: companion.name, statusBarStyle: "default" },
    openGraph: { title: companion.name, description: companion.description, type: "website" },
  };
}

export default async function CompanionLayout({ children, params }: Props) {
  const { companionId } = await params;
  const companion = COMPANIONS[companionId as keyof typeof COMPANIONS];

  if (!companion) {
    notFound();
  }

  return children;
}
