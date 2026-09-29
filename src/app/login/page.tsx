import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="flex min-h-full items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <p className="text-[26px] font-bold leading-none tracking-[-0.04em] text-ink">Gio</p>
        <h1 className="mt-10 font-serif text-[44px] font-normal leading-[1.02] tracking-[-0.02em] text-ink">
          See with a designer&rsquo;s eye.
        </h1>
        <p className="mt-4 text-ink-muted">Courtney and Amar&rsquo;s private design partner.</p>
        <div className="mt-10 border-t border-line pt-8">
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
