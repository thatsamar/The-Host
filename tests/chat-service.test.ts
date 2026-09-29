import { describe, expect, it } from "vitest";
import type { ChatContentPart } from "@/lib/ai/types";
import { ChatInputError, dedupeSources, errorMessage, fallbackTitle, runChatTurn, type ChatServerEvent } from "@/lib/chat/service";
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
          retrieve: async () => [
            { chunkId: "c1", fileId: "f1", similarity: 0.61, fileName: "ponti.pdf", content: "Lightness", sourceType: "text" },
          ],
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

  it("reports provider failures as an error event and keeps the error with the chat", async () => {
    const { repo, project } = setup();
    const provider = new ScriptedProvider(() => new Error("overloaded"));
    const events = await collect(
      runChatTurn({ repo, provider, background: new FakeBackground() }, { projectId: project.id, speaker: "Amar", text: "Hi" }),
    );
    expect(events.at(-1)).toEqual({ type: "error", message: "overloaded" });
    // The failed reply is saved empty, with its error, so it survives a reload.
    expect(repo.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(repo.messages[1]).toMatchObject({ content: "", metadata: { error: "overloaded", stop_reason: "error" } });
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

describe("photos and references", () => {
  const loadImage = async (path: string) => ({ mediaType: "image/jpeg", data: `b64:${path}` });

  it("sends attached photos to the model, stores them as image assets under the project and room, and links them", async () => {
    const { repo, project, room } = setup();
    const provider = new ScriptedProvider(replyWith("THE CALL — Lower the pendant."));
    const events = await collect(
      runChatTurn(
        { repo, provider, background: new FakeBackground(), loadImage },
        {
          projectId: project.id,
          roomId: room.id,
          speaker: "Courtney",
          text: "",
          attachments: [{ storagePath: "u/chat/a.jpg", mimeType: "image/jpeg", name: "IMG_1.jpg" }],
        },
      ),
    );
    const parts = provider.requests[0].messages.at(-1)!.content;
    expect(parts[0]).toEqual({ type: "image", mediaType: "image/jpeg", data: "b64:u/chat/a.jpg" });
    expect(parts[1]).toEqual({ type: "text", text: "Speaker: Courtney\n\n(Photo attached, no message.)" });

    expect(repo.imageAssets).toHaveLength(1);
    const asset = repo.imageAssets[0];
    const userMessage = repo.messages[0];
    expect(asset).toMatchObject({ projectId: project.id, roomId: room.id, messageId: userMessage.id });
    expect(userMessage.attachments).toEqual([
      { image_asset_id: asset.id, storage_path: "u/chat/a.jpg", mime_type: "image/jpeg", name: "IMG_1.jpg" },
    ]);
    expect((events[0] as Extract<ChatServerEvent, { type: "meta" }>).userMessage.attachments).toHaveLength(1);
  });

  it("re-sends recent earlier photos so follow-ups can see them", async () => {
    const { repo, project } = setup();
    const background = new FakeBackground();
    const first = await collect(
      runChatTurn(
        { repo, provider: new ScriptedProvider(replyWith("Nice room.")), background, loadImage },
        { projectId: project.id, speaker: "Amar", text: "Our hallway", attachments: [{ storagePath: "u/chat/h.jpg", mimeType: "image/jpeg" }] },
      ),
    );
    const chatId = (first[0] as Extract<ChatServerEvent, { type: "meta" }>).chatId;
    const provider = new ScriptedProvider(replyWith("Move the bench."));
    await collect(
      runChatTurn({ repo, provider, background, loadImage }, { chatId, projectId: project.id, speaker: "Amar", text: "And the bench?" }),
    );
    const firstTurn = provider.requests[0].messages[0].content;
    expect(firstTurn[0]).toEqual({ type: "image", mediaType: "image/jpeg", data: "b64:u/chat/h.jpg" });
  });

  it("rejects attachments when photo loading isn't available, and too many photos", async () => {
    const { repo, project } = setup();
    const deps = { repo, provider: new ScriptedProvider(replyWith("x")), background: new FakeBackground() };
    await expect(
      collect(runChatTurn(deps, { projectId: project.id, speaker: "Both", text: "hi", attachments: [{ storagePath: "p", mimeType: "image/jpeg" }] })),
    ).rejects.toThrow(ChatInputError);
    const seven = Array.from({ length: 7 }, (_, i) => ({ storagePath: `p${i}`, mimeType: "image/jpeg" }));
    await expect(
      collect(runChatTurn({ ...deps, loadImage }, { projectId: project.id, speaker: "Both", text: "hi", attachments: seven })),
    ).rejects.toThrow(/at most 6/);
    expect(repo.messages).toHaveLength(0);
  });

  it("records which references were used on the assistant message", async () => {
    const { repo, project } = setup();
    await collect(
      runChatTurn(
        {
          repo,
          provider: new ScriptedProvider(replyWith("ok")),
          background: new FakeBackground(),
          retrieve: async () => [
            { chunkId: "c1", fileId: "f1", similarity: 0.61234, fileName: "ponti.pdf", page: 4, content: "x", sourceType: "text" },
            {
              chunkId: "c2",
              fileId: "f2",
              similarity: 0.5,
              fileName: "lounge.jpg",
              content: "y",
              sourceType: "visual_description",
              image: { mediaType: "image/jpeg", data: "z" },
            },
          ],
        },
        { projectId: project.id, speaker: "Both", text: "Chairs please" },
      ),
    );
    expect(repo.messages[1].metadata.references).toEqual([
      { file_name: "ponti.pdf", file_id: "f1", page: 4, source_type: "text", similarity: 0.612, with_image: false },
      { file_name: "lounge.jpg", file_id: "f2", page: null, source_type: "visual_description", similarity: 0.5, with_image: true },
    ]);
  });

  it("still answers when retrieval fails, and notes the failure", async () => {
    const { repo, project } = setup();
    const provider = new ScriptedProvider(replyWith("ok"));
    const events = await collect(
      runChatTurn(
        {
          repo,
          provider,
          background: new FakeBackground(),
          retrieve: async () => {
            throw new Error("Voyage down");
          },
        },
        { projectId: project.id, speaker: "Both", text: "Chairs please" },
      ),
    );
    expect(events.map((e) => e.type)).toContain("done");
    expect(repo.messages[1].metadata.retrieval_error).toBe("Voyage down");
    expect(provider.requests[0].system.find((b) => b.label === "retrieved_references")!.body).toMatch(/No references/);
  });

  it("uses the previous message to retrieve for a short follow-up", async () => {
    const { repo, project } = setup();
    const queries: string[] = [];
    const retrieve = async (q: string) => {
      queries.push(q);
      return [];
    };
    const background = new FakeBackground();
    const first = await collect(
      runChatTurn(
        { repo, provider: new ScriptedProvider(replyWith("a")), background, retrieve },
        { projectId: project.id, speaker: "Both", text: "Compare the Wegner and Juhl lounge chairs for the study" },
      ),
    );
    const chatId = (first[0] as Extract<ChatServerEvent, { type: "meta" }>).chatId;
    await collect(
      runChatTurn(
        { repo, provider: new ScriptedProvider(replyWith("b")), background, retrieve },
        { chatId, projectId: project.id, speaker: "Both", text: "Which is warmer?" },
      ),
    );
    expect(queries[1]).toBe("Compare the Wegner and Juhl lounge chairs for the study\n\nWhich is warmer?");
  });
});

describe("memory proposals and modes", () => {
  it("proposes memories and decisions after the reply, linked to the user's message", async () => {
    const { repo, project, room } = setup();
    const background = new FakeBackground("Velvet vs Linen");
    background.extraction = {
      memories: [
        { type: "amar_preference", content: "Amar loves green velvet.", holder: "Amar", scope: "household", evidence: "I want the green velvet" },
        { type: "amar_preference", content: "Gio's advice", holder: "Amar", scope: "project", evidence: "olive mohair" },
      ],
      decisions: [],
    };
    const events = await collect(
      runChatTurn(
        { repo, provider: new ScriptedProvider(replyWith("THE CALL — olive mohair.")), background },
        { projectId: project.id, roomId: room.id, speaker: "Amar", text: "I want the green velvet." },
      ),
    );
    expect(events.map((e) => e.type).slice(-3)).toEqual(["done", "title", "proposals"]);
    expect(events.at(-1)).toEqual({ type: "proposals", memories: 1, decisions: 0 });
    expect(repo.proposals).toHaveLength(1);
    expect(repo.proposals[0]).toMatchObject({
      projectId: project.id,
      roomId: room.id,
      sourceMessageId: repo.messages[0].id,
      memories: [{ type: "amar_preference", content: "Amar loves green velvet.", attributedTo: "Amar", scope: "household" }],
    });
    expect(background.extractCalls[0].text).toContain("THE CALL — olive mohair.");
    expect(repo.messages[1].metadata.proposals).toEqual({ memories: 1, decisions: 0 });
  });

  it("an extraction failure never breaks the reply", async () => {
    const { repo, project } = setup();
    const background = new FakeBackground();
    background.extraction = new Error("haiku down");
    const events = await collect(
      runChatTurn({ repo, provider: new ScriptedProvider(replyWith("ok")), background }, { projectId: project.id, speaker: "Both", text: "Hello there" }),
    );
    expect(events.map((e) => e.type)).toContain("done");
    expect(events.map((e) => e.type)).not.toContain("error");
    expect(repo.proposals).toHaveLength(0);
  });

  it("can be turned off", async () => {
    const { repo, project } = setup();
    const background = new FakeBackground();
    await collect(
      runChatTurn(
        { repo, provider: new ScriptedProvider(replyWith("ok")), background, proposeMemories: false },
        { projectId: project.id, speaker: "Both", text: "Hello there" },
      ),
    );
    expect(background.extractCalls).toHaveLength(0);
  });

  it("stores a command mode on the message and replays it in later turns", async () => {
    const { repo, project } = setup();
    const background = new FakeBackground();
    const provider = new ScriptedProvider(replyWith("1. Juhl. 2. Wegner. Winner: Juhl."));
    const first = await collect(
      runChatTurn({ repo, provider, background }, { projectId: project.id, speaker: "Both", text: "Juhl 45 vs Wegner CH25", mode: "compare" }),
    );
    expect(repo.messages[0].metadata.mode).toBe("compare");
    expect(textOf(provider.requests[0].messages.at(-1)!.content)).toMatch(/^Speaker: Both \(Courtney and Amar together\)\nRequest: Compare options\. Comparison mode\. Rank every option/);

    const chatId = (first[0] as Extract<ChatServerEvent, { type: "meta" }>).chatId;
    const next = new ScriptedProvider(replyWith("ok"));
    await collect(runChatTurn({ repo, provider: next, background }, { chatId, projectId: project.id, speaker: "Amar", text: "Why the Juhl?" }));
    expect(textOf(next.requests[0].messages[0].content)).toContain("Request: Compare options.");
    expect(textOf(next.requests[0].messages.at(-1)!.content)).not.toContain("Request:");
  });

  it("includes every approved memory when there are few, and the most relevant when there are many", async () => {
    const { repo, project } = setup();
    const base = { room_id: null, source_message_id: null, created_at: "", attributed_to: null, review_state: "approved" as const };
    for (let i = 0; i < 60; i++) {
      repo.memories.push({ ...base, id: `m${i}`, project_id: project.id, type: "material", content: `Memory number ${i}` });
    }
    const ranked: string[] = [];
    const provider = new ScriptedProvider(replyWith("ok"));
    await collect(
      runChatTurn(
        {
          repo,
          provider,
          background: new FakeBackground(),
          rankMemories: async (query) => {
            ranked.push(query);
            return ["m3", "m7", "nonexistent"];
          },
        },
        { projectId: project.id, speaker: "Both", text: "What about the oak?" },
      ),
    );
    expect(ranked).toEqual(["What about the oak?"]);
    const body = provider.requests[0].system.find((b) => b.label === "memories")!.body;
    const included = body.match(/Memory number \d+/g)!;
    expect(included).toHaveLength(40);
    expect(body).toContain("Memory number 3\n");
    expect(body).toContain("Memory number 7\n");
    expect(body).toContain("Memory number 59");
    expect(body).not.toContain("Memory number 10\n");
  });
});

describe("errorMessage", () => {
  const apiError = (status: number, message: string) => Object.assign(new Error(message), { status });
  it("names the fix for common Anthropic failures", () => {
    expect(errorMessage(apiError(401, "invalid x-api-key"))).toMatch(/ANTHROPIC_API_KEY/);
    expect(errorMessage(apiError(400, "Your credit balance is too low to access the Anthropic API."))).toMatch(/out of credit/);
    expect(errorMessage(apiError(404, "model: nope"))).toMatch(/GIO_CHAT_MODEL/);
    expect(errorMessage(apiError(500, "boom"))).toBe("boom");
  });
});
