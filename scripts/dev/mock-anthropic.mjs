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

// Structured-output requests (memory extraction, command-button drafts):
// deterministic JSON shaped by the requested schema.
function structuredFor(body) {
  const props = body.output_config.format.schema?.properties ?? {};
  const prompt = body.messages[0].content.map?.((p) => p.text ?? "").join("\n") ?? String(body.messages[0].content);
  if (props.memories && props.decisions && /Message \d+ from /.test(prompt)) {
    // Imported conversation: numbered messages.
    const memories = [];
    const decisions = [];
    for (const m of prompt.matchAll(/Message (\d+) from ([^:]+):\n"""([\s\S]*?)"""/g)) {
      const index = Number(m[1]);
      const holder = m[2].includes(" and ") ? "Both" : m[2];
      for (const sentence of m[3].split(/(?<=[.!?])\s+/)) {
        const s = sentence.replace(/[.!?]+$/, "").trim();
        if (/\b(love|hate|prefer)\b/i.test(s)) {
          memories.push({ message: index, type: "shared_preference", content: `${holder === "Both" ? "Courtney and Amar" : holder}: ${s}.`, holder, scope: "household", evidence: s });
        }
        if (/\blet's (do|go with)\b/i.test(s)) {
          decisions.push({ message: index, title: s.replace(/^.*let's (do|go with)\s*/i, "Go with "), detail: "From an imported conversation.", status: "approved", evidence: s });
        }
      }
    }
    return { memories, decisions };
  }
  if (props.memories && props.decisions) {
    const m = prompt.match(/Message from ([^:]+):\n"""([\s\S]*?)"""/);
    const speaker = m?.[1].startsWith("Both") ? "Both" : (m?.[1] ?? "Both");
    const text = m?.[2] ?? "";
    const memories = [];
    const decisions = [];
    for (const sentence of text.split(/(?<=[.!?])\s+/)) {
      const s = sentence.replace(/[.!?]+$/, "").trim();
      if (/\b(love|hate|prefer|can't stand)\b/i.test(s)) {
        const holder = speaker === "Both" ? "Both" : speaker;
        memories.push({
          type: holder === "Courtney" ? "courtney_preference" : holder === "Amar" ? "amar_preference" : "shared_preference",
          content: `${holder === "Both" ? "Courtney and Amar" : holder}: ${s}.`,
          holder,
          scope: "household",
          evidence: s,
        });
      }
      if (/\blet's (do|go with)\b/i.test(s)) {
        decisions.push({ title: s.replace(/^.*let's (do|go with)\s*/i, "Go with "), detail: "Agreed in conversation.", status: "approved", evidence: s });
      }
    }
    return { memories, decisions };
  }
  if (props.product) {
    return {
      title: "Reading corner lounge chair",
      detail: "Mock draft from the message.",
      status: "approved",
      product: {
        name: "Danish teak lounge chair",
        designer: "Possibly Grete Jalk",
        vendor: null,
        url: "https://example.com/listing",
        dimensions: '28"W x 30"D x 29"H',
        material_color: "Teak, oatmeal wool",
        provenance: "vintage",
        price_amount: 1800,
        price_currency: "USD",
        price_basis: "sourced",
        price_source_url: "https://example.com/listing",
        placement: "Reading corner, angled to the window",
        rationale: "Low, warm, and light enough to move.",
        verdict: "invest",
      },
    };
  }
  if (props.holder && props.type) {
    const who = (prompt.match(/The person saving this is ([A-Za-z]+)/) ?? [])[1] ?? "Courtney";
    const holder = who === "Courtney" || who === "Amar" ? who : "Both";
    return { type: "shared_preference", content: "Pools of warm lamplight over overhead light.", holder, scope: "household" };
  }
  return {};
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

  if (!body.stream && body.output_config?.format) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: "msg_mock",
        type: "message",
        role: "assistant",
        model: body.model,
        content: [{ type: "text", text: JSON.stringify(structuredFor(body)) }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
    );
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
