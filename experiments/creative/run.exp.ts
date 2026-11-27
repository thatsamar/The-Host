/**
 * The creative comparison (README.md). Runs only with RUN_CREATIVE_EXPERIMENT=1:
 *
 *   RUN_CREATIVE_EXPERIMENT=1 npx vitest run --config experiments/creative/vitest.config.mts
 *
 * PILOT=1 runs the small first comparison (PILOT_CASE_IDS, every configuration, one
 * run) and writes pilot.json: lengths, overlap between configurations, cost per call
 * and what the full run would cost, to confirm the experiment draws real distinctions
 * before the budget is committed. DRY_RUN=1 makes no model calls at all.
 * REPS (default 2), BUDGET_USD (default 30), CASES and CONFIGS (comma lists) narrow it.
 * STUDY=alden runs Alden's case study (ALDEN_STUDY_IDS). EXTRACT=1, after a run,
 * restates every answer's recommendation and reasons in neutral words (one
 * low-effort call each, within the budget) for the substance page.
 * Results go to experiments/creative/out/ (never committed). Nothing touches production:
 * no database, no Twilio, no deployment; only model calls made from here.
 */

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { it } from "vitest";
import { toChatTurns, type AskTurn } from "@/lib/ask/prompt";
import { COMPANIONS } from "@/lib/companions";
import { callCost } from "@/lib/ops/rates";
import { readSuggestion, offerText } from "@/lib/sms/handoff";
import { speakerLabel, toSmsText } from "@/lib/sms/handler";
import { SMS_ADVISORS, type SmsAdvisorId } from "@/lib/sms/navigation";
import { answerBudget, answerFits, condensePrompt, roomForAnswer, shortAnswerText } from "@/lib/sms/short";
import type { ChatProvider, ChatRequest } from "@/lib/ai/types";
import { ALDEN_STUDY_IDS, loadCases, loadPhoto, PILOT_CASE_IDS, type Case, type CaseTurn } from "./cases";
import { configsFor, instructionSize, type Config } from "./configs";
import { render } from "./render";

const OUT = fileURLToPath(new URL("./out/", import.meta.url));
const RESULTS = `${OUT}results.jsonl`;
const EXTRACTS = `${OUT}extracts.jsonl`;

/** The neutral restatement: the judgment without the writing, for the substance page. */
export const EXTRACT_PROMPT =
  "Restate the advice below as plain, neutral notes, in the same words for any writer: what is recommended (each thing, with any price given), the deciding reasons, what is rejected or advised against and why, and any question asked. Keep every specific name, number and condition exactly. Remove all style, voice, humor, warmth and flourish; add nothing, judge nothing, and keep it as short as the content allows. Plain lines starting with \"- \", no headings.";
/** Assumed list price per web search, for the budget only (not in the rates table). */
const SEARCH_USD = 0.01;

export interface RunResult {
  key: string;
  caseId: string;
  advisor: string;
  kind: string;
  source: string;
  config: string;
  family: string;
  rep: number;
  at: string;
  model: string | null;
  routerModel: string | null;
  effort: string;
  webSearch: boolean;
  instructionChars: number;
  promptSha: string;
  ms: number;
  usage: Record<string, unknown>;
  searches: number;
  costUsd: number;
  /** The advisor's own answer, as plain text, before any rewrite or trim (configuration B for A). */
  own: string;
  /** What the person would receive. */
  delivered: string;
  rewritten: boolean;
  trimmed: boolean;
  /** For a challenge: the first exchange, before the follow-up (the answers above are the second). */
  first?: { own: string; delivered: string; rewritten: boolean };
  followUp?: { text: string; expect: string };
  /** For a sequence: every earlier exchange, in order (the answers above are the last). */
  thread?: { user: string; own: string; delivered: string; later?: boolean }[];
  error: string | null;
}

function withoutLabel(answer: string, advisorId: SmsAdvisorId): string {
  const name = SMS_ADVISORS.find((a) => a.id === advisorId)!.name;
  return answer.replace(new RegExp(String.raw`^\s*[*_]*${name}[*_]*\s*:[*_]*\s*`, "i"), "");
}

