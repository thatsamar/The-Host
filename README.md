# Gio

Courtney and Amar's private interior designer. Gio replaces the custom GPT of the same name and keeps its personality, design philosophy, project memory and reference library. It runs as a private web app that works on a phone.

> **Build status: Phase 1 of 4 (foundation and chat).**
> Working now: password login, projects and rooms, streaming chat with Gio, the speaker toggle, live web search for prices, the editable project brief, and the three-panel layout on desktop and phone.
> Not built yet: file uploads and the reference library (Phase 2), memory proposals, decisions and command buttons (Phase 3), and the settings page, export/import and ChatGPT importer (Phase 4). The memory and decision tables already exist, and Gio reads approved rows from them on every turn. Nothing in the app writes to them yet.

---

## Privacy

Gio is private to one household.

- **Where your data lives.** Your own Supabase project stores the database and files. Every table has row-level security, so each row is visible only to its owner account. Storage buckets are private and serve files through signed URLs only.
- **What leaves your Supabase project.**
  - **Anthropic** receives what Gio needs to answer each message: the system prompt, the project brief, approved memories, retrieved references, the conversation and any attached photos. When Gio searches the web for prices, the search query goes through Anthropic's server-side web search tool.
  - **Voyage AI** (from Phase 2) receives text chunks and image descriptions from your library so it can make search embeddings. It does not receive chats.
  - Nothing else leaves. No other third-party service receives your data.
- **No analytics, no telemetry.** The app has no analytics or tracking scripts and no error-reporting service. The npm scripts turn off Next.js build telemetry. Fonts are bundled at build time, so the browser never contacts Google. Leave Vercel Analytics and Speed Insights switched off.
- **Hosting.** Vercel serves the app. Requests pass through Vercel, which does not store your content.

---

## How it works

```
Browser ──► Next.js on Vercel ──► Supabase (Postgres + pgvector, Auth, Storage)
                 │
                 ├──► Anthropic: claude-opus-5-5 for Gio, claude-haiku-4-5-20251001 for background work
                 └──► Voyage AI: embeddings (Phase 2)
```

Every Gio reply is assembled in one module, `src/lib/gio/prompt.ts`. Each part of the context carries its own label:

1. **System prompt**: Gio's prompt, stored in `settings` and editable
2. **App capabilities**: web search, speaker labels, and the instruction to prefer your own library
3. **Project context**: project, place, brief, current room and its notes
4. **Memories**: approved memories and the decision log
5. **Retrieved references**: library excerpts, with file names (Phase 2)
6. **Conversation**: prior turns, then the current one

Every user message starts with a `Speaker: Courtney | Amar | Both` line, so Gio always knows who is speaking.

| Path | What's there |
| --- | --- |
| `supabase/migrations/` | Schema, RLS policies, storage buckets |
| `src/lib/gio/` | System prompt, prompt assembly, speakers |
| `src/lib/ai/` | Provider-neutral model interfaces and the Anthropic implementation |
| `src/lib/chat/` | The chat turn pipeline, which has no framework code and is fully tested |
| `src/lib/db/` | Supabase data access |
| `src/app/api/chat/` | Streaming chat endpoint (newline-delimited JSON) |
| `src/components/` | Shell, chat, and UI primitives (shadcn/ui style on Radix) |
| `scripts/bootstrap.ts` | Creates the account and seeds the default project and prompt |
| `tests/` | Vitest suites. All external APIs are mocked |

To swap model providers, implement `ChatProvider` and `BackgroundModel` in `src/lib/ai/types.ts`. Nothing else changes.

---

## Setup

You need Node 20.9+ and npm. For local Supabase you also need Docker.

```bash
npm install
cp .env.example .env.local   # then fill it in
```

### Option A: hosted Supabase (what you'll deploy with)

