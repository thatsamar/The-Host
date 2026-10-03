import type { Metadata } from "next";
import { Hub } from "@/components/hub";
import { Studio } from "@/components/studio";
import { signInRequired } from "@/lib/auth/access";
import { inviteCode } from "@/lib/auth/invite";
import { copyOf, currentCompanion } from "@/lib/companions";

export const metadata: Metadata = {
  title: process.env.COMPANION === "hub" ? "Inner Circle" : undefined,
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: process.env.COMPANION === "hub" ? "Inner Circle" : undefined,
  },
};

export default function Home() {
  // If deployed as hub (COMPANION=hub), show the landing page
  if (process.env.COMPANION === "hub") {
    return <Hub />;
  }

  // Otherwise, show the advisor studio
  const companion = copyOf(currentCompanion());
  const studioProps = !signInRequired()
    ? { companion, share: { path: "/", label: "Share" } }
    : { companion, share: inviteCode() ? { path: `/join/${encodeURIComponent(inviteCode()!)}`, label: "Invite" } : null, signedIn: true };

  return <Studio {...studioProps} />;
}