async function complete(provider: ChatProvider, request: ChatRequest): Promise<{ text: string; usage: Record<string, unknown>; model: string | null; searches: number }> {
  let text = "";
  let usage: Record<string, unknown> = {};
  let model: string | null = null;
  let searches = 0;
  for await (const event of provider.streamChat(request)) {
    if (event.type === "text") text += event.text;
    else if (event.type === "done") {
      usage = event.usage;
      model = event.model;
      searches = event.webSearches.length;
    }
  }
  return { text, usage, model, searches };
}

const costOf = (model: string | null, usage: Record<string, unknown>, searches: number) => {
  const n = (k: string) => (typeof usage[k] === "number" ? (usage[k] as number) : 0);
  return (callCost({ model: model ?? undefined, input: n("input_tokens"), output: n("output_tokens"), cache_read: n("cache_read_input_tokens"), cache_write: n("cache_creation_input_tokens") }) ?? 0) + searches * SEARCH_USD;
};

const toAsk = (t: CaseTurn): AskTurn => ({ role: t.role, text: t.text, images: t.photos?.map(loadPhoto) });

/** One answer through the configuration: the advisor's own words, and what the person would receive. */
async function answer(
  c: Case,
  config: Config,
  conversation: AskTurn[],
  now: Date,
  providers: { chat: (id: SmsAdvisorId) => ChatProvider; router: () => ChatProvider },
) {
  const id = c.advisor as SmsAdvisorId;
  const companion = COMPANIONS[id];
  const system = config.system(c.advisor, now);
  const request: ChatRequest = { system, messages: toChatTurns(conversation, companion.photosOnly), webSearch: config.webSearch };
  const first = await complete(providers.chat(id), request);
  let cost = costOf(first.model, first.usage, first.searches);
  const { text, suggest } = readSuggestion(first.text, id);
  const own = toSmsText(withoutLabel(text, id));
  let delivered = own;
  let rewritten = false;
  let trimmed = false;
  let routerModel: string | null = null;
  if (config.textPipeline) {
    // Production's text pipeline, as handler.ts runs it: label, the 450-character check, the rewrite, the trim.
    const label = speakerLabel(id);
    const offer = suggest ? offerText(suggest) : null;
    let plain = own;
    if (!answerFits({ label, intro: null, answer: plain, offer })) {
      const room = roomForAnswer(answerBudget(label, null), offer);
      const second = await complete(providers.router(), {
        system: [{ label: "condense", title: "CONDENSE", body: condensePrompt(companion.name, room) }],
        messages: [{ role: "user", content: [{ type: "text", text: plain }] }],
        webSearch: false,
      });
      routerModel = second.model;
      cost += costOf(second.model, second.usage, 0);
      const candidate = toSmsText(withoutLabel(readSuggestion(second.text, id).text, id));
      if (candidate.trim() && answerFits({ label, intro: null, answer: candidate, offer })) {
        plain = candidate;
        rewritten = true;
      }
    }
    const reply = shortAnswerText({ label, intro: null, answer: plain, offer });
    trimmed = reply.sent !== plain.trim();
    delivered = reply.text;
  }
  return { own, delivered, rewritten, trimmed, cost, model: first.model, routerModel, usage: first.usage, searches: first.searches, system };
}

