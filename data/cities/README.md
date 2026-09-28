# City taste graph

One JSON file per city. Copy `_template.json` (files starting with `_` are not
loaded). Venues are added by hand by someone who has been there — The Host only
names venues that are in these files.

- `taste_tags` must come from `TASTE_TAGS` in `host/venues.py`. Add new tags there
  deliberately, not ad hoc.
- `host_note` is one line in The Host's voice: why, when, where to sit.
- `last_verified` is the date a human last confirmed it's open and still good.
- "Instagram casualty" and "looks good, feels empty" are as important as the
  good tags. The Host must know what to avoid.
- `category`: restaurant, bar, cafe, hotel, gallery, walk, …
- `noise`: quiet, conversational, lively, or loud. `price`: 1–4 (0 = unknown).
- `booking`: a URL, `walk-in`, or `call`.
