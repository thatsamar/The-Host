<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Gio project notes

- Build plan is phased (see README "Build status"). Don't stub later-phase features.
- Prompt assembly lives only in `src/lib/gio/prompt.ts`; keep block order and labels stable and covered by `tests/prompt.test.ts`.
- Model access goes through `src/lib/ai/types.ts` interfaces. Model IDs come from env (`GIO_CHAT_MODEL`, `GIO_BACKGROUND_MODEL`).
- Assistant history is replayed as text only (no thinking blocks), because retrieved context changes every turn.
- Every table has RLS on `user_id = auth.uid()`; add policies with any new table. `npm run check:migrations` verifies.
- Checks: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`.