async function runOne(c: Case, config: Config, rep: number, now: Date, providers: { chat: (id: SmsAdvisorId) => ChatProvider; router: () => ChatProvider }): Promise<RunResult> {
  const system = config.system(c.advisor, now);
  const base = {
    key: `${c.id}|${config.id}|${rep}`,
    caseId: c.id,
    advisor: c.advisor,
    kind: c.kind,
    source: c.source,
    config: config.id,
    family: config.family,
    rep,
    at: now.toISOString(),
    effort: process.env.CHAT_EFFORT || "high (default)",
    webSearch: config.webSearch,
    instructionChars: instructionSize(config, c.advisor, now),
    promptSha: createHash("sha256").update(system.map((b) => b.body).join("\n\n")).digest("hex").slice(0, 12),
  };
  const began = Date.now();
  try {
    // The same earlier messages and context for every configuration, the general-purpose one included; G0 is the ordinary assistant without them.
    const asked = c.material ? `${c.question}\n\n${c.material}` : c.question;
    let conversation: AskTurn[] = [...(config.withoutHistory ? [] : (c.history ?? []).map(toAsk)), { role: "user", text: asked, images: c.photos?.map(loadPhoto) }];
    let result = await answer(c, config, conversation, now, providers);
    let cost = result.cost;
    let first: RunResult["first"];
    // Each later turn sees the earlier answers as the person did: production keeps the text as sent.
    const seen = (r: typeof result) => (config.textPipeline ? r.delivered.replace(new RegExp(`^${speakerLabel(c.advisor as SmsAdvisorId)}`), "") : r.own);
    if (c.followUp) {
      first = { own: result.own, delivered: result.delivered, rewritten: result.rewritten };
      result = await answer(c, config, [...conversation, { role: "assistant", text: seen(result) }, { role: "user", text: c.followUp.text }], now, providers);
      cost += result.cost;
    }
    const thread: NonNullable<RunResult["thread"]> = [];
    let lastAsked = c.question;
    for (const next of c.followUps ?? []) {
      thread.push({ user: lastAsked, own: result.own, delivered: result.delivered, later: thread.length ? (c.followUps ?? [])[thread.length - 1]?.later : undefined });
      // A new conversation on another day: the advisor keeps what came before (as Cinq would within its window); the ordinary assistant starts fresh.
      conversation = next.later && config.withoutHistory ? [{ role: "user", text: next.text }] : [...conversation, { role: "assistant", text: seen(result) }, { role: "user", text: next.text }];
      result = await answer(c, config, conversation, now, providers);
      cost += result.cost;
      lastAsked = next.text;
    }
    return {
      ...base,
      model: result.model,
      routerModel: result.routerModel,
      ms: Date.now() - began,
      usage: result.usage,
      searches: result.searches,
      costUsd: cost,
      own: result.own,
      delivered: result.delivered,
      rewritten: result.rewritten,
      trimmed: result.trimmed,
      ...(first ? { first, followUp: c.followUp } : {}),
      ...(thread.length ? { thread } : {}),
      error: null,
    };
  } catch (err) {
    return { ...base, model: null, routerModel: null, ms: Date.now() - began, usage: {}, searches: 0, costUsd: 0, own: "", delivered: "", rewritten: false, trimmed: false, error: err instanceof Error ? err.name : "error" };
  }
}

