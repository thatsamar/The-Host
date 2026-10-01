<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Gio project notes

- One engine, four companions: Gio (design), Tony (travel), Martini (style) and Jack (hard truths). All four have the same features; a companion differs only in its prompt, capabilities, page words and icon. Each deployment picks one with `COMPANION`; everything companion-specific (prompt, capabilities, page words, icon tile) lives in `src/lib/companions/`. Keep the engine free of companion names.
- The app is deliberately one page: photos (up to 10) and/or a question, one conversation per visit, nothing saved. Don't add features back without being asked.
- Prompt assembly lives only in `src/lib/ask/prompt.ts`: companion system prompt → app capabilities → conversation. Keep block order and labels stable and covered by `tests/prompt.test.ts`.
- Gio is for invited testers, not one household: keep names and personal references out of its prompt (tested). Tony's prompt is the owner's text and deliberately in Amar Lalvani's voice; its capabilities tell it the traveler isn't Amar. Martini's prompt is the owner's brief verbatim ("me"/"my" means whoever is asking; men's and women's style with equal weight). Jack's opens with the owner's core prompt, renamed Jack (not "The Most Interesting Man in the World", a beer slogan), and keeps the owner's mode instructions and tone examples as written, as guidance in the prompt rather than app features. Keep each point of view as written.
- Testers see plain error messages; technical reasons go to the server log (`describeAnthropicError`, `signInErrorMessage`).
- Model access goes through `src/lib/ai/types.ts` interfaces. Model IDs come from env (`CHAT_MODEL`).
- Assistant history is replayed as text only (no thinking blocks).
- Requests carry the whole visit; `src/lib/ask/budget.ts` keeps them under Vercel's 4.5 MB body limit. Keep photo sizes in `photos.ts` and the budget in step.
- Access is open by default (no sign-in); `REQUIRE_SIGN_IN=true` turns sign-in back on (`src/lib/auth/access.ts`, checked in the proxy, the ask route and the page). `/api/ask` caps questions per visitor per hour (`src/lib/ask/rate-limit.ts`).
- Link invitations (`src/lib/auth/invite.ts`, `/join/[code]`) apply only with sign-in on and where `INVITE_CODE` is set. They sign people in with an admin-minted one-time token redeemed by their own session, so no email or password. Keep the secret key server-side.
- Supabase is used for sign-in only, and only where sign-in is on. The old migrations stay for existing projects; nothing reads those tables.
- Checks: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`.