1. **Create the project.** At [supabase.com](https://supabase.com) → New project. Pick a region near you and save the database password.
2. **Copy the keys.** Project Settings → API Keys. Copy the Project URL, the publishable key and the secret key into `.env.local`.
3. **Lock sign-ups.** Authentication → Sign In / Providers:
   - Turn off **Allow new users to sign up**.
   - Keep the **Email** provider enabled.
   - Turn off **Confirm email**. The bootstrap script confirms the one account itself.
4. **Run the migrations.**
   ```bash
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   ```
   This creates every table, turns on RLS, installs pgvector and creates the private `files` and `images` buckets.
5. **Create the household account.**
   ```bash
   npm run bootstrap -- --email you@example.com --password 'a long passphrase'
   ```
   This creates the single login, the **General Design Brain** project and Gio's verbatim system prompt in `settings`. You can run it again safely: it never overwrites a prompt you've edited.

### Option B: fully local

```bash
npx supabase start        # prints the local URL and keys; copy them into .env.local
npm run bootstrap         # reads GIO_ACCOUNT_EMAIL / GIO_ACCOUNT_PASSWORD from .env.local
```

`supabase/config.toml` already disables sign-ups.

### Run it

```bash
npm run dev               # http://localhost:3000
```

Sign in with the household email and password.

### Check it

```bash
npm test                  # Vitest, external APIs mocked
npm run lint
npm run typecheck
npm run check:migrations  # applies migrations to a throwaway local Postgres and checks RLS (needs postgresql-16 + pgvector)
```

`scripts/dev/mock-anthropic.mjs` is an offline stand-in for the Anthropic API, so you can click through the UI without spending tokens. Start it with `node scripts/dev/mock-anthropic.mjs`, then run `ANTHROPIC_BASE_URL=http://127.0.0.1:4010 npm run dev`.

---

## Environment variables

Every variable is documented in [`.env.example`](.env.example). In short:

| Variable | Where | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | app + Vercel | Supabase connection. RLS protects the data |
| `SUPABASE_SECRET_KEY` | your machine only | `npm run bootstrap`. Never deploy it |
| `GIO_ACCOUNT_EMAIL`, `GIO_ACCOUNT_PASSWORD` | your machine only | Optional bootstrap defaults |
| `ANTHROPIC_API_KEY` | app + Vercel | Claude |
| `GIO_CHAT_MODEL` | app + Vercel | Defaults to `claude-opus-5-5` |
| `GIO_BACKGROUND_MODEL` | app + Vercel | Defaults to `claude-haiku-4-5-20251001` |
| `GIO_CHAT_EFFORT` | app + Vercel | How much Gio thinks before answering. Defaults to `high` |
| `GIO_WEB_SEARCH_MAX_USES` | app + Vercel | Web searches allowed per reply. Defaults to `5`; `0` turns search off |
| `VOYAGE_API_KEY`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSION` | app + Vercel | Embeddings (Phase 2). The dimension must match the migration (1024) |
| `NEXT_TELEMETRY_DISABLED` | Vercel | Set to `1` |

---

## Deploy to Vercel

1. Push this repo to GitHub, then create a Vercel project from it. Vercel detects Next.js; keep the default build settings.
2. Add the environment variables from the "app + Vercel" rows above, plus `NEXT_TELEMETRY_DISABLED=1`. Don't add `SUPABASE_SECRET_KEY`.
3. Deploy. Open the URL on your phone and add it to the home screen.
4. Optional: in Supabase → Authentication → URL Configuration, set **Site URL** to your Vercel URL.

Chat responses stream. The chat route allows up to 300 seconds, which leaves room for long answers that include web searches. If your Vercel plan has a lower limit, lower `maxDuration` in `src/app/api/chat/route.ts`.

Live prices come from web search, which must be enabled for your Anthropic organization. If Gio never searches, an admin can turn it on in the Claude Console under organization privacy settings.

---

## Using Gio

- **Projects** are homes or places. The **General Design Brain** holds household-wide thinking. Switch projects from the top of the left sidebar.
- **Rooms** live inside a project. Choosing one scopes new conversations to that room and tells Gio which room you're in.
- **The brief**, in the right-hand notebook, is the most useful thing to fill in. Gio reads it on every turn. Include the architecture, light, climate, who visits and any constraints.
- **The speaker toggle** (Courtney / Amar / Both) sits beside the message box. It remembers the last choice, and each message in the history shows who sent it. Gio keeps Courtney's and Amar's preferences separate.
- **Stop** ends a reply mid-stream. Whatever Gio had written so far is kept.
- On a phone, the ☰ button opens projects, rooms and conversations, and the book icon opens the notebook.

---

## Example prompts

Use these to check each phase. The column says what each one exercises and when it becomes fully meaningful.

| # | Prompt | Tests | Phase |
| --- | --- | --- | --- |
| 1 | "Analyze this living room photo." | Photo analysis (needs attachments) | 2 |
| 2 | "Should we buy this chair?" | Purchase judgement, and a willingness to say don't buy | 1 (text), 2 (with photo) |
| 3 | "Compare these three sofas." | Ranking and naming a winner | 1, 3 (comparison mode) |
| 4 | "What is the highest-leverage move in this room?" | Subtraction and light before buying | 1 |
| 5 | "Create a lighting plan for the dining room." | THE CALL / WHY / THE MOVE format, room scoping | 1 |
| 6 | "What have we learned about Courtney and Amar's taste?" | Memory recall | 3 |
| 7 | "Amar wants the green velvet, Courtney wants the linen. Where do we land?" | Speaker attribution and synthesis | 1 |
| 8 | "Find us a vintage lounge chair under $2,000 for the reading corner." | Web search, sourced vs. estimated prices, purchase format | 1 |

For #7, send one message as **Amar** ("I want the green velvet"), one as **Courtney** ("I want the linen"), then ask the question as **Both**.

---

## Migrating from the old GPT

The ChatGPT importer arrives in Phase 4. It will read ChatGPT's `conversations.json`, let you pick Gio's conversations, import them into a project, and send the extracted memories to the proposal queue for your review.

Until then:

1. **System prompt.** Already seeded verbatim. You can edit it in the app in Phase 4.
2. **Project knowledge.** Paste each home's key facts into its project brief. Phase 2 adds the upload for the GPT's reference files (PDFs, images, docs).
3. **Your ChatGPT export.** Request it now (ChatGPT → Settings → Data controls → Export data) so it's ready for the Phase 4 importer.
