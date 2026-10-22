// Local harness for Cinq's messaging channel. Type messages as the person
// would; see what Cinq would send back. Everything here is a fixture: the
// provider is Cinq's own test adapter (not Apple's or any provider's format)
// and every advisor reply is a labeled placeholder. No model is called and
// nothing leaves this machine.
//
//   npm run messages:harness
//
// Commands as the person: advisors, reset, help, a name ("Amar"), "Amar: ...".
// Harness commands: /photo (attach a sample PNG to the next message),
// /end (the person closes the conversation), /later <hours> (move the clock).

import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import { createChannel } from "@/lib/channel/service";
import { FixtureAdapter, fixtureEngine } from "@/lib/channel/fixture";
import { MemoryStore } from "@/lib/channel/memory-store";
import { retention } from "@/lib/channel/retention";
import type { InboundEvent, InboundPayload } from "@/lib/channel/types";

const SAMPLE_PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

const clock = { t: Date.now() };
const adapter = new FixtureAdapter({ secret: "local-harness-only", support: { status: "unavailable" } });
adapter.attachments.set("sample-photo", SAMPLE_PNG);
const channel = createChannel({ adapter, store: new MemoryStore(retention()), engine: fixtureEngine(), now: () => clock.t });

// Logs are codes and counts; keep them out of the way.
console.info = () => {};

let n = 0;
let photo = false;
async function send(payload: InboundPayload) {
  const event: InboundEvent = { id: `local-${++n}`, conversationId: "local-conversation", sentAt: clock.t, payload };
  const rawBody = JSON.stringify({ events: [event] });
  const before = adapter.sent.length;
  const res = await channel.handleWebhook({ headers: new Headers({ "x-fixture-signature": adapter.sign(rawBody) }), rawBody });
  await res.background;
  for (const { message } of adapter.sent.slice(before)) {
    if (message.kind === "text") stdout.write(`\nCinq › ${message.text.replace(/\n/g, "\n       ")}\n`);
    else stdout.write(`\nCinq › [${message.prompt}] ${message.options.map((o, i) => `${i + 1}. ${o.title} / ${o.subtitle}`).join("   ")}\n`);
  }
}

stdout.write("Cinq messaging harness. FIXTURE ONLY: no model, no provider. Type a message, or /photo, /end, /later <hours>, /quit.\n");
const rl = createInterface({ input: stdin });
stdout.write("\nYou  › ");
for await (const raw of rl) {
  const line = raw.trim();
  if (line === "/quit") break;
  clock.t += 1000;
  if (line === "/photo") {
    photo = true;
    stdout.write("(A sample photo will go with your next message.)\n");
  } else if (line === "/end") await send({ kind: "conversation_end" });
  else if (line.startsWith("/later")) {
    clock.t += Number(line.split(/\s+/)[1] || 0) * 3_600_000;
    stdout.write("(Clock moved.)\n");
  } else {
    const picked = /^[1-5]$/.test(line) ? ["tony", "martini", "gio", "alden", "goldie"][Number(line) - 1] : undefined;
    await send({ kind: "message", text: picked ? "" : line, attachments: photo ? [{ ref: "sample-photo" }] : [], selection: picked });
    photo = false;
  }
  stdout.write("\nYou  › ");
}
rl.close();
