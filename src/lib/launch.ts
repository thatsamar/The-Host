// Settings a production build needs before it can go live, checked by
// next.config.ts. Preview builds are exempt: a preview may show Alden as
// coming soon, but the live Cinq hub must link to him.

type Env = Record<string, string | undefined>;

/** Why this build mustn't go to production, or nothing if it can. */
export function launchProblems(env: Env): string[] {
  const problems: string[] = [];
  const isHub = env.COMPANION?.trim().toLowerCase() === "hub";
  if (isHub && env.VERCEL_ENV === "production" && !env.NEXT_PUBLIC_ALDEN_URL?.trim()) {
    problems.push("NEXT_PUBLIC_ALDEN_URL is not set: the live hub would show Alden as coming soon. Set it to Alden's address and redeploy.");
  }
  return problems;
}
