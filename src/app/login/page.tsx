import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="flex min-h-full items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-tobacco">Private studio</p>
        <h1 className="mt-3 font-serif text-5xl font-light tracking-tight text-ink">Gio</h1>
        <p className="mt-3 font-serif text-lg italic text-ink-soft">Courtney and Amar&rsquo;s design partner.</p>
        <div className="mt-10 border-t border-stone pt-8">
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
