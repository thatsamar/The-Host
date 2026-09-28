// Offline stand-in for the Anthropic Messages API and the Voyage embeddings
// API, for clicking through the UI without spending tokens. NOT used in
// production.
//
//   node scripts/dev/mock-anthropic.mjs            # listens on :4010
//   ANTHROPIC_BASE_URL=http://127.0.0.1:4010 VOYAGE_BASE_URL=http://127.0.0.1:4010/v1 VOYAGE_API_KEY=mock npm run dev
//
// Embeddings are a deterministic bag-of-words hash, so retrieval behaves
// plausibly: questions that share words with a document find it.
// Streams a canned Gio-style answer that echoes the speaker line and the
// labeled context blocks it received. Messages containing "find" or "buy"
// also stream a web_search tool call and a result, like the real API.
import http from "node:http";

const PORT = Number(process.env.MOCK_ANTHROPIC_PORT ?? 4010);

function sse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`);
}

function lastUserText(body) {
  const last = [...body.messages].reverse().find((m) => m.role === "user");
  const parts = typeof last.content === "string" ? [{ type: "text", text: last.content }] : last.content;
  return parts.filter((p) => p.type === "text").map((p) => p.text).join("\n");
}

function embed(text, dim) {
  const v = new Array(dim).fill(0);
  for (const word of text.toLowerCase().match(/[a-z]{3,}/g) ?? []) {
    let h = 2166136261;
    for (const ch of word) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    v[h % dim] += 1;
  }
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}

function answerFor(body) {
  const text = lastUserText(body);
  const speaker = (text.match(/^Speaker: (.*)$/m) ?? [])[1] ?? "unknown";
  const system = Array.isArray(body.system) ? body.system : [{ text: body.system ?? "" }];
  const labels = system.slice(1).map((b) => (b.text.match(/^<([a-z_]+)>/) ?? [])[1]).filter(Boolean);
  const images = body.messages.at(-1).content.filter?.((p) => p.type === "image").length ?? 0;
  const refs = system.find((b) => b.text.startsWith("<retrieved_references>"))?.text ?? "";
  const files = [...refs.matchAll(/file: ([^·\n]+)/g)].map((m) => m[1].trim());
  return [
    "**THE CALL** — Mock Gio heard you.",
    "",
    `**WHY** — Speaker was *${speaker}*. Context blocks: ${labels.join(" → ")}. Images this turn: ${images}. References: ${files.length ? files.join(", ") : "none"}.`,
    "",
    "**THE MOVE** — This is the offline mock server; point ANTHROPIC_BASE_URL away from it for the real Gio.",
    "",
    "**NEXT STEP** — Ask again.",
  ].join("\n");
}

const server = http.createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  if (req.method === "POST" && req.url.startsWith("/v1/embeddings")) {
    const dim = body.output_dimension ?? 1024;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ object: "list", data: body.input.map((t, index) => ({ object: "embedding", index, embedding: embed(t, dim) })), model: body.model, usage: { total_tokens: 1 } }));
    return;
  }
  if (req.method !== "POST" || !req.url.startsWith("/v1/messages")) {
    res.writeHead(404).end();
    return;
  }

  if (!body.stream) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: "msg_mock",
        type: "message",
        role: "assistant",
        model: body.model,
        content: [
          {
            type: "text",
            text: body.messages[0].content.some?.((p) => p.type === "image")
              ? "Subject: mock description of a warm lounge. Materials: walnut, plaster, linen. Lighting: low lamplight at dusk. Sense of place: high desert."
              : "Mock Conversation Title",
          },
        ],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 4 },
      }),
    );
    return;
  }

  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  sse(res, "message_start", {
    message: {
      id: "msg_mock",
      type: "message",
      role: "assistant",
      model: body.model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 1200, output_tokens: 0 },
    },
  });
  let index = 0;
  const wantsSearch = /\b(find|buy)\b/i.test(lastUserText(body)) && body.tools?.length;
  if (wantsSearch) {
    sse(res, "content_block_start", { index, content_block: { type: "server_tool_use", id: "srvtoolu_mock", name: "web_search", input: {} } });
    sse(res, "content_block_delta", { index, delta: { type: "input_json_delta", partial_json: '{"query": "vintage lounge chair under 2000"}' } });
    sse(res, "content_block_stop", { index });
    index++;
    sse(res, "content_block_start", {
      index,
      content_block: {
        type: "web_search_tool_result",
        tool_use_id: "srvtoolu_mock",
        content: [
          { type: "web_search_result", title: "Mock listing — Danish lounge chair", url: "https://example.com/listing", encrypted_content: "x", page_age: null },
        ],
      },
    });
    sse(res, "content_block_stop", { index });
    index++;
  }
  sse(res, "content_block_start", { index, content_block: { type: "text", text: "" } });
  const answer = answerFor(body);
  for (const piece of answer.match(/[\s\S]{1,12}/g)) {
    sse(res, "content_block_delta", { index, delta: { type: "text_delta", text: piece } });
    await new Promise((r) => setTimeout(r, 15));
  }
  sse(res, "content_block_stop", { index });
  sse(res, "message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 120 } });
  sse(res, "message_stop", {});
  res.end();
});

server.listen(PORT, () => console.log(`mock Anthropic API on http://127.0.0.1:${PORT}`));
