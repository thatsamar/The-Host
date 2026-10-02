import { AdvisorNav } from "@/components/advisor-nav";
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
  const studioProps = !signInRequired()
    ? { companion, share: { path: "/", label: "Share" } }
    : { companion, share: inviteCode() ? { path: `/join/${encodeURIComponent(inviteCode()!)}`, label: "Invite" } : null, signedIn: true };

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      <AdvisorNav currentAdvisorId={companion.id} />
      <Studio {...studioProps} />
    </div>
  );
}
