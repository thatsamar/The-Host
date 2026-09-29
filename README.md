# Gio

Courtney and Amar's private designer. One page: add up to 10 photos, ask a question, or both, and Gio answers with a designer's eye. It keeps the custom GPT's personality and design philosophy, and nothing else.

- **No saved conversations.** A visit is one conversation. Follow-up questions work while the page is open; **New** or a reload starts fresh.
- **Nothing stored.** Photos are shrunk in the browser and sent with the question. The app has no database tables of its own and keeps no files.
- **Live prices.** Gio can search the web for real listings when a question calls for it.
- **Private.** A sign-in keeps strangers (and their questions on your Anthropic bill) out.

---

## Privacy

- **What leaves the browser.** Each question goes to the app on Vercel with the visit's conversation so far: the text, photos at 1280px for the new question, and smaller copies of earlier photos. The app passes it to **Anthropic** and streams the answer back. When Gio searches the web, the query goes through Anthropic's server-side web search tool.
- **What's kept.** Nothing, by the app. Supabase is used only for sign-in. Vercel serves the app and doesn't store the content.
- **No analytics, no telemetry.** No tracking scripts or error-reporting service. The npm scripts turn off Next.js build telemetry; set `NEXT_TELEMETRY_DISABLED=1` on Vercel too. Fonts are bundled at build time, so the browser never contacts Google. Leave Vercel Analytics and Speed Insights off.

---

## How it works

```
Browser ──► Next.js on Vercel ──► Anthropic (claude-opus-5-5, web search)
                 │
                 └──► Supabase Auth (sign-in only)
```

- `src/components/studio.tsx` is the whole interface: the start screen, the conversation and the composer (camera button, optional text, send).
- `src/lib/gio/photos.ts` shrinks photos in the browser. `src/lib/gio/budget.ts` keeps each request under Vercel's 4.5 MB body limit by dropping the oldest photos from long visits first.
- `src/app/api/ask/route.ts` checks the sign-in, validates the request and streams the answer as NDJSON.
- `src/lib/gio/prompt.ts` assembles what Gio sees, in order: Gio's system prompt (verbatim, in `default-system-prompt.ts`), then an **app capabilities** block that tells Gio what this app does and doesn't have, then the conversation.
- `src/lib/ai/anthropic.ts` streams from Claude with web search, resumes paused search turns, and falls back server-side when a request is refused.

To change how Gio thinks, edit `src/lib/gio/default-system-prompt.ts` and redeploy.

---

## Setup

Needs Node 20+.

1. `npm install`
2. Create a Supabase project (or run `npx supabase start` locally, which needs Docker).
3. In Supabase → **Authentication → Users → Add user**, create the one login you'll share. Tick **Auto Confirm User**.
4. In **Authentication → Sign In / Providers**, turn off **Allow new users to sign up**.
5. `cp .env.example .env.local` and fill in the Supabase URL and publishable key and your Anthropic key.
6. `npm run dev` and open http://localhost:3000.

The `supabase/` folder holds migrations from the earlier, fuller version of Gio. The app no longer reads those tables; an existing project can keep them, and a new one doesn't need them.

### Check it

```
npm test            # prompt assembly, the ask route, request budgeting, the Anthropic provider
npm run lint
npm run typecheck
npm run build
```

`scripts/dev/mock-anthropic.mjs` is an offline stand-in for the Anthropic API. Run it and set `ANTHROPIC_BASE_URL=http://127.0.0.1:4010` to try the app without a key.

---

## Environment variables

Every variable is documented in [`.env.example`](.env.example).

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Sign-in. `NEXT_PUBLIC_SUPABASE_ANON_KEY` also works, as set by the Vercel Supabase integration |
| `ANTHROPIC_API_KEY` | Claude |
| `GIO_CHAT_MODEL` | Defaults to `claude-opus-5-5` |
| `GIO_CHAT_EFFORT` | How much Gio thinks before answering. Defaults to `high` |
| `GIO_WEB_SEARCH_MAX_USES` | Web searches allowed per answer. Defaults to `5`; `0` turns search off |
| `NEXT_TELEMETRY_DISABLED` | Set to `1` |

---

## Deploy to Vercel

1. Import this repo into Vercel. `vercel.json` pins the framework to Next.js.
2. Add the environment variables above, for Production and Preview.
3. Deploy, open the URL on your phone, and add it to the home screen.

Answers stream. The ask route allows up to 300 seconds; lower `maxDuration` in `src/app/api/ask/route.ts` if your plan's limit is lower.

Live prices come from web search, which must be enabled for your Anthropic organization. If Gio never searches, an admin can turn it on in the Claude Console under organization privacy settings.
