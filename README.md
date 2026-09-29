# Gio

Courtney and Amar's private interior designer. Gio replaces the custom GPT of the same name and keeps its personality, design philosophy, project memory and reference library. It runs as a private web app that works on a phone.

What it does:

- **Chat.** Streaming chat with Gio from desktop or phone, with a Courtney / Amar / Both speaker toggle and live web search for prices.
- **Projects and rooms.** Each has an editable brief that Gio reads on every turn.
- **Reference library.** Upload PDFs, images, .docx, .txt and .md. Images and image-heavy PDF pages are indexed visually, and Gio searches the library before every reply.
- **Photos in chat.** Attach photos to a message; Gio sees them, and they are added to the library.
- **Memory and decisions.** After each reply Gio proposes memories and decisions for you to approve, edit or dismiss. Preferences are attributed to whoever said them. There's a decision log, a list of pieces under consideration, and command buttons.
- **Settings.** Edit the system prompt, with history and restore. Search and manage memory and decisions, and manage and re-index the library.
- **Import and export.** Export everything as JSON or Markdown, import either format back, and import your ChatGPT history from the old GPT.

---

## Privacy

Gio is private to one household.

- **Where your data lives.** Your own Supabase project stores the database and files. Every table has row-level security, so each row is visible only to its owner account. Storage buckets are private and serve files through signed URLs only.
- **What leaves your Supabase project.**
  - **Anthropic** receives what Gio needs to answer each message: the system prompt, the project brief, approved memories, retrieved references, the conversation and any attached photos. When Gio searches the web for prices, the search query goes through Anthropic's server-side web search tool.
  - **Voyage AI** receives text passages and image descriptions from your library, plus each question you ask, so it can make search embeddings. It never receives images or files.
  - Library images go to Anthropic when they are indexed (to write a description) and when they are retrieved as references for a reply.
  - Nothing else leaves. No other third-party service receives your data.
- **No analytics, no telemetry.** The app has no analytics or tracking scripts and no error-reporting service. The npm scripts turn off Next.js build telemetry. Fonts are bundled at build time, so the browser never contacts Google. Leave Vercel Analytics and Speed Insights switched off. The Supabase CLI, a developer tool you run on your own machine, sends usage telemetry by default; turn it off with `npx supabase telemetry disable`.
- **Hosting.** Vercel serves the app. Requests pass through Vercel, which does not store your content.

---

## How it works

```
Browser ──► Next.js on Vercel ──► Supabase (Postgres + pgvector, Auth, Storage)
                 │
                 ├──► Anthropic: claude-opus-5-5 for Gio, claude-haiku-4-5-20251001 for background work
                 └──► Voyage AI: embeddings for library search
```

Every Gio reply is assembled in one module, `src/lib/gio/prompt.ts`. Each part of the context carries its own label:

1. **System prompt**: Gio's prompt, stored in `settings` and editable
2. **App capabilities**: web search, speaker labels, and the instruction to prefer your own library
3. **Project context**: project, place, brief, current room and its notes
4. **Memories**: approved memories and the decision log
5. **Retrieved references**: library excerpts, with file names and pages. The best image matches come with the original image
6. **Conversation**: prior turns, then the current one

Every user message starts with a `Speaker: Courtney | Amar | Both` line, so Gio always knows who is speaking.

| Path | What's there |
| --- | --- |
| `supabase/migrations/` | Schema, RLS policies, storage buckets |
| `src/lib/gio/` | System prompt, prompt assembly, speakers |
| `src/lib/ai/` | Provider-neutral model interfaces and the Anthropic implementation |
| `src/lib/chat/` | The chat turn pipeline, which has no framework code and is fully tested |
| `src/lib/library/` | Parsing, chunking, visual descriptions, the resumable indexer, retrieval |
| `src/lib/memory/` | Memory extraction, attribution rules, drafts for command buttons, extraction over imported chats, settings search |
| `src/lib/portability/` | Export bundle, readable Markdown format, importer |
| `src/lib/importers/` | ChatGPT `conversations.json` parser and importer |
| `src/lib/db/` | Supabase data access |
| `src/app/api/chat/` | Streaming chat endpoint (newline-delimited JSON) |
| `src/app/api/library/process/` | One indexing step for a library file |
| `src/app/api/import/extract/` | One memory-extraction step over imported conversations |
| `src/app/settings/` | Settings: prompt, memory, decisions, library, import & export |
| `src/components/` | Shell, chat, and UI primitives (shadcn/ui style on Radix) |
| `scripts/bootstrap.ts` | Creates the account and seeds the default project and prompt |
| `tests/` | Vitest suites. All external APIs are mocked |

