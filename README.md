# The Host

**The Host knows.** An AI for planning better dinners, nights out, trips, and
gatherings with taste, speed, and a point of view. Ask fast; it asks only what it
needs; you get one plan, one backup, one warning, and an offer to book.

- [Product brief](docs/product-brief.md): the full vision, wedge, MVP, business model, and roadmap
- [Taste doctrine](docs/taste-doctrine.md): the editorial layer, loaded into every conversation
- [Operator review checklist](docs/operator-review.md): the human-in-the-loop gate

## The prototype

The MVP is SMS with AI plus human review. This repo holds the core of that loop,
driven from a terminal so it can be used today and wired to Twilio/WhatsApp later.

```
host/
  prompt.py   system prompt: role + taste doctrine + curated cities
  engine.py   one conversation → Claude, structured reply, refusal fallback
  reply.py    the answer shape (ask | do this / backup / avoid / action) + checks
  venues.py   the taste graph: venue facts + controlled taste tags
  memory.py   per-user taste memory, learned from use
  voice.py    dead-language linter ("hidden gem" costs everyone a fine)
  cli.py      text The Host; --review puts an operator in front of every draft
data/cities/  one JSON per city, curated by hand (see data/cities/README.md)
```

### Run it

```bash
pip install -e '.[dev]'
export ANTHROPIC_API_KEY=...        # or `ant auth login`
host-cli --user amar --review       # operator mode: send / edit / redo each draft
pytest
```

`HOST_MODEL` (default `claude-opus-5`) and `HOST_EFFORT` (default `medium`, for
texting speed) are configurable.

### How it behaves

- **Structured every time.** Replies come back as JSON (`host/reply.py`): either up
  to three questions with tappable choices, or a plan. The operator sees the
  rendered text plus any problems: dead language, too many questions, venues not
  in the curated set, or the model saying the city data doesn't cover the ask.
- **No invented venues.** The Host names only venues in `data/cities/*.json`.
  With no curated venues it describes the *kind* of place and flags the request
  for curation. Mexico City is set up with neighbourhood judgment and an empty
  venue list, ready to fill.
- **Every exchange is logged** to `data/log/YYYY-MM-DD.jsonl` (input, draft,
  problems, verdict, what was sent). Operator edits are the training data.
- **Taste memory** accumulates in `data/users/<id>.json` from signals the model
  notices ("prefers counter seating"). No onboarding survey.

Logs and user profiles are gitignored because they are personal data.

## Next (from the 30-day roadmap)

1. Curate the launch city's venues into `data/cities/`.
2. Put an SMS/WhatsApp webhook in front of `Conversation`, with the review queue as a small web UI.
3. Recruit 50 beta users; track first-plan acceptance, repeat within 30 days, and bookings.
