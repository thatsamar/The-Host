import { describe, expect, it } from "vitest";
import type { ChatContentPart } from "@/lib/ai/types";
import { ChatInputError, dedupeSources, fallbackTitle, runChatTurn, type ChatServerEvent } from "@/lib/chat/service";
import { FakeBackground, MemoryRepo, ScriptedProvider, collect, replyWith } from "./helpers/fakes";

const textOf = (parts: ChatContentPart[]) =>
  parts.map((p) => (p.type === "text" ? p.text : "")).join("\n");

function setup() {
  const repo = new MemoryRepo();
  const project = repo.addProject({ name: "Marfa House", is_default: false, location: "Marfa, Texas" });
  const room = repo.addRoom(project.id, "Reading corner", "North window");
  return { repo, project, room };
}

describe("runChatTurn", () => {
  it("creates a chat, saves both messages with speakers, streams text and titles the chat", async () => {
    const { repo, project, room } = setup();
    const provider = new ScriptedProvider(replyWith("THE CALL — Keep looking."));
    const background = new FakeBackground("Vintage Lounge Chair Search");

    const events = await collect(
      runChatTurn(
        { repo, provider, background },
        { projectId: project.id, roomId: room.id, speaker: "Amar", text: "Should we buy this chair?" },
      ),
    );

    const types = events.map((e) => e.type);
    expect(types[0]).toBe("meta");
    expect(types).toContain("text");
    expect(types.slice(-2)).toEqual(["done", "title"]);

    const streamed = events
      .filter((e): e is Extract<ChatServerEvent, { type: "text" }> => e.type === "text")
      .map((e) => e.text)
      .join("");
    expect(streamed).toBe("THE CALL — Keep looking.");

    expect(repo.chats).toHaveLength(1);
    expect(repo.chats[0]).toMatchObject({ project_id: project.id, room_id: room.id, title: "Vintage Lounge Chair Search" });
    expect(repo.messages.map((m) => [m.role, m.speaker])).toEqual([
      ["user", "Amar"],
      ["assistant", "Gio"],
    ]);
    expect(repo.messages[1].metadata).toMatchObject({ model: "test-model", stop_reason: "end_turn" });
    expect(repo.lastSpeaker).toBe("Amar");
  });

  it("sends the project, room and speaker to the model", async () => {
    const { repo, project, room } = setup();
    const provider = new ScriptedProvider(replyWith("ok"));
    await collect(
      runChatTurn(
        { repo, provider, background: new FakeBackground() },
        { projectId: project.id, roomId: room.id, speaker: "Courtney", text: "Linen." },
      ),
    );
    const req = provider.requests[0];
    expect(req.system[0].body).toBe("You are Gio.");
    const projectBlock = req.system.find((b) => b.label === "project_context")!;
    expect(projectBlock.body).toContain("Marfa House");
    expect(projectBlock.body).toContain("Current room: Reading corner");
    expect(textOf(req.messages.at(-1)!.content)).toBe("Speaker: Courtney\n\nLinen.");
    expect(req.webSearch).toBe(true);
  });

  it("continues an existing chat with prior turns and keeps its title", async () => {
    const { repo, project } = setup();
    const provider = new ScriptedProvider(replyWith("First answer"));
    const background = new FakeBackground("First Title");
    const first = await collect(
      runChatTurn({ repo, provider, background }, { projectId: project.id, speaker: "Amar", text: "Green velvet." }),
    );
    const chatId = (first[0] as Extract<ChatServerEvent, { type: "meta" }>).chatId;

    const second = new ScriptedProvider(replyWith("Synthesis"));
    const events = await collect(
      runChatTurn(
        { repo, provider: second, background },
        { chatId, projectId: project.id, speaker: "Courtney", text: "Linen. Where do we land?" },
      ),
    );
    expect(events.map((e) => e.type)).not.toContain("title");
    expect(background.calls).toHaveLength(1);
    const msgs = second.requests[0].messages;
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(textOf(msgs[0].content)).toContain("Speaker: Amar");
    expect(textOf(msgs[2].content)).toContain("Speaker: Courtney");
    expect(repo.chats[0].title).toBe("First Title");
  });

  it("an existing chat keeps its own project and room even if the request says otherwise", async () => {
    const { repo, project, room } = setup();
    const other = repo.addProject({ name: "Other", is_default: false });
    const chat = await repo.createChat({ projectId: project.id, roomId: room.id });
    const provider = new ScriptedProvider(replyWith("ok"));
    await collect(
      runChatTurn(
        { repo, provider, background: new FakeBackground() },
        { chatId: chat.id, projectId: other.id, roomId: null, speaker: "Both", text: "Hi" },
      ),
    );
    expect(provider.requests[0].system.find((b) => b.label === "project_context")!.body).toContain("Marfa House");
  });

  it("includes approved memories and decisions, never proposed ones", async () => {
    const { repo, project } = setup();
    const base = { room_id: null, source_message_id: null, created_at: "" };
    repo.memories.push(
      { ...base, id: "m1", project_id: project.id, type: "amar_preference", content: "Amar loves velvet", attributed_to: "Amar", review_state: "approved" },
      { ...base, id: "m2", project_id: null, type: "budget_philosophy", content: "Invest in seating", attributed_to: "Both", review_state: "approved" },
      { ...base, id: "m3", project_id: project.id, type: "rejected_idea", content: "Proposed only", attributed_to: null, review_state: "proposed" },
    );
    repo.decisions.push({
      ...base,
      id: "d1",
      project_id: project.id,
      title: "Sofa",
      detail: "Keep looking for a lower back",
      status: "keep_looking",
      review_state: "approved",
    });
    const provider = new ScriptedProvider(replyWith("ok"));
    await collect(
      runChatTurn({ repo, provider, background: new FakeBackground() }, { projectId: project.id, speaker: "Both", text: "Hi" }),
    );
    const memories = provider.requests[0].system.find((b) => b.label === "memories")!.body;
    expect(memories).toContain("Amar loves velvet");
    expect(memories).toContain("Invest in seating [household-wide, from Both]");
    expect(memories).toContain("Sofa: Keep looking for a lower back [keep looking]");
    expect(memories).not.toContain("Proposed only");
  });

  it("passes retrieved references into the prompt when a retriever is provided", async () => {
    const { repo, project } = setup();
    const provider = new ScriptedProvider(replyWith("ok"));
    await collect(
      runChatTurn(
        {
          repo,
          provider,
          background: new FakeBackground(),
          retrieve: async () => [{ fileName: "ponti.pdf", content: "Lightness", sourceType: "text" }],
        },
        { projectId: project.id, speaker: "Both", text: "Chairs" },
      ),
    );
    expect(provider.requests[0].system.find((b) => b.label === "retrieved_references")!.body).toContain("ponti.pdf");
  });

  it("records web searches and deduplicated sources on the assistant message", async () => {
    const { repo, project } = setup();
    const url = "https://example.com/chair";
    const provider = new ScriptedProvider(() => [
      { type: "web_search", query: "vintage lounge chair" },
      { type: "web_results", sources: [{ title: "Chair", url }] },
      { type: "text", text: "Found one — $1,800 (sourced)." },
      {
        type: "done",
        text: "Found one — $1,800 (sourced).",
        model: "m",
        stopReason: "end_turn",
        usage: {},
        webSearches: ["vintage lounge chair"],
        webSources: [{ title: "Chair", url }, { title: "Chair again", url }],
      },
    ]);
    const events = await collect(
      runChatTurn({ repo, provider, background: new FakeBackground() }, { projectId: project.id, speaker: "Both", text: "Find a chair" }),
    );
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(["web_search", "web_results"]));
    expect(repo.messages[1].metadata.web_sources).toEqual([{ title: "Chair", url }]);
    expect(repo.messages[1].metadata.web_searches).toEqual(["vintage lounge chair"]);
  });

  it("reports provider failures as an error event and keeps the user message", async () => {
    const { repo, project } = setup();
    const provider = new ScriptedProvider(() => new Error("overloaded"));
    const events = await collect(
      runChatTurn({ repo, provider, background: new FakeBackground() }, { projectId: project.id, speaker: "Amar", text: "Hi" }),
    );
    expect(events.at(-1)).toEqual({ type: "error", message: "overloaded" });
    expect(repo.messages.map((m) => m.role)).toEqual(["user"]);
    expect(repo.chats[0].title).toBe("Hi");
  });

  it("falls back to a title from the message when the background model fails", async () => {
    const { repo, project } = setup();
    const provider = new ScriptedProvider(replyWith("ok"));
    await collect(
      runChatTurn(
        { repo, provider, background: new FakeBackground(new Error("down")) },
        { projectId: project.id, speaker: "Both", text: "Create a lighting plan for the dining room." },
      ),
    );
    expect(repo.chats[0].title).toBe("Create a lighting plan for the dining");
  });

  it("rejects empty text, unknown chats, unknown projects and rooms from other projects", async () => {
    const { repo, project } = setup();
    const other = repo.addProject({ name: "Other", is_default: false });
    const foreignRoom = repo.addRoom(other.id, "Elsewhere");
    const deps = { repo, provider: new ScriptedProvider(replyWith("x")), background: new FakeBackground() };
    const run = (input: Parameters<typeof runChatTurn>[1]) => collect(runChatTurn(deps, input));

    await expect(run({ projectId: project.id, speaker: "Both", text: "   " })).rejects.toBeInstanceOf(ChatInputError);
    await expect(
      run({ chatId: "00000000-0000-4000-8000-999999999999", projectId: project.id, speaker: "Both", text: "Hi" }),
    ).rejects.toThrow("Chat not found");
    await expect(
      run({ projectId: "00000000-0000-4000-8000-999999999998", speaker: "Both", text: "Hi" }),
    ).rejects.toThrow("Project not found");
    await expect(run({ projectId: project.id, roomId: foreignRoom.id, speaker: "Both", text: "Hi" })).rejects.toThrow(
      "Room not found",
    );
    expect(repo.messages).toHaveLength(0);
  });
});