To swap model providers, implement `ChatProvider`, `BackgroundModel` or `EmbeddingProvider` in `src/lib/ai/types.ts`. Nothing else changes.

### Memory and decisions

- **Proposals, not silent writes.** After each reply, the background model reads what Courtney or Amar just said, with Gio's reply as context, and proposes durable memories and decisions. They appear under **Proposals** in the notebook with **Approve**, **Edit** and **Dismiss**. Only approved items reach Gio. Dismissed ones are kept hidden, so the same thing isn't proposed again.
- **Conservative by construction.** Code, not the model, enforces three rules after extraction (`src/lib/memory/attribution.ts`):
  - Every proposal must quote words that really appear in the user's own message. Anything that rests only on Gio's reply is dropped, so Gio's advice is never saved as your preference.
  - A preference belongs to the person who said it. It becomes shared only when the message was sent as **Both** or says so ("we love…"). It is attributed to the other person only when the message names them ("Courtney wants the linen").
  - Near-duplicates of anything already known, proposed or dismissed are dropped, and each turn is capped at 4 memories and 3 decisions.
- **Memory types:** design, Courtney, Amar and shared preferences; rejected ideas; approved decisions; project constraints; budget philosophy; materials; vendors; dimensions; paint colors; furniture under consideration.
- **Scope.** Memories are either for this project or **household-wide**, meaning they apply in every project.
- **What Gio sees.** Every approved memory is included in each reply, up to 40 of them. Beyond that, Gio gets the most relevant ones (by Voyage embeddings) plus the most recent.
- **Decision log.** Each decision has a status (approved, keep looking, rejected, pending), who decided it, and a link to the message it came from. Change the status from the notebook.
- **Pieces under consideration.** These are saved from a recommendation with the purchase format: dimensions, material/color, vintage vs. new, price (sourced or estimated, with the listing), placement, why it belongs, and invest/save/skip.
- **Command buttons**
  - Under each Gio reply:
    - **Save as decision** and **Keep looking** open a form the background model has already drafted from the message, including the piece's details. You edit it, then save.
    - **Add to memory** drafts one memory from the message the same way.
    - The **⋯** menu has **Compare options** and **Create shopping brief**.
  - Above the message box:
    - **Analyze photo**, **Compare options**, **Create shopping brief** and **Keep looking** set the mode for your next message. Each mode gives Gio a specific instruction; for example, comparisons rank the options and name a winner unless all are wrong.
    - **Add to memory** and **Save as decision** save what you've typed without sending it.
- **"Don't buy anything"** is written into Gio's instructions as a legitimate answer, alongside the purchase format.

### Settings

Open **Settings** from the bottom of the left sidebar.

- **Gio's prompt.** Edit the system prompt. Every save is kept in **History**, and the first save keeps a copy of the original. Open any version to see it, load it into the editor, or **Restore** it. **Reset to default** brings back the prompt Gio started with. Nothing is lost either way.
- **Memory.** Search every memory across projects, filtered by state (approved, proposed or dismissed), type and project, including household-wide. You can approve, dismiss, edit, delete, or restore a dismissed memory.
- **Decisions.** Search and filter the decision log across projects, and edit, approve, dismiss or delete entries.
- **Library.** Upload files to any project and room, see every file's indexing status, and re-index one file or all of them.
- **Import & export.** Export, import, and bring over ChatGPT history (see below).

### Export and import

- **Export** everything as **JSON** (for re-importing) or **Markdown** (readable, and it can also be imported). An export includes projects, rooms, every conversation, memories, decisions, pieces, and Gio's prompt with its history. Library files stay in storage and are listed by name; re-upload them after moving to a new Supabase project.
- **Import** either format into this account. Nothing is overwritten:
  - Items that are already here are skipped, so importing the same file twice is harmless.
  - The export's General Design Brain merges into yours, and rooms with the same name merge.
  - A different system prompt is added to the prompt history, not made live.
- Export and import run in the browser against your own Supabase project, with your login, so large exports aren't limited by server request sizes.

### The reference library

