<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Gio project notes

- One engine, four companions: Gio (design), Tony (travel), Martini (style) and Jack (hard truths). Each deployment picks one with `COMPANION`; everything companion-specific (prompt, capabilities, page words, icon tile, modes, error voice, palette) lives in `src/lib/companions/`. Keep the engine free of companion names: Jack's extras are optional companion fields (`modes`, `notes`, `journal`, `palette`, `errors`) that other companions leave off.
- The app is deliberately one page: photos (up to 10) and/or a question, one conversation per visit, nothing saved on a server. Don't add features back without being asked. The one exception is a companion with `journal` (Jack): saved lines, patterns and drafts live in the visitor's browser (`src/lib/journal/`) and appear on `/matchbook`, `/patterns`, `/drafts` and `/settings`, which 404 for everyone else.
- Prompt assembly lives only in `src/lib/ask/prompt.ts`: companion system prompt → app capabilities → mode (if picked) → remembered patterns (if any) → conversation. The first two are cached; mode and memory change per turn and stay after the cache breakpoint. Keep block order and labels stable and covered by `tests/prompt.test.ts`.
- Gio is for invited testers, not one household: keep names and personal references out of its prompt (tested). Tony's prompt is the owner's text and deliberately in Amar Lalvani's voice; its capabilities tell it the traveler isn't Amar. Martini's prompt is the owner's brief verbatim ("me"/"my" means whoever is asking; men's and women's style with equal weight). Jack's opens with the owner's core prompt (written for "The Most Interesting Man in the World", renamed Jack; don't use that name, it's a beer slogan) and keeps the owner's mode instructions and tone examples as written. Keep each point of view as written.
- Testers see plain error messages; technical reasons go to the server log (`describeAnthropicError`, `signInErrorMessage`). A companion with `errors` (Jack) says them in its own voice, except in careful moments: a `plain` mode (Talk Me Off the Ledge) or after an answer flagged medium/high safety, when they stay plain.
- Notes companions (Jack) end each answer with a `<notes>{json}</notes>` block (`src/lib/ask/notes.ts`): the page shows the prose, then cards; the raw text, notes included, is replayed as history. Parsing is lenient and falls back to plain prose.
- Model access goes through `src/lib/ai/types.ts` interfaces. Model IDs come from env (`CHAT_MODEL`).
- Assistant history is replayed as text only (no thinking blocks).
- Requests carry the whole visit; `src/lib/ask/budget.ts` keeps them under Vercel's 4.5 MB body limit. Keep photo sizes in `photos.ts` and the budget in step.
- Access is open by default (no sign-in); `REQUIRE_SIGN_IN=true` turns sign-in back on (`src/lib/auth/access.ts`, checked in the proxy, the ask route and the page). `/api/ask` caps questions per visitor per hour (`src/lib/ask/rate-limit.ts`).
- Link invitations (`src/lib/auth/invite.ts`, `/join/[code]`) apply only with sign-in on and where `INVITE_CODE` is set. They sign people in with an admin-minted one-time token redeemed by their own session, so no email or password. Keep the secret key server-side.
- Supabase is used for sign-in only, and only where sign-in is on. The old migrations stay for existing projects; nothing reads those tables.
- Checks: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`.
