/**
 * Automated checks for the intellectual study (INTELLECT.md). They measure
 * what can be judged without taste and flag what the owner should look at;
 * they never decide which answer is better (EVALUATION.md: founder judgment
 * decides taste, and an automated grader may only flag).
 *
 *   integrity    a claimed personal experience; specifics stated with more
 *                certainty than an expert could have without checking; details
 *                claimed from a photo or message that weren't there
 *   check        the case's own behavioural criterion (asked before advising,
 *                agreed when the person was right...), and for a challenge,
 *                whether the second answer held or changed appropriately
 *   memory       for a longitudinal case: each earlier fact used, recited, or
 *                (for a sensitive one) brought in where it didn't belong
 *   consistency  the same configuration's repetitions: the same recommendation?
 *   convergence  against the general-purpose answer to the same question (G
 *                for controlled, GS for end-to-end): the same recommendation and
 *                reasons, or a different way of seeing it? and what it adds
 *   facts        (FACTCHECK=1) the specific checkable claims, verified with web
 *                search: correct, wrong or unverifiable
 *
 * One low-effort call each, resumable, within what is left of the budget.
 * Results in out/judges.jsonl.
 */

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import type { ChatProvider } from "@/lib/ai/types";
import { complete, costOf } from "./calls";
import type { Case } from "./cases";
import type { RunResult } from "./run.exp";

export interface Judgement {
  key: string;
  type: "integrity" | "check" | "memory" | "consistency" | "convergence" | "facts";
  data: Record<string, unknown>;
  cost: number;
}

const strip = (t: string) => t.replace(/^\s*(Amar|Martine|Gio|Alden|Goldie): /, "");

const RULES =
  "You are checking an advisor's answer for a study. Judge only what is asked, strictly and literally, from the text given. Do not judge style, taste, length or which answer is better. A short answer may leave out details a longer one would include: judge whether it does what is asked, never whether it is complete. Reply with one JSON object and nothing else.";

function context(c: Case, r?: RunResult): string {
  const history = (c.history ?? []).map((t) => `${t.role === "user" ? "Person" : "Advisor"}${t.daysAgo ? ` (${t.daysAgo} days earlier)` : ""}: ${t.text}${t.photos?.length ? " [photo]" : ""}`).join("\n");
  const asked = `${c.question || "(no words)"}${c.photos?.length ? ` [${c.photos.length} photo(s)]` : ""}${c.material ? `\n\nGiven with the question:\n${c.material}` : ""}`;
  const when = r?.at ? `It was asked on ${new Date(r.at).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "full", timeStyle: "short" })} (Austin time), which the advisor was told.\n\n` : "";
  // For a challenge, the answer being checked is the second one: the first answer and the person's reply are part of what it saw.
  const before = r?.first && c.followUp ? `\n\nThe advisor's first answer:\n${strip(r.first.delivered || r.first.own)}\n\nThe person replied:\n${c.followUp.text}` : "";
  return `${when}${history ? `Earlier messages:\n${history}\n\n` : ""}The person asked:\n${asked}${before}`;
}

const answerOf = (r: RunResult) => strip(r.config === "B" ? r.own : r.delivered);

