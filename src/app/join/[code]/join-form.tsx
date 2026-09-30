"use client";

import { useActionState, useId, useState } from "react";
import { join } from "../actions";

/**
 * Email-only sign-in from an invitation. With no code (on the sign-in page, e.g.
 * inside a Home Screen app, which keeps its own sign-in apart from the browser)
 * it also asks for the invitation link or phrase.
 */
export function JoinForm({ code }: { code?: string }) {
  const [state, action, pending] = useActionState(join, undefined);
  // Controlled so a failed attempt (which resets the form) keeps the email.
  const [email, setEmail] = useState("");
  // Unique ids: on the sign-in page this sits beside the password form.
  const id = useId();
  return (
    <form action={action}>
      {code ? (
        <input type="hidden" name="code" value={code} />
      ) : (
        <>
          <label htmlFor={`${id}-code`} className="sr-only">
            Invitation link or phrase
          </label>
          <input
            id={`${id}-code`}
            name="code"
            type="text"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Invitation link or phrase"
            required
            className="mb-3 h-12 w-full rounded-2xl border border-line bg-surface px-4 text-base text-ink outline-none placeholder:text-ink-muted focus-visible:border-line-strong focus-visible:outline-none"
          />
        </>
      )}
      <label htmlFor={`${id}-email`} className="sr-only">
        Email
      </label>
      <input
        id={`${id}-email`}
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