- **Uploads** go from the browser straight into the private `files` bucket, up to 50 MB each. Vercel's request size limit never applies.
- **Text** from PDFs (via PDF.js), .docx (via mammoth), .txt and .md is split into passages of about 800 tokens that overlap by about 100.
- **Images** are handled by the background model (`GIO_BACKGROUND_MODEL`), which writes a detailed visual description of:
  - every uploaded image
  - every PDF page that is mostly picture (less than 200 characters of text, or pictures with less than 1,500)
  - every picture embedded in a .docx

  Descriptions cover materials, palette, furniture and likely designers or periods, light, proportion, atmosphere, architecture and sense of place. They are stored as `visual_description` passages that link back to the image, and blank pages are skipped.
- **Search.** Voyage embeds every passage into pgvector. Before each reply, Gio searches the current project plus the General Design Brain, gets up to 8 passages, and attaches the original image for the top 3 visual matches. Replies show a **From your library** list of what was used.
- **Indexing runs in steps, from the open app.** Each step handles pages for up to about 200 seconds and saves its progress, so large image-heavy PDFs finish over several steps. Closing the app pauses indexing, and it picks up where it left off next time the app is open. The sidebar shows each file's status and page progress. Failed files have a Retry option.
- **Photos attached in chat** are resized in the browser and sent to Gio with the message. They are saved as image assets under the project and room. After the reply, they are described and added to the library, so later questions can find them.
- **Cost.** Each described image or picture page costs one background-model call when it is indexed.

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

What the tests cover (all external APIs are mocked; parsing tests use real generated PDFs, .docx files and images):

| Area | Suite |
| --- | --- |
| Prompt assembly: block order, labels, modes, purchase format | `tests/prompt.test.ts` |
| Retrieval, chat-photo indexing | `tests/retrieval.test.ts`, `tests/voyage.test.ts` |
| File upload types and parsing (PDF, .docx, images, chunking) | `tests/parsing.test.ts` |
| Visual indexing and the resumable indexer | `tests/indexer.test.ts` |
| Memory extraction and speaker attribution | `tests/memory-extraction.test.ts`, `tests/chat-service.test.ts` |
| Chat API: auth, validation, attachment checks, streaming | `tests/chat-route.test.ts`, `tests/chat-service.test.ts`, `tests/anthropic-provider.test.ts` |
| Export, Markdown round trip, import | `tests/portability.test.ts` |
| ChatGPT importer, extraction over imported chats, prompt history | `tests/chatgpt-import.test.ts` |
| Settings search | `tests/search.test.ts` |

`npm run check:migrations` separately checks the SQL. It covers row-level security on every table, isolation of storage, `match_chunks` and `match_memories` between accounts, and the constraints.

`scripts/dev/mock-anthropic.mjs` is an offline stand-in for both the Anthropic and Voyage APIs, so you can click through the UI without spending tokens. Start it with `node scripts/dev/mock-anthropic.mjs`, then run:

```bash
ANTHROPIC_BASE_URL=http://127.0.0.1:4010 VOYAGE_BASE_URL=http://127.0.0.1:4010/v1 VOYAGE_API_KEY=mock npm run dev
```

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
| `VOYAGE_API_KEY` | app + Vercel | Library indexing and search. Without it, uploads wait in the queue and Gio answers without references |
| `EMBEDDING_MODEL`, `EMBEDDING_DIMENSION` | app + Vercel | Default `voyage-4` at 1024. The dimension must match the migration |
| `RETRIEVAL_TOP_K`, `RETRIEVAL_MIN_SIMILARITY`, `RETRIEVAL_MAX_IMAGES` | app + Vercel | Optional retrieval tuning. Defaults: 8, 0.25 and 3 |
| `NEXT_TELEMETRY_DISABLED` | Vercel | Set to `1` |

---

## Deploy to Vercel

1. Push this repo to GitHub, then create a Vercel project from it. Vercel detects Next.js; keep the default build settings.
2. Add the environment variables from the "app + Vercel" rows above, plus `NEXT_TELEMETRY_DISABLED=1`. Don't add `SUPABASE_SECRET_KEY`.
3. Deploy. Open the URL on your phone and add it to the home screen.
4. Optional: in Supabase → Authentication → URL Configuration, set **Site URL** to your Vercel URL.

Chat responses stream. The chat route and the library indexing route each allow up to 300 seconds. If your Vercel plan has a lower limit:

- lower `maxDuration` in `src/app/api/chat/route.ts`, `src/app/api/library/process/route.ts` and `src/app/api/import/extract/route.ts`
- keep `STEP_BUDGET_MS` in the indexing and extraction routes about 60 seconds below their `maxDuration`

