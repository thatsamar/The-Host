import { Studio } from "@/components/studio";
import { signInRequired } from "@/lib/auth/access";
import { inviteCode } from "@/lib/auth/invite";
import { COMPANIONS, copyOf } from "@/lib/companions";
import { notFound } from "next/navigation";

interface Props {
  params: Promise<{ companionId: string }>;
}

export async function generateStaticParams() {
  return Object.keys(COMPANIONS).map((id) => ({ companionId: id }));
}

export default async function CompanionPage({ params }: Props) {
  const { companionId } = await params;
  const companion = COMPANIONS[companionId as keyof typeof COMPANIONS];

  if (!companion) {
    notFound();
  }

  const copy = copyOf(companion);
  if (!signInRequired()) return <Studio companion={copy} share={{ path: "/", label: "Share" }} />;
  const code = inviteCode();
  const share = code ? { path: `/join/${encodeURIComponent(code)}`, label: "Invite" } : null;
  return <Studio companion={copy} share={share} signedIn />;
}
