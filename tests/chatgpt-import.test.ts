import { describe, expect, it } from "vitest";
import type { MessageRow } from "@/lib/db/types";
import { diffSummary, promptChangePlan } from "@/lib/gio/prompt-versions";
import { ChatGptFormatError, groupByGpt, importChatGptConversations, parseChatGptExport } from "@/lib/importers/chatgpt";
import { proposeFromConversation } from "@/lib/memory/extract";
import { runExtractionStep, toExchanges, type ExtractionStore } from "@/lib/memory/import-extraction";
import { FakeBackground } from "./helpers/fakes";
import { MemoryDataStore } from "./helpers/memory-store";

const t = (s: number) => 1_700_000_000 + s;

/** A ChatGPT conversation with a regenerated branch, a tool call and a hidden system message. */
function giosConversation() {
  return {
    id: "conv-1",
    title: "Living room sofa",
    create_time: t(0),
    update_time: t(100),
    gizmo_id: "g-gio123",
    current_node: "a2",
    mapping: {
      root: { id: "root", parent: null, children: ["sys"], message: null },
      sys: {
        id: "sys",
        parent: "root",
        children: ["u1"],
        message: { author: { role: "system" }, content: { content_type: "text", parts: ["You are Gio"] }, metadata: { is_visually_hidden_from_conversation: true } },
      },
      u1: {
        id: "u1",
        parent: "sys",
        children: ["a1-old", "tool"],
        message: {
          author: { role: "user" },
          create_time: t(10),
          content: { content_type: "multimodal_text", parts: [{ content_type: "image_asset_pointer", asset_pointer: "file-x" }, "We love green velvet. What sofa?"] },
        },
      },
      "a1-old": {
        id: "a1-old",
        parent: "u1",
        children: [],
        message: { author: { role: "assistant" }, create_time: t(11), content: { content_type: "text", parts: ["An abandoned answer"] }, recipient: "all" },
      },
      tool: {
        id: "tool",
        parent: "u1",
        children: ["a1"],
        message: { author: { role: "assistant" }, create_time: t(12), content: { content_type: "code", text: "search('sofa')" }, recipient: "browser" },
      },
      a1: {
        id: "a1",
        parent: "tool",
        children: ["a1b"],
        message: { author: { role: "assistant" }, create_time: t(13), content: { content_type: "text", parts: ["THE CALL — olive mohair."] }, recipient: "all" },
      },
      a1b: {
        id: "a1b",
        parent: "a1",
        children: ["u2"],
        message: { author: { role: "assistant" }, create_time: t(14), content: { content_type: "text", parts: ["WHY — it wears well."] }, recipient: "all" },
      },
      u2: {
        id: "u2",
        parent: "a1b",
        children: ["a2"],
        message: { author: { role: "user" }, create_time: t(20), content: { content_type: "text", parts: ["Yes, let's go with the mohair."] } },
      },
      a2: {
        id: "a2",
        parent: "u2",
        children: [],
        message: { author: { role: "assistant" }, create_time: t(21), content: { content_type: "text", parts: ["Good."] }, recipient: "all" },
      },
    },
  };
}

const other = {
  id: "conv-2",
  title: "Tax question",
  create_time: t(200),
  gizmo_id: null,
  current_node: "x",
  mapping: {
    x: { id: "x", parent: null, children: [], message: { author: { role: "user" }, content: { content_type: "text", parts: ["How do I file?"] } } },
  },
};

describe("parseChatGptExport", () => {
  it("follows the active branch and keeps only visible user and assistant text", () => {
    const [conv] = parseChatGptExport(JSON.stringify([giosConversation()]));
    expect(conv).toMatchObject({ id: "conv-1", title: "Living room sofa", gizmoId: "g-gio123" });
    expect(conv.messages.map((m) => [m.role, m.text])).toEqual([
      ["user", "[A photo was attached in ChatGPT]\n\nWe love green velvet. What sofa?"],
      ["assistant", "THE CALL — olive mohair.\n\nWHY — it wears well."],
      ["user", "Yes, let's go with the mohair."],
      ["assistant", "Good."],
    ]);
    expect(conv.messages[0].createdAt).toBe(new Date(t(10) * 1000).toISOString());
  });

  it("groups conversations by custom GPT so Gio's can be selected together", () => {
    const convs = parseChatGptExport([giosConversation(), other, { ...giosConversation(), id: "conv-3" }]);
    expect(groupByGpt(convs)).toEqual([
      { gizmoId: "g-gio123", count: 2 },
      { gizmoId: null, count: 1 },
    ]);
  });

  it("explains what's wrong with the wrong file", () => {
    expect(() => parseChatGptExport("not json")).toThrow(ChatGptFormatError);
    expect(() => parseChatGptExport('{"a":1}')).toThrow(/conversations.json/);
    expect(() => parseChatGptExport("[{\"title\":\"x\"}]")).toThrow(/conversations.json/);
  });
});

