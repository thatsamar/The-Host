import { describe, expect, it } from "vitest";
import {
  evidenceSupported,
  isDuplicate,
  normalizeForMatch,
  preferenceTypeFor,
  resolveHolder,
  similarity,
} from "@/lib/memory/attribution";
import { draftDecision, draftMemory } from "@/lib/memory/drafts";
import {
  EXTRACTION_SYSTEM,
  MAX_MEMORY_PROPOSALS,
  normalizeProposals,
  proposeFromTurn,
  type Extraction,
  type TurnContext,
} from "@/lib/memory/extract";
import { FakeBackground } from "./helpers/fakes";

const ctx = (overrides: Partial<TurnContext> = {}): TurnContext => ({
  speaker: "Amar",
  userText: "I love green velvet, and I hate lacquered finishes.",
  assistantText: "THE CALL — Go with a deep olive mohair. Also, I'd suggest a Wegner CH25 for the corner.",
  projectName: "Marfa House",
  existingMemories: [],
  existingDecisions: [],
  ...overrides,
});

type RawMemory = Extraction["memories"][number];
const mem = (m: Partial<RawMemory>): RawMemory => ({
  type: "amar_preference",
  content: "Amar loves green velvet.",
  holder: "Amar",
  scope: "household",
  evidence: "I love green velvet",
  ...m,
});
const raw = (memories: RawMemory[], decisions: Extraction["decisions"] = []): Extraction => ({ memories, decisions });

describe("speaker attribution", () => {
  it("a preference stated by Amar is Amar's", () => {
    const out = normalizeProposals(raw([mem({})]), ctx());
    expect(out.memories[0]).toMatchObject({ type: "amar_preference", attributedTo: "Amar" });
  });

  it("the model can't reassign Amar's preference to Courtney unless he names her", () => {
    const out = normalizeProposals(raw([mem({ type: "courtney_preference", holder: "Courtney" })]), ctx());
    expect(out.memories[0]).toMatchObject({ type: "amar_preference", attributedTo: "Amar" });
  });

  it("a reported preference is attributed to the person named", () => {
    const c = ctx({ userText: "Courtney wants the washed linen, not the velvet." });
    const out = normalizeProposals(
      raw([mem({ type: "courtney_preference", holder: "Courtney", content: "Courtney prefers washed linen.", evidence: "Courtney wants the washed linen" })]),
      c,
    );
    expect(out.memories[0]).toMatchObject({ type: "courtney_preference", attributedTo: "Courtney" });
  });

  it("it's shared only when the speaker says so", () => {
    const shared = normalizeProposals(
      raw([mem({ type: "shared_preference", holder: "Both", content: "They love terracotta floors.", evidence: "we both love terracotta floors" })]),
      ctx({ userText: "Honestly we both love terracotta floors." }),
    );
    expect(shared.memories[0]).toMatchObject({ type: "shared_preference", attributedTo: "Both" });

    const notShared = normalizeProposals(
      raw([mem({ type: "shared_preference", holder: "Both", content: "Terracotta floors.", evidence: "I love terracotta floors" })]),
      ctx({ userText: "I love terracotta floors." }),
    );
    expect(notShared.memories[0]).toMatchObject({ type: "amar_preference", attributedTo: "Amar" });
  });

  it("a message sent as Both is shared unless it names one of them", () => {
    const out = normalizeProposals(
      raw([mem({ type: "design_preference", holder: "none", content: "They avoid recessed lighting.", evidence: "no recessed lights" })]),
      ctx({ speaker: "Both", userText: "Please, no recessed lights anywhere." }),
    );
    expect(out.memories[0]).toMatchObject({ type: "shared_preference", attributedTo: "Both" });
  });

  it("non-preference memories keep their type and record who stated them", () => {
    const out = normalizeProposals(
      raw([mem({ type: "dimension", holder: "none", content: "The living room is 18 by 22 feet.", evidence: "living room is 18 x 22", scope: "project" })]),
      ctx({ userText: "FYI the living room is 18 x 22." }),
    );
    expect(out.memories[0]).toMatchObject({ type: "dimension", attributedTo: "Amar", scope: "project" });
  });

  it("resolveHolder and preferenceTypeFor", () => {
    expect(resolveHolder("none", "Courtney", "x", "x")).toBe("Courtney");
    expect(resolveHolder("Amar", "Both", "Amar hates brass", "Amar hates brass")).toBe("Amar");
    expect(resolveHolder("Amar", "Both", "no brass", "no brass")).toBe("Both");
    expect(preferenceTypeFor("Both")).toBe("shared_preference");
  });
});

