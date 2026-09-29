<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Gio project notes

- Gio is deliberately one page: photos (up to 10) and/or a question, one conversation per visit, nothing saved. Don't add features back without being asked.
- Prompt assembly lives only in `src/lib/gio/prompt.ts`: system prompt (verbatim, `default-system-prompt.ts`) → app capabilities → conversation. Keep block order and labels stable and covered by `tests/prompt.test.ts`.
- Gio is for invited testers, not one household: keep names and personal references out of the system prompt and the UI (`tests/prompt.test.ts` checks the prompt). The design point of view in the prompt is the owner's; keep it.
- Testers see plain error messages; technical reasons go to the server log (`describeAnthropicError`, `signInErrorMessage`).
- Model access goes through `src/lib/ai/types.ts` interfaces. Model IDs come from env (`GIO_CHAT_MODEL`).
- Assistant history is replayed as text only (no thinking blocks).
- Requests carry the whole visit; `src/lib/gio/budget.ts` keeps them under Vercel's 4.5 MB body limit. Keep photo sizes in `photos.ts` and the budget in step.
- Supabase is used for sign-in only. The old migrations stay for existing projects; nothing reads those tables.
- Checks: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`.
