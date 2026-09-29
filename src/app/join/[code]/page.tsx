import { currentCompanion } from "@/lib/companions";
import { inviteCode, INVITE_EXPIRED, isValidInvite } from "@/lib/auth/invite";
import { JoinForm } from "./join-form";

export default async function JoinPage({ params }: PageProps<"/join/[code]">) {
  const { code } = await params;
  const companion = currentCompanion();
  const valid = isValidInvite(decodeURIComponent(code), inviteCode());
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-[360px]">
        <p className="text-center text-[22px] font-bold leading-none tracking-[-0.04em] text-ink">{companion.name}</p>
        <h1 className="mt-6 text-center font-serif text-[clamp(40px,10vw,56px)] font-normal leading-[1.02] tracking-[-0.025em] text-ink [text-wrap:balance]">
          {companion.tagline}
        </h1>
        {valid ? (
          <>
            <p className="mt-6 text-center text-ink-muted">You&rsquo;re invited. Enter your email to start.</p>
            <div className="mt-8">
              <JoinForm code={decodeURIComponent(code)} />
            </div>
            <p className="mt-8 text-center text-sm text-ink-muted">No password. On your phone, open this link again any time to get back in.</p>
          </>
        ) : (
          <p className="mt-8 text-center text-ink-muted">{INVITE_EXPIRED}</p>
        )}
      </div>
    </main>
  );
}
