"use client";

import { useState } from "react";
import { JoinForm } from "../join/[code]/join-form";

/** For people who joined with a link and have no password. */
export function InviteSignIn() {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-sm text-ink transition-colors hover:text-ink-muted">
        Joined with an invitation? Sign in with your email
      </button>
    );
  }
  return (
    <div className="text-left">
      <p className="mb-4 text-center text-sm text-ink-muted">
        Paste the invitation link you were sent (or just its phrase) and your email.
      </p>
      <JoinForm />
    </div>
  );
}
