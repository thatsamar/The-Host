import { Studio } from "@/components/studio";
import { signInRequired } from "@/lib/auth/access";
import { inviteCode } from "@/lib/auth/invite";
import { copyOf, currentCompanion } from "@/lib/companions";

export default function Home() {
  const companion = copyOf(currentCompanion());
  if (!signInRequired()) return <Studio companion={companion} share={{ path: "/", label: "Share" }} />;
  const code = inviteCode();
  const share = code ? { path: `/join/${encodeURIComponent(code)}`, label: "Invite" } : null;
  return <Studio companion={companion} share={share} signedIn />;
}