/** Word overlap between two answers (0 = nothing shared, 1 = the same words). */
function overlap(a: string, b: string): number {
  const words = (s: string) => new Set(s.toLowerCase().match(/[a-z']{3,}/g) ?? []);
  const x = words(a);
  const y = words(b);
  const shared = [...x].filter((w) => y.has(w)).length;
  return x.size + y.size ? Number(((2 * shared) / (x.size + y.size)).toFixed(2)) : 1;
}

const list = (v: string | undefined) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : null);

it.skipIf(!process.env.RUN_CREATIVE_EXPERIMENT)("runs the creative comparison", async () => {
  mkdirSync(OUT, { recursive: true });
  const pilot = !!process.env.PILOT;
  const reps = pilot ? 1 : Number(process.env.REPS) || 2;
  const budget = Number(process.env.BUDGET_USD) || 30;
  const caseIds = list(process.env.CASES);
  const configIds = list(process.env.CONFIGS);
  const all = loadCases();
  const study = process.env.STUDY === "alden" ? ALDEN_STUDY_IDS : null;
  const cases = all.filter((c) => (pilot ? PILOT_CASE_IDS.includes(c.id) : study ? study.includes(c.id) : !caseIds || caseIds.includes(c.id)));
  const jobsFor = (rep: number) => cases.flatMap((c) => configsFor(c.advisor, configIds).map((cfg) => ({ c, cfg, rep })));
  const now = new Date();

  if (process.env.DRY_RUN) {
    const lines = jobsFor(1).map(({ c, cfg }) => `${c.id.padEnd(26)} ${cfg.id.padEnd(3)} ${String(instructionSize(cfg, c.advisor, now)).padStart(6)} chars of instructions${c.followUp ? "  (two turns)" : ""}${c.followUps ? `  (${c.followUps.length + 1} turns)` : ""}`);
    const calls = jobsFor(1).reduce((n, { c }) => n + 1 + (c.followUp ? 1 : 0) + (c.followUps?.length ?? 0), 0) * reps;
    writeFileSync(`${OUT}dry-run.txt`, [...lines, "", `${calls} answer calls (${reps} repetitions), plus a rewrite call where a text-pipeline answer runs long.`].join("\n"));
    return;
  }

  const { getChatProvider, getRouterProvider } = await import("@/lib/ai");
  const providers = { chat: (id: SmsAdvisorId) => getChatProvider(COMPANIONS[id]), router: () => getRouterProvider() };
  const done = new Set<string>();
  let spent = 0;
  if (existsSync(RESULTS)) {
    for (const line of readFileSync(RESULTS, "utf8").split("\n").filter(Boolean)) {
      const r = JSON.parse(line) as RunResult;
      if (!r.error) done.add(r.key);
      spent += r.costUsd;
    }
  }
  // Round robin by repetition, so a budget stop leaves every configuration with the same number of runs.
  for (let rep = 1; rep <= reps; rep++) {
    const jobs = jobsFor(rep).filter(({ c, cfg }) => !done.has(`${c.id}|${cfg.id}|${rep}`));
    for (let i = 0; i < jobs.length; i += 4) {
      if (spent >= budget) break;
      const batch = await Promise.all(jobs.slice(i, i + 4).map(({ c, cfg }) => runOne(c, cfg, rep, now, providers)));
      for (const r of batch) {
        spent += r.costUsd;
        appendFileSync(RESULTS, JSON.stringify(r) + "\n");
      }
    }
    if (spent >= budget) break;
  }
  if (process.env.EXTRACT && !pilot) {
    // The substance page: every answer's judgment restated in neutral words, within the same budget.
    const have = new Set(existsSync(EXTRACTS) ? readFileSync(EXTRACTS, "utf8").split("\n").filter(Boolean).map((l) => (JSON.parse(l) as { key: string }).key) : []);
    const todo = readFileSync(RESULTS, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as RunResult).filter((r) => !r.error && !have.has(r.key));
    for (let i = 0; i < todo.length && spent < budget; i += 4) {
      const batch = await Promise.all(
        todo.slice(i, i + 4).map(async (r) => {
          const out = await complete(providers.router(), { system: [{ label: "extract", title: "EXTRACT", body: EXTRACT_PROMPT }], messages: [{ role: "user", content: [{ type: "text", text: r.delivered }] }], webSearch: false });
          return { key: r.key, text: out.text.trim(), cost: costOf(out.model, out.usage, 0) };
        }),
      );
      for (const e of batch) {
        spent += e.cost;
        appendFileSync(EXTRACTS, JSON.stringify({ key: e.key, text: e.text }) + "\n");
      }
    }
  }
  writeFileSync(`${OUT}spent.txt`, `$${spent.toFixed(2)} of $${budget}\n`);
  if (pilot) {
    // Does the experiment draw real distinctions? Overlap between configurations on the same question, and cost.
    const rs = readFileSync(RESULTS, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as RunResult).filter((r) => !r.error && r.rep === 1);
    const byCase = cases.map((c) => {
      const mine = rs.filter((r) => r.caseId === c.id);
      const pairs: Record<string, number> = {};
      for (const a of mine) for (const b of mine) if (a.config < b.config) pairs[`${a.config}~${b.config}`] = overlap(a.delivered, b.delivered);
      return { case: c.id, lengths: Object.fromEntries(mine.map((r) => [r.config, r.delivered.length])), rewritten: mine.filter((r) => r.rewritten).map((r) => r.config), overlap: pairs };
    });
    const perCall = rs.length ? rs.reduce((n, r) => n + r.costUsd, 0) / rs.length : 0;
    const full = loadCases().flatMap((c) => configsFor(c.advisor, null).map(() => c)).length;
    writeFileSync(
      `${OUT}pilot.json`,
      JSON.stringify({ costPerRun: Number(perCall.toFixed(4)), fullRunPerRepetitionUsd: Number((perCall * full).toFixed(2)), cases: byCase }, null, 2),
    );
    return;
  }
  render(OUT);
});
