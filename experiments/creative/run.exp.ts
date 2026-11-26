/**
 * The creative comparison (README.md). Runs only with RUN_CREATIVE_EXPERIMENT=1:
 *
 *   RUN_CREATIVE_EXPERIMENT=1 npx vitest run --config experiments/creative/vitest.config.mts
 *
 * DRY_RUN=1 makes no model calls and prints what it would send and roughly cost.
 * REPS (default 3), BUDGET_USD (default 30), CASES and CONFIGS (comma lists) narrow it.
 * Results go to experiments/creative/out/ (never committed). Nothing touches production:
 * no database, no Twilio, no deployment; only model calls made from here.
 */

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { it } from "vitest";
import { toChatTurns } from "@/lib/ask/prompt";
import { COMPANIONS } from "@/lib/companions";
import { callCost } from "@/lib/ops/rates";
import { readSuggestion, offerText } from "@/lib/sms/handoff";
import { speakerLabel, toSmsText } from "@/lib/sms/handler";
import { SMS_ADVISORS, type SmsAdvisorId } from "@/lib/sms/navigation";
import { answerBudget, answerFits, condensePrompt, roomForAnswer, shortAnswerText } from "@/lib/sms/short";
import type { ChatProvider, ChatRequest } from "@/lib/ai/types";
import { CASES, type Case } from "./cases";
import { CONFIGS, instructionSize, type Config } from "./configs";
import { render } from "./render";

const OUT = fileURLToPath(new URL("./out/", import.meta.url));
const RESULTS = `${OUT}results.jsonl`;
/** Assumed list price per web search, for the budget only (not in the rates table). */
const SEARCH_USD = 0.01;

export interface RunResult {
  key: string;
  caseId: string;
  advisor: string;
  config: string;
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

async function runOne(c: Case, config: Config, rep: number, now: Date, providers: { chat: (id: SmsAdvisorId) => ChatProvider; router: () => ChatProvider }): Promise<RunResult> {
  const id = c.advisor as SmsAdvisorId;
  const companion = COMPANIONS[id];
  const system = config.system(c.advisor, now);
  const request: ChatRequest = { system, messages: toChatTurns([{ role: "user", text: c.question }], companion.photosOnly), webSearch: config.webSearch };
  const base = {
    key: `${c.id}|${config.id}|${rep}`,
    caseId: c.id,
    advisor: c.advisor,
    config: config.id,
    rep,
    at: now.toISOString(),
    effort: process.env.CHAT_EFFORT || "high (default)",
    webSearch: config.webSearch,
    instructionChars: instructionSize(config, c.advisor, now),
    promptSha: createHash("sha256").update(system.map((b) => b.body).join("\n\n")).digest("hex").slice(0, 12),
  };
  const began = Date.now();
  try {
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
      const budget = answerBudget(label, null);
      let plain = own;
      if (!answerFits({ label, intro: null, answer: plain, offer })) {
        const room = roomForAnswer(budget, offer);
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
    return { ...base, model: first.model, routerModel, ms: Date.now() - began, usage: first.usage, searches: first.searches, costUsd: cost, own, delivered, rewritten, trimmed, error: null };
  } catch (err) {
    return { ...base, model: null, routerModel: null, ms: Date.now() - began, usage: {}, searches: 0, costUsd: 0, own: "", delivered: "", rewritten: false, trimmed: false, error: err instanceof Error ? err.name : "error" };
  }
}

const list = (v: string | undefined) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : null);

it.skipIf(!process.env.RUN_CREATIVE_EXPERIMENT)("runs the creative comparison", async () => {
  mkdirSync(OUT, { recursive: true });
  const reps = Number(process.env.REPS) || 3;
  const budget = Number(process.env.BUDGET_USD) || 30;
  const caseIds = list(process.env.CASES);
  const configIds = list(process.env.CONFIGS);
  const cases = CASES.filter((c) => !caseIds || caseIds.includes(c.id));
  const configs = CONFIGS.filter((c) => !configIds || configIds.includes(c.id));
  const now = new Date();

  if (process.env.DRY_RUN) {
    const lines = cases.flatMap((c) => configs.map((cfg) => `${c.id.padEnd(20)} ${cfg.id}  ${String(instructionSize(cfg, c.advisor, now)).padStart(6)} chars of instructions`));
    const calls = cases.length * configs.length * reps;
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
    const jobs = cases.flatMap((c) => configs.map((cfg) => ({ c, cfg }))).filter(({ c, cfg }) => !done.has(`${c.id}|${cfg.id}|${rep}`));
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
  writeFileSync(`${OUT}spent.txt`, `$${spent.toFixed(2)} of $${budget}\n`);
  render(OUT);
});