describe("importChatGptConversations", () => {
  it("creates a chat per conversation with ordered messages, speakers and extraction queued", async () => {
    const store = new MemoryDataStore("user-1");
    let n = 0;
    const convs = parseChatGptExport([giosConversation(), other]);
    const report = await importChatGptConversations(store, convs, {
      userId: "user-1",
      projectId: "p1",
      speaker: "Both",
      extractMemories: true,
      newId: () => `id-${++n}`,
    });
    expect(report).toMatchObject({ imported: 2, skipped: 0, messages: 5 });
    const chat = store.rows("chats")[0];
    expect(chat).toMatchObject({ title: "Living room sofa", source: "chatgpt", external_id: "chatgpt:conv-1", project_id: "p1", extraction_status: "pending" });
    const messages = store.rows("messages").filter((m) => m.chat_id === chat.id);
    expect(messages.map((m) => m.speaker)).toEqual(["Both", "Gio", "Both", "Gio"]);
    const times = messages.map((m) => String(m.created_at));
    expect([...times].sort()).toEqual(times);
    // A message with no timestamp still sorts after the conversation start.
    const lone = store.rows("messages").find((m) => m.content === "How do I file?")!;
    expect(new Date(String(lone.created_at)).getTime()).toBeGreaterThanOrEqual(t(200) * 1000 - 1);
  });

  it("skips conversations already imported", async () => {
    const store = new MemoryDataStore("user-1");
    const convs = parseChatGptExport([giosConversation()]);
    const opts = { userId: "user-1", projectId: "p1", speaker: "Amar" as const, extractMemories: false };
    await importChatGptConversations(store, convs, opts);
    const again = await importChatGptConversations(store, convs, opts);
    expect(again).toMatchObject({ imported: 0, skipped: 1 });
    expect(store.rows("chats")[0].extraction_status).toBeNull();
  });
});

