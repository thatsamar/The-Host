# The frozen benchmark

Production's configuration, preserved so every proposed change is compared
against the same thing.

- **Code:** `main` at commit `6314d99`, Nov 26, 2026. That is the merge of
  PR #71, after #74 (today's date), #75 (Goldie's safety boundary) and #76
  (the owner's chosen influences). Every brief and instruction block the
  advisors received is reproducible from that commit.
- **What reached the model:** each result in `out/results.jsonl` records the
  size and fingerprint of its instructions, so a run can be matched to this
  benchmark.
- **Model settings:** taken from the environment the experiment runs in
  (`CHAT_MODEL`, `CHAT_EFFORT`, `ROUTER_MODEL`), which must match the Vercel
  project that answers texts. Each result records them.
- **Not preserved here:** real exchanges and photos. They stay outside the
  repository, which is public.

- **Since then:** PR #77 (the handover, merged Nov 26 at `65b87bd`) changed
  two lines of the text-only notes every advisor receives. The offer to
  bring in another advisor is now asked in the advisor's own words, and the
  introduction is described as first-time only. Runs on the experiment
  branch now use that production. To compare with the frozen benchmark,
  run from a checkout of `6314d99`.

To reproduce production exactly: check out `6314d99` and run configuration P
(text, research on) or A (text, controlled).
