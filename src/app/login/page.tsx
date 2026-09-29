import { currentCompanion } from "@/lib/companions";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  const companion = currentCompanion();
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-[360px]">
        <p className="text-center text-[22px] font-bold leading-none tracking-[-0.04em] text-ink">{companion.name}</p>
        <h1 className="mt-6 text-center font-serif text-[clamp(40px,10vw,56px)] font-normal leading-[1.02] tracking-[-0.025em] text-ink [text-wrap:balance]">
          {companion.tagline}
        </h1>
        <div className="mt-10">
          <LoginForm />
        </div>
        <p className="mt-8 text-center text-sm text-ink-muted">Private beta. Access is by invitation.</p>
      </div>
    </main>
  );
}