describe("memory extraction over imported conversations", () => {
  const exchanges = [
    { index: 0, userText: "We love green velvet. What sofa?", assistantText: "Olive mohair." },
    { index: 1, userText: "Yes, let's go with the mohair.", assistantText: "Good." },
  ];

  it("checks evidence against the numbered message it claims to come from", async () => {
    const model = new FakeBackground();
    model.extraction = {
      memories: [
        { message: 0, type: "shared_preference", content: "They love green velvet.", holder: "Both", scope: "household", evidence: "We love green velvet" },
        // Evidence is from message 0 but claimed for message 1: dropped.
        { message: 1, type: "material", content: "Velvet.", holder: "none", scope: "project", evidence: "We love green velvet" },
        // Gio's words: dropped.
        { message: 0, type: "material", content: "Mohair.", holder: "none", scope: "project", evidence: "Olive mohair" },
      ],
      decisions: [{ message: 1, title: "Sofa: mohair", detail: "", status: "approved", evidence: "let's go with the mohair" }],
    };
    const out = await proposeFromConversation(model, { speaker: "Amar", projectName: "Marfa", existingMemories: [], existingDecisions: [] }, exchanges);
    expect(out).toEqual([
      { index: 0, memories: [expect.objectContaining({ content: "They love green velvet.", attributedTo: "Both", type: "shared_preference" })], decisions: [] },
      { index: 1, memories: [], decisions: [expect.objectContaining({ title: "Sofa: mohair", decidedBy: "Amar" })] },
    ]);
    expect(model.extractCalls[0].text).toContain("Message 0 from Amar:");
    expect(model.extractCalls[0].text).toContain("Old Gio's reply (context only):");
  });

  it("pairs each user message with the reply that follows", () => {
    const msg = (id: string, role: "user" | "assistant", content: string, speaker = role === "user" ? "Courtney" : "Gio") =>
      ({ id, role, speaker, content, chat_id: "c", attachments: [], metadata: {}, created_at: "" }) as MessageRow;
    const ex = toExchanges([msg("1", "user", "a"), msg("2", "assistant", "b"), msg("3", "user", "c"), msg("4", "user", "d"), msg("5", "assistant", "e")]);
    expect(ex.map((e) => [e.index, e.messageId, e.userText, e.assistantText, e.speaker])).toEqual([
      [0, "1", "a", "b", "Courtney"],
      [1, "3", "c", "", "Courtney"],
      [2, "4", "d", "e", "Courtney"],
    ]);
  });

  function stepStore(messages: MessageRow[]) {
    const chat = { id: "c", project_id: "p", room_id: null, project_name: "Marfa", extraction_next: 0, status: "pending" as string, patches: [] as Record<string, unknown>[] };
    const proposals: unknown[] = [];
    const store: ExtractionStore = {
      async claimChat() {
        return chat.status === "pending" || chat.status === "running" ? { ...chat } : null;
      },
      async updateChat(_id, patch) {
        chat.patches.push(patch);
        if (typeof patch.extraction_next === "number") chat.extraction_next = patch.extraction_next;
        if (typeof patch.extraction_status === "string") chat.status = patch.extraction_status;
      },
      async listMessages() {
        return messages;
      },
      async listKnownMemory() {
        return { memories: [], decisions: [] };
      },
      async insertProposals(input) {
        proposals.push(input);
      },
    };
    return { store, chat, proposals };
  }

  it("works through a long conversation in resumable steps and links proposals to their messages", async () => {
    const messages: MessageRow[] = [];
    for (let i = 0; i < 14; i++) {
      messages.push({ id: `u${i}`, chat_id: "c", role: "user", speaker: "Amar", content: `We love oak number ${i}.`, attachments: [], metadata: {}, created_at: "" });
      messages.push({ id: `a${i}`, chat_id: "c", role: "assistant", speaker: "Gio", content: "Noted.", attachments: [], metadata: {}, created_at: "" });
    }
    const { store, chat, proposals } = stepStore(messages);
    const model = new FakeBackground();
    model.extraction = { memories: [{ message: 0, type: "material", content: "They love oak.", holder: "Both", scope: "household", evidence: "We love oak number 0" }], decisions: [] };
    let clock = 0;
    const first = await runExtractionStep({ store, background: model, now: () => (clock += 1000) }, { budgetMs: 1 });
    expect(first).toMatchObject({ status: "running", processed: 6, total: 14, proposals: 1 });
    expect((proposals[0] as { sourceMessageId: string }).sourceMessageId).toBe("u0");
    await runExtractionStep({ store, background: model, now: () => (clock += 1000) }, { budgetMs: 1 });
    const last = await runExtractionStep({ store, background: model, now: () => (clock += 1000) }, { budgetMs: 1 });
    expect(last).toMatchObject({ status: "done", processed: 14 });
    expect(chat.status).toBe("done");
    expect(await runExtractionStep({ store, background: model }, { budgetMs: 1 })).toMatchObject({ status: "idle" });
  });

  it("marks the chat failed when the model fails, so it can be retried", async () => {
    const { store, chat } = stepStore([{ id: "u", chat_id: "c", role: "user", speaker: "Amar", content: "We love oak.", attachments: [], metadata: {}, created_at: "" }]);
    const model = new FakeBackground();
    model.extraction = new Error("rate limited");
    const r = await runExtractionStep({ store, background: model }, { budgetMs: 1000 });
    expect(r).toMatchObject({ status: "failed", error: "rate limited" });
    expect(chat.status).toBe("failed");
  });
});

describe("system prompt versions", () => {
  it("snapshots the original on the first change, then records each change", () => {
    expect(promptChangePlan({ live: "A", next: "B", hasHistory: false, label: "edited", note: " tweak " })).toEqual([
      { content: "A", label: "original", note: "The prompt before the first change" },
      { content: "B", label: "edited", note: "tweak" },
    ]);
    expect(promptChangePlan({ live: "B", next: "C", hasHistory: true, label: "restored" })).toEqual([{ content: "C", label: "restored", note: null }]);
    expect(promptChangePlan({ live: "B", next: "B", hasHistory: true, label: "edited" })).toEqual([]);
  });

  it("summarizes line changes", () => {
    expect(diffSummary("a\nb\nc", "a\nc\nd\ne")).toEqual({ added: 2, removed: 1 });
  });
});