describe("helpers", () => {
  it("dedupeSources keeps the first of each URL", () => {
    expect(
      dedupeSources([
        { title: "a", url: "u1" },
        { title: "b", url: "u1" },
        { title: "c", url: "u2" },
      ]),
    ).toEqual([
      { title: "a", url: "u1" },
      { title: "c", url: "u2" },
    ]);
  });

  it("fallbackTitle trims to a few words", () => {
    expect(fallbackTitle("  one two   three ")).toBe("one two three");
    expect(fallbackTitle("")).toBe("New conversation");
  });
});

describe("interrupted answers", () => {
  it("saves the partial answer and a fallback title when the client stops mid-stream", async () => {
    const repo = new MemoryRepo();
    const project = repo.addProject();
    const provider = new ScriptedProvider(replyWith("THE CALL — Subtract the side table, then relight the corner."));
    const gen = runChatTurn(
      { repo, provider, background: new FakeBackground() },
      { projectId: project.id, speaker: "Both", text: "What is the highest-leverage move in this room?" },
    );
    await gen.next(); // meta
    await gen.next(); // first text chunk
    await gen.next(); // second text chunk
    await gen.return(undefined); // the browser pressed Stop
    expect(repo.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(repo.messages[1].content).toBe("THE CALL — Subtr");
    expect(repo.messages[1].metadata.stop_reason).toBe("interrupted");
    expect(repo.chats[0].title).toBe("What is the highest-leverage move in this");
  });

  it("saves partial text when the provider fails mid-answer", async () => {
    const repo = new MemoryRepo();
    const project = repo.addProject();
    const provider = new ScriptedProvider(() => [{ type: "text", text: "Half an answer" }]);
    const events = await collect(
      runChatTurn({ repo, provider, background: new FakeBackground() }, { projectId: project.id, speaker: "Amar", text: "Hi" }),
    );
    expect(events.at(-1)).toMatchObject({ type: "error" });
    expect(repo.messages[1]).toMatchObject({ role: "assistant", content: "Half an answer" });
  });
});
