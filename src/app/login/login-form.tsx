"use client";

import { useActionState, useState } from "react";
import { signIn } from "./actions";

const field =
  "h-12 w-full bg-surface px-4 text-base text-ink outline-none placeholder:text-ink-muted focus-visible:outline-none";

export function LoginForm() {
  const [state, action, pending] = useActionState(signIn, undefined);
  // Controlled so a failed attempt (which resets the form) keeps the email.
  const [email, setEmail] = useState("");
  return (
    <form action={action}>
      <div className="overflow-hidden rounded-2xl border border-line bg-surface focus-within:border-line-strong">
        <label htmlFor="email" className="sr-only">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className={field}
        />
        <div className="mx-4 h-px bg-line" />
        <label htmlFor="password" className="sr-only">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder="Password"
          required
          className={field}
        />
      </div>
      {state?.error ? (
        <p role="alert" className="mt-3 text-center text-sm text-warn">
          {state.error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="mt-4 h-12 w-full rounded-full bg-ink text-base font-medium text-ground transition-opacity disabled:opacity-50"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
