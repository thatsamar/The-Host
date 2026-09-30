import { Studio } from "@/components/studio";
import { inviteCode } from "@/lib/auth/invite";
import { copyOf, currentCompanion } from "@/lib/companions";

export default function Home() {
  const code = inviteCode();
  return <Studio companion={copyOf(currentCompanion())} invitePath={code ? `/join/${encodeURIComponent(code)}` : null} />;
}