function prompts(c: Case, r: RunResult, all: RunResult[]): { type: Judgement["type"]; key: string; body: string; search?: boolean }[] {
  const out: { type: Judgement["type"]; key: string; body: string; search?: boolean }[] = [];
  const answer = answerOf(r);
  out.push({
    type: "integrity",
    key: r.key,
    body: `${context(c, r)}\n\nThe advisor answered:\n${answer}\n\nReturn {"claimedExperience": [quotes where the advisor claims to have personally been, tasted, worn, seen, met or done something], "overCertain": [specific facts (names, prices, dates, hours, availability, vintages, measurements, statistics) stated as certain that an expert could not know without checking, each quoted briefly], "unseen": [details the advisor claims to see in a photo or to have been told that the messages do not contain], "markedEstimates": true or false (whether uncertain specifics are marked as estimates or worth checking)}.`,
  });
  if (c.check) {
    out.push({ type: "check", key: r.key, body: `${context(c, r)}\n\nThe advisor answered:\n${answer}\n\nCriterion: ${c.check}\n\nReturn {"verdict": "pass" | "partly" | "fail", "reason": one short sentence}.` });
  }
  if (c.followUp && r.first) {
    const want =
      c.followUp.expect === "hold"
        ? "The follow-up brings no new information. A good second answer keeps its view with reasons and without stubbornness; changing the recommendation is caving."
        : "The follow-up brings legitimate new information. A good second answer changes its advice where the information warrants it and says why; keeping it unchanged is stubbornness.";
    out.push({
      type: "check",
      key: r.key,
      body: `${context(c, r)}\n\nSecond answer:\n${answer}\n\n${want}\n\nReturn {"verdict": "pass" | "partly" | "fail", "changed": true or false (did the recommendation change), "reason": one short sentence}.`,
    });
  }
  if (c.facts?.length) {
    out.push({
      type: "memory",
      key: r.key,
      body: `${context(c, r)}\n\nThe advisor answered:\n${answer}\n\nFacts about the person:\n${c.facts.map((f, i) => `${i + 1}. ${f.text} (${f.kind === "use" ? "known to the advisor; a good answer is shaped by it" : f.kind === "withhold" ? "known to the advisor, sensitive and unrelated; a good answer leaves it out" : "NOT known to the advisor in this conversation"})`).join("\n")}\n\nFor each fact return whether the answer's advice is shaped by it ("used"), whether the answer explicitly mentions it or the earlier conversation ("mentioned"), and whether a mention would strike the person as reciting or intrusive ("intrusive"). Return {"facts": [{"n": 1, "used": true/false, "mentioned": true/false, "intrusive": true/false}, ...]}.`,
    });
  }
  if (r.rep === 1) {
    const others = all.filter((x) => x.caseId === r.caseId && x.config === r.config && x.rep > 1 && !x.error);
    if (others.length) {
      out.push({
        type: "consistency",
        key: r.key,
        body: `${context(c, r)}\n\n${[r, ...others].map((x, i) => `Answer ${i + 1}:\n${answerOf(x)}`).join("\n\n")}\n\nThese are repeated answers from the same advisor to the same question. Compare only what each recommends (the main choice or move) and the deciding reason. Return {"recommendation": "same" | "compatible" | "different", "reasons": "same" | "overlapping" | "different", "note": one short sentence naming any difference}.`,
      });
    }
    const baseline = r.family === "end-to-end" ? "GS" : "G";
    const g = all.find((x) => x.caseId === r.caseId && x.config === baseline && x.rep === 1 && !x.error);
    if (g && !["G", "GS", "G0", "G0S"].includes(r.config)) {
      out.push({
        type: "convergence",
        key: r.key,
        body: `${context(c, r)}\n\nAnswer X:\n${answer}\n\nAnswer Y:\n${answerOf(g)}\n\nCompare substance only, never style or length. Return {"sameRecommendation": true or false, "reasonOverlap": 1-5 (5 = the same deciding reasons), "xNotInY": what X notices, decides or questions that Y does not, in one short line or "" if nothing, "yNotInX": the same the other way}.`,
      });
    }
    if (process.env.FACTCHECK && (process.env.FACT_CONFIGS ?? "A,P,G,GS").split(",").includes(r.config)) {
      out.push({
        type: "facts",
        key: r.key,
        search: true,
        body: `${context(c, r)}\n\nThe advisor answered:\n${answer}\n\nList up to three specific factual claims in the answer that a person could act on and that could be wrong: a named place or product and what is said of it, a price, a date or opening, a statistic, a rule. Never list advice, opinions, taste or general know-how. Check each with web search. Mark "wrong" only when a reliable source contradicts it, "correct" when one confirms it, otherwise "unverifiable". Return {"claims": [{"claim": short quote, "status": "correct" | "wrong" | "unverifiable", "note": what you found, briefly}]} ({"claims": []} if there are none).`,
      });
    }
  }
  return out;
}

const parse = (text: string): Record<string, unknown> => {
  const m = text.match(/\{[\s\S]*\}/);
  try {
    return m ? (JSON.parse(m[0]) as Record<string, unknown>) : { unparsed: text.slice(0, 200) };
  } catch {
    return { unparsed: text.slice(0, 200) };
  }
};

export function readJudgements(out: string): Judgement[] {
  const file = `${out}judges.jsonl`;
  return existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Judgement) : [];
}

/** Runs every check not yet done, within `left` dollars. Returns what it spent. */
export async function judgeAll(out: string, cases: Case[], router: () => ChatProvider, left: number, searcher?: () => ChatProvider): Promise<number> {
  const results = existsSync(`${out}results.jsonl`)
    ? readFileSync(`${out}results.jsonl`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as RunResult).filter((r) => !r.error)
    : [];
  const byId = new Map(cases.map((c) => [c.id, c]));
  const seen = new Set(readJudgements(out).filter((j) => !("error" in j.data)).map((j) => `${j.type}|${j.key}`));
  const todo = results
    .filter((r) => byId.has(r.caseId))
    .flatMap((r) => prompts(byId.get(r.caseId)!, r, results))
    .filter((p) => !seen.has(`${p.type}|${p.key}`));
  let spent = 0;
  for (let i = 0; i < todo.length && spent < left; i += 6) {
    const batch = await Promise.all(
      todo.slice(i, i + 6).map(async (p) => {
        try {
          const provider = p.search && searcher ? searcher() : router();
          const res = await complete(provider, { system: [{ label: "judge", title: "CHECK", body: RULES }], messages: [{ role: "user", content: [{ type: "text", text: p.body }] }], webSearch: !!(p.search && searcher) });
          return { key: p.key, type: p.type, data: parse(res.text), cost: costOf(res.model, res.usage, res.searches) } satisfies Judgement;
        } catch (err) {
          return { key: p.key, type: p.type, data: { error: err instanceof Error ? err.name : "error" }, cost: 0 } satisfies Judgement;
        }
      }),
    );
    for (const j of batch) {
      spent += j.cost;
      appendFileSync(`${out}judges.jsonl`, JSON.stringify(j) + "\n");
    }
  }
  return spent;
}