describe("conservative extraction", () => {
  it("drops anything not backed by Courtney's or Amar's own words (Gio's advice is not their preference)", () => {
    const out = normalizeProposals(
      raw([
        mem({ content: "Amar wants olive mohair.", evidence: "Go with a deep olive mohair" }),
        mem({ type: "furniture_under_consideration", content: "A Wegner CH25.", evidence: "Wegner CH25" }),
      ]),
      ctx(),
    );
    expect(out.memories).toEqual([]);
  });

  it("accepts evidence with different quotes, case and punctuation", () => {
    expect(evidenceSupported("“I LOVE green velvet,”", "i love green velvet, and more")).toBe(true);
    expect(evidenceSupported("love green … lacquered finishes", "I love green velvet, and I hate lacquered finishes.")).toBe(true);
    expect(evidenceSupported("ok", "ok then")).toBe(false);
    expect(evidenceSupported("pink sofa", "I love green velvet")).toBe(false);
  });

  it("skips duplicates of existing, proposed or dismissed memories, and within the batch", () => {
    const out = normalizeProposals(
      raw([
        mem({ content: "Amar hates lacquered finishes.", evidence: "I hate lacquered finishes" }),
        mem({}),
        mem({ content: "Amar loves green velvet!", evidence: "I love green velvet" }),
      ]),
      ctx({ existingMemories: ["Amar hates lacquered finishes."] }),
    );
    expect(out.memories.map((m) => m.content)).toEqual(["Amar loves green velvet."]);
  });

  it("caps the number of proposals per turn", () => {
    const text = Array.from({ length: 10 }, (_, i) => `I like material${i}`).join(". ");
    const many = Array.from({ length: 10 }, (_, i) =>
      mem({ type: "material", content: `Amar likes material${i} a lot.`, evidence: `I like material${i}` }),
    );
    expect(normalizeProposals(raw(many), ctx({ userText: text })).memories).toHaveLength(MAX_MEMORY_PROPOSALS);
  });

  it("proposes decisions only from explicit acceptance or rejection in the user's message", () => {
    const out = normalizeProposals(
      raw(
        [],
        [
          { title: "Dining table: walnut", detail: "Going with walnut.", status: "approved", evidence: "yes, let's do the walnut" },
          { title: "Sofa: olive mohair", detail: "Gio's pick", status: "approved", evidence: "deep olive mohair" },
        ],
      ),
      ctx({ speaker: "Courtney", userText: "Yes, let's do the walnut table." }),
    );
    expect(out.decisions).toEqual([
      { title: "Dining table: walnut", detail: "Going with walnut.", status: "approved", decidedBy: "Courtney", evidence: "yes, let's do the walnut" },
    ]);
  });

  it("skips decisions already logged", () => {
    const out = normalizeProposals(
      raw([], [{ title: "Dining table: walnut", detail: "", status: "approved", evidence: "walnut table" }]),
      ctx({ userText: "The walnut table it is", existingDecisions: ["Dining table: walnut"] }),
    );
    expect(out.decisions).toEqual([]);
  });

  it("similarity and duplicate detection", () => {
    expect(similarity("Amar loves green velvet", "amar LOVES green velvet.")).toBe(1);
    expect(similarity("oak floors", "brass lamps")).toBe(0);
    expect(isDuplicate("Courtney prefers linen", ["Courtney prefers washed linen"])).toBe(true);
    expect(isDuplicate("Courtney prefers linen", ["Amar prefers velvet"])).toBe(false);
    expect(normalizeForMatch("  “Hello—world”. ")).toBe('hello-world');
  });
});

describe("proposeFromTurn", () => {
  it("sends the speaker, the message, Gio's reply as context and existing memory, then normalizes", async () => {
    const model = new FakeBackground();
    model.extraction = raw([mem({})]);
    const out = await proposeFromTurn(model, ctx({ existingMemories: ["Courtney prefers linen."] }));
    expect(out.memories).toHaveLength(1);
    const call = model.extractCalls[0];
    expect(call.system).toBe(EXTRACTION_SYSTEM);
    expect(call.text).toContain("Message from Amar:");
    expect(call.text).toContain("Gio's reply (context only, not evidence):");
    expect(call.text).toContain("- Courtney prefers linen.");
  });

  it("does not call the model for an empty message", async () => {
    const model = new FakeBackground();
    expect(await proposeFromTurn(model, ctx({ userText: " " }))).toEqual({ memories: [], decisions: [] });
    expect(model.extractCalls).toHaveLength(0);
  });

  it("rejects model output that doesn't match the schema", async () => {
    const model = new FakeBackground();
    model.extraction = { memories: [{ type: "favorite_color", content: "x" }], decisions: [] };
    await expect(proposeFromTurn(model, ctx())).rejects.toThrow();
  });
});

describe("drafts for command buttons", () => {
  const src = { message: { role: "assistant" as const, speaker: "Gio", content: "Buy the PH5." }, previous: null, speaker: "Courtney" as const };

  it("keeps a drafted preference consistent with its holder", async () => {
    const model = new FakeBackground();
    model.extraction = { type: "amar_preference", content: "Courtney loves pools of lamplight.", holder: "Courtney", scope: "household" };
    expect(await draftMemory(model, src)).toMatchObject({ type: "courtney_preference", holder: "Courtney" });
  });

  it("applies a preset status (Keep looking) over the drafted one", async () => {
    const model = new FakeBackground();
    model.extraction = { title: "Pendant", detail: "d", status: "approved", product: null };
    expect(await draftDecision(model, src, "keep_looking")).toMatchObject({ status: "keep_looking" });
    expect(model.extractCalls[0].text).toContain("Gio wrote:");
    expect(model.extractCalls[0].text).toContain("The person saving this is Courtney.");
  });
});
