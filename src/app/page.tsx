import type { Metadata } from "next";
import { Hub } from "@/components/hub";
import { Retired } from "@/components/retired";
import { Studio } from "@/components/studio";
import { signInRequired } from "@/lib/auth/access";
import { inviteCode } from "@/lib/auth/invite";
import { copyOf, currentCompanion } from "@/lib/companions";

export const metadata: Metadata = {
  title: process.env.COMPANION === "hub" ? "Cinq" : undefined,
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: process.env.COMPANION === "hub" ? "Cinq" : undefined,
  },
};

export default function Home() {
  // If deployed as hub (COMPANION=hub), show the landing page
  if (process.env.COMPANION === "hub") {
    return <Hub />;
  }

  // A retired advisor's old address says so, under their own name.
  const current = currentCompanion();
  if (current.retired) return <Retired companion={current} />;

  // Otherwise, show the advisor studio
  const companion = copyOf(current);
  const studioProps = !signInRequired()
    ? { companion, share: { path: "/", label: "Share" } }
    : { companion, share: inviteCode() ? { path: `/join/${encodeURIComponent(inviteCode()!)}`, label: "Invite" } : null, signedIn: true };

  return <Studio {...studioProps} />;
}
