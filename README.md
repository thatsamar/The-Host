# Gio, Tony and Martini

Three private-beta companions on one engine. Each is one page: add up to 10 photos, ask a question, or both, and get an answer with a point of view.

- **Gio** (design): *See with a designer's eye.* The custom GPT's design point of view, addressed to whoever is asking.
- **Tony** (travel): *Travel like it matters.* A travel companion for going beneath the surface of a place, in Amar Lalvani's voice and taste.
- **Martini** (style): *Dress with confidence.* A personal style advisor for men's, women's and mixed wardrobes: outfit checks, shopping, packing, dress codes, invest / save / skip.

The code is shared. Each companion is its own Vercel project with its own address, name, icon and link preview, chosen by one setting: `COMPANION=gio`, `tony` or `martini`.

- **No saved conversations.** A visit is one conversation. Follow-up questions work while the page is open; **New** or a reload starts fresh.
- **Nothing stored.** Photos are shrunk in the browser and sent with the question. The app has no database tables of its own and keeps no files.
- **Live checks.** Gio searches the web for real listings and prices; Tony checks that places are still open and still worth it.
- **Invitation only.** Each tester gets a login; strangers (and their questions on your Anthropic bill) stay out.

## Access

**Open by default.** Anyone with the address can use the app, with no sign-in. The start screen has a **Share** button that sends the address by Messages, Mail or WhatsApp. Each visitor can ask 40 questions an hour (`QUESTIONS_PER_HOUR`), and every question goes on your Anthropic account, so set a monthly spend limit at platform.claude.com → Settings → Limits. The pages are marked not-for-search-engines, but anyone you send the link to can forward it.

**Sign-in, if you want it back:** set `REQUIRE_SIGN_IN=true` on a project and redeploy. Then:
- **By hand.** Supabase → **Authentication → Users → Add user**, tick **Auto Confirm User**, and send them their login.
- **By link.** Also set `INVITE_CODE` to something long and hard to guess. The start screen's button becomes **Invite**, sharing `https://<address>/join/<INVITE_CODE>`. Whoever opens it enters an email and is in, no password. Ban people in Supabase to remove them; change `INVITE_CODE` to retire the link.
- **Home Screen.** On iPhone the Home Screen app keeps its own sign-in, apart from Safari: people who joined by link tap **Joined with an invitation?** on the sign-in page and paste the link and their email.

On a phone, **Share → Add to Home Screen** installs the app with its own icon, opening full screen.

## When something goes wrong

Testers see plain messages ("Tony isn't available right now", "Gio is busy right now"). The reason (a rejected key, no credit, a missing setting) goes to the server log: Vercel → your project → **Logs**, filtered to errors.

---

## Privacy

- **What leaves the browser.** Each question goes to the app on Vercel with the visit's conversation so far: the text, photos at 1280px for the new question, and smaller copies of earlier photos. The app passes it to **Anthropic** and streams the answer back. When a companion searches the web, the query goes through Anthropic's server-side web search tool.
- **What's kept.** Nothing, by the app. Supabase is used only for sign-in. Vercel serves the app and doesn't store the content.
- **No analytics, no telemetry.** No tracking scripts or error-reporting service. The npm scripts turn off Next.js build telemetry; set `NEXT_TELEMETRY_DISABLED=1` on Vercel too. Fonts are bundled at build time, so the browser never contacts Google. Leave Vercel Analytics and Speed Insights off.

---

## How it works

```
Browser ──► Next.js on Vercel ──► Anthropic (claude-opus-5-5, web search)
                 │
                 └──► Supabase Auth (sign-in only)
```

- `src/components/studio.tsx` is the whole interface: the start screen, the conversation and the composer (camera button, optional text, send). A failed answer puts the question and photos back to resend; answers can be copied.
- `src/lib/companions/` holds each companion: its system prompt (`gio-prompt.ts`, `tony-prompt.ts`, `martini-prompt.ts`), its capabilities, and the words the page shows (name, tagline, placeholder, status lines). `currentCompanion()` picks one from `COMPANION`.
- `src/app/icon.tsx`, `apple-icon.tsx`, `opengraph-image.tsx` and `manifest.ts` give each companion its home-screen icon (Gio black, Tony rust, Martini olive) and link preview, drawn at build time with the fonts in `assets/fonts` (SIL Open Font License).
- `src/lib/ask/photos.ts` shrinks photos in the browser. `src/lib/ask/budget.ts` keeps each request under Vercel's 4.5 MB body limit by dropping the oldest photos from long visits first.
- `src/app/api/ask/route.ts` checks the sign-in, validates the request and streams the answer as NDJSON.
- `src/lib/ask/prompt.ts` assembles what the model sees, in order: the companion's system prompt, then an **app capabilities** block (what the app does, that it keeps nothing, that it doesn't know who's asking), then the conversation.
- `src/lib/ai/anthropic.ts` streams from Claude with web search, resumes paused search turns, and falls back server-side when a request is refused.

To change how a companion thinks, edit its `src/lib/companions/<name>-prompt.ts` and redeploy both projects' latest deployment (a merge does this automatically).

---

## Setup

Needs Node 20+.

1. `npm install`
2. Create a Supabase project (or run `npx supabase start` locally, which needs Docker).
3. In Supabase → **Authentication → Users → Add user**, create the one login you'll share. Tick **Auto Confirm User**.
4. In **Authentication → Sign In / Providers**, turn off **Allow new users to sign up**.
5. `cp .env.example .env.local` and fill in the Supabase URL and publishable key and your Anthropic key. Set `COMPANION=tony` or `martini` to run another companion.
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
| `COMPANION` | `gio` (default), `tony` or `martini`. Read at build time: redeploy after changing it |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Sign-in, when it's on. `NEXT_PUBLIC_SUPABASE_ANON_KEY` also works, as set by the Vercel Supabase integration |
| `ANTHROPIC_API_KEY` | Claude |
| `CHAT_MODEL` | Defaults to `claude-opus-5-5` (`GIO_CHAT_MODEL` also works) |
| `CHAT_EFFORT` | How much the companion thinks before answering. Defaults to `high` |
| `WEB_SEARCH_MAX_USES` | Web searches allowed per answer. Defaults to Gio 5, Tony 8; `0` turns search off |
| `REQUIRE_SIGN_IN` | Optional. `true` requires sign-in; unset, the app is open to anyone with the address |
| `QUESTIONS_PER_HOUR` | Optional. Per-visitor cap, default 40; `0` turns it off |
| `INVITE_CODE` | Optional, with sign-in on. Turns on link invitations (`/join/<code>`) and the Invite button |
| `SUPABASE_SERVICE_ROLE_KEY` | Needed for link invitations; server-side only. Set by the Vercel Supabase integration (`SUPABASE_SECRET_KEY` also works) |
| `NEXT_TELEMETRY_DISABLED` | Set to `1` |

---

## Deploy to Vercel

1. Import this repo into Vercel. `vercel.json` pins the framework to Next.js.
2. Add the environment variables above, for Production and Preview.
3. Deploy, open the URL on your phone, and add it to the home screen.

**A second companion** is a second Vercel project from the same repo: **Add New → Project → import The-Host again**, name it (say, `tony`), and add the same variables plus `COMPANION=tony`. Connect the same Supabase project (Storage → Connect) so testers keep one login. Every merge to `main` redeploys both.

Answers stream. The ask route allows up to 300 seconds; lower `maxDuration` in `src/app/api/ask/route.ts` if your plan's limit is lower.

Live prices come from web search, which must be enabled for your Anthropic organization. If a companion never searches, an admin can turn it on in the Claude Console under organization privacy settings.
