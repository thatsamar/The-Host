# Cinq test environment

A permanent copy of Cinq by text for trying things without touching live users:
its own phone number, its own Vercel project and its own Supabase database.
Nothing in it shares data with production, and production never depends on it.

| Piece | Production | Test |
| --- | --- | --- |
| Phone number | the live toll-free number | a second Twilio number, never published |
| Vercel project | the project Twilio's live webhook points to | `cinq-test` |
| Database | the production Supabase project | the `cinq-test` Supabase project |
| Dashboard | `/ops` on production | `/ops` on `cinq-test`, with its own password |

## Settings on the `cinq-test` Vercel project

Copy these from the production SMS project, except where noted:

- `ANTHROPIC_API_KEY`, `CHAT_MODEL`, `CHAT_EFFORT`, `ROUTER_MODEL`, `WEB_SEARCH_MAX_USES`: the same as production, so the advisors behave exactly as they do live.
- `COMPANION`: the same as the production SMS project.
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`: the same Twilio account.
- `TWILIO_PHONE_NUMBER`: **the test number**, never the live one.
- `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`: **the `cinq-test` database's**, never production's.
- `OPS_PASSWORD`, `SMS_METRICS_KEY`: **new values**, different from production's.

## Database

Run `supabase/setup.sql` once in the `cinq-test` project's SQL editor. It
creates every table, with the same access rules as production.

## Twilio

On the test number, set "A message comes in" to `https://<cinq-test address>/api/sms`
(HTTP POST). Delivery reports need no setting: every text Cinq sends names its
own `/api/sms/status`.

## How it is used

- The `cinq-test` project deploys `main`, so by default it runs exactly what
  production runs. To try a change before it reaches production, its
  production branch can be pointed at that change's branch, then back to `main`.
- Failure drills (a slow or failed answer, a worker that dies mid-answer, a
  delayed photo, a repeated webhook, RETRY) run here, never on the live number.
  The switches that trigger them arrive with Project A's first reliability
  change, and only ever work on this project.
