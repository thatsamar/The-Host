"use client";

import { useActionState, useState } from "react";
import { join } from "../actions";

export function JoinForm({ code }: { code: string }) {
  const [state, action, pending] = useActionState(join, undefined);
  // Controlled so a failed attempt (which resets the form) keeps the email.
  const [email, setEmail] = useState("");
  return (
    <form action={action}>
      <input type="hidden" name="code" value={code} />
      <label htmlFor="email" className="sr-only">
        Email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        className="h-12 w-full rounded-2xl border border-line bg-surface px-4 text-base text-ink outline-none placeholder:text-ink-muted focus-visible:border-line-strong focus-visible:outline-none"
      />
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
        {pending ? "Opening…" : "Start"}
      </button>
    </form>
  );
}
