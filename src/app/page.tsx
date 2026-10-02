import { Hub } from "@/components/hub";
import { Studio } from "@/components/studio";
import { signInRequired } from "@/lib/auth/access";
import { inviteCode } from "@/lib/auth/invite";
import { copyOf, currentCompanion } from "@/lib/companions";

export default function Home() {
  // If deployed as hub (COMPANION=hub), show the landing page
  if (process.env.COMPANION === "hub") {
    return <Hub />;
  }

  // Otherwise, show the advisor studio
  const companion = copyOf(currentCompanion());
  if (!signInRequired()) return <Studio companion={companion} share={{ path: "/", label: "Share" }} />;
  const code = inviteCode();
  const share = code ? { path: `/join/${encodeURIComponent(code)}`, label: "Invite" } : null;
  return <Studio companion={companion} share={share} signedIn />;
}