PDF page rendering uses a native canvas package (`@napi-rs/canvas`). It ships prebuilt for Vercel's Linux runtime, and `next.config.ts` makes sure its files are deployed.

Live prices come from web search, which must be enabled for your Anthropic organization. If Gio never searches, an admin can turn it on in the Claude Console under organization privacy settings.

---

## Using Gio

- **Projects** are homes or places. The **General Design Brain** holds household-wide thinking. Switch projects from the top of the left sidebar.
- **Rooms** live inside a project. Choosing one scopes new conversations to that room and tells Gio which room you're in.
- **The brief**, in the right-hand notebook, is the most useful thing to fill in. Gio reads it on every turn. Include the architecture, light, climate, who visits and any constraints.
- **The speaker toggle** (Courtney / Amar / Both) sits beside the message box. It remembers the last choice, and each message in the history shows who sent it. Gio keeps Courtney's and Amar's preferences separate.
- **Stop** ends a reply mid-stream. Whatever Gio had written so far is kept.
- **The library** is in the left sidebar. Upload with the button or drag files onto it. Files go into the current room when one is selected, otherwise into the project as a whole. Put household-wide references (books, hotels, designers) in the **General Design Brain**, which is searched from every project.
- **Photos** are attached with the picture button beside the speaker toggle, up to 6 per message. On a phone it offers the camera.
- On a phone, the ☰ button opens projects, rooms and conversations, and the book icon opens the notebook.
- **Settings** is at the bottom of the left sidebar.

---

## Example prompts

Use these to check that Gio behaves like Gio.

| # | Prompt | What it checks |
| --- | --- | --- |
| 1 | "Analyze this living room photo." (attach one, or use **Analyze photo**) | Reads the whole space and leads with the highest-leverage move |
| 2 | "Should we buy this chair?" (with a photo or link) | Purchase judgement, including "don't buy" |
| 3 | "Compare these three sofas." (use **Compare options**) | Ranks the options and names a winner, unless all are wrong |
| 4 | "What is the highest-leverage move in this room?" | Subtraction, repositioning and light before buying |
| 5 | "Create a lighting plan for the dining room." | THE CALL / WHY / THE MOVE format, scoped to the room |
| 6 | "What have we learned about Courtney and Amar's taste?" | Memory recall (approve a few proposals first) |
| 7 | "Amar wants the green velvet, Courtney wants the linen. Where do we land?" | Speaker attribution and synthesis; proposals go to the right person |
| 8 | "Find us a vintage lounge chair under $2,000 for the reading corner." | Web search, sourced vs. estimated prices, the purchase format |

For #7, send one message as **Amar** ("I want the green velvet"), one as **Courtney** ("I want the linen"), then ask the question as **Both**. The notebook should propose an Amar preference and a Courtney preference, each attributed correctly.

---

## Migrating from the old GPT

1. **System prompt.** Gio's prompt is already stored verbatim; `npm run bootstrap` seeds it. If you changed the GPT's instructions over time, paste the latest into **Settings → Gio's prompt** and save. The original stays in the history.
2. **Reference files.** Upload the GPT's knowledge files in **Settings → Library**. Put them in the General Design Brain, or in a specific project if they're about one home. Put each home's key facts in its project brief.
3. **Conversations.**
   1. In ChatGPT, go to **Settings → Data controls → Export data**. ChatGPT emails you a zip; unzip it.
   2. In Gio, open **Settings → Import & export → Import from ChatGPT** and choose `conversations.json`. The file is read in your browser, and only the conversations you select are saved.
   3. Conversations with a custom GPT are grouped by its id. The largest group, most likely the old Gio, is preselected. Search and adjust the selection.
   4. Choose the project to import into and who was typing (Courtney, Amar or Both; ChatGPT doesn't record it). Leave **Propose memories from these conversations** on.
   5. Import. Each conversation becomes a chat, in order, with its original dates. Importing again skips conversations already brought over.
4. **Review the proposals.** Gio then reads the imported conversations, several exchanges at a time, and proposes memories and decisions under the same rules as live chat: only your own quoted words count, attributed to the speaker you chose. This runs while the app is open and resumes if you close it; the Import & export tab shows progress.

   Review the proposals in the notebook, or all at once in **Settings → Memory** with the filter set to **Proposed**. Nothing is used until you approve it.
