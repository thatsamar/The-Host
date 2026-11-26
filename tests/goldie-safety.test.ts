import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { COMPANIONS } from "@/lib/companions";
import { GOLDIE_SAFETY } from "@/lib/companions/goldie";
import { UNTANGLED_SYSTEM_PROMPT } from "@/lib/companions/untangled-prompt";
import { regionOf, textChannelNotes } from "@/lib/sms/handoff";
import { processSms, type SmsDeps } from "@/lib/sms/handler";
import { MemorySmsStore } from "@/lib/sms/store";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

describe("Goldie's safety boundary (an approved narrow exception)", () => {
  it("leaves her brief exactly as written", () => {
    // The fingerprint of her brief as approved (with her influences); any change to it must be deliberate.
    expect(sha(UNTANGLED_SYSTEM_PROMPT)).toBe(SHA_OF_BRIEF);
    expect(UNTANGLED_SYSTEM_PROMPT).not.toContain("988");
  });

  it("sits in her capabilities, just before the circle of advisors", () => {
    const caps = COMPANIONS.goldie.capabilities(false);
    expect(caps.at(-2)).toBe(GOLDIE_SAFETY);
    expect(caps.at(-1)).toMatch(/^You are one of Cinq's five advisors/);
  });

  it("gives the emergency numbers for where the person is", () => {
    expect(GOLDIE_SAFETY).toContain("In the US and Canada that is 911 for an emergency and, for thoughts of suicide or a mental-health crisis, 988 (call or text)");
    expect(GOLDIE_SAFETY).toContain("in the UK, 999 or Samaritans on 116 123");
    expect(GOLDIE_SAFETY).toContain("in most of Europe, 112");
    expect(GOLDIE_SAFETY).toContain("If you don't know where they are");
  });

  it("is proportionate: ordinary conversations stay ordinary, and she is no substitute for care", () => {
    expect(GOLDIE_SAFETY).toContain("Only when someone tells you about a genuine risk");
    expect(GOLDIE_SAFETY).toContain("Ordinary stress, conflict, grief, frustration or sadness is not a crisis: never add hotline numbers, clinical language or a referral");
    expect(GOLDIE_SAFETY).toContain("never present yourself as a substitute for one");
    expect(GOLDIE_SAFETY).toContain("rather than becoming the only place they bring things");
  });

  it("changes no other advisor", () => {
    for (const id of ["tony", "martini", "gio", "alden"] as const) {
      const all = [COMPANIONS[id].systemPrompt, ...COMPANIONS[id].capabilities(true)].join("\n");
      expect(all, id).not.toMatch(/988|116 123|genuine risk to their safety/);
    }
  });

  it("tells only Goldie, by text, that a +1 number is in the US or Canada", () => {
    expect(regionOf("+15551234567")).toBe("us-canada");
    expect(regionOf("+447700900123")).toBeUndefined();
    expect(textChannelNotes("goldie", undefined, [], 450, "us-canada").body).toContain("This person is texting from a US or Canadian number.");
    expect(textChannelNotes("goldie", undefined, [], 450).body).not.toContain("US or Canadian number");
    expect(textChannelNotes("tony", undefined, [], 450, "us-canada").body).not.toContain("US or Canadian number");
  });

  it("passes the region from the number into the answer, and nothing else about it", async () => {
    const contexts: unknown[] = [];
    const deps: SmsDeps = { store: new MemorySmsStore(), ask: async (_id, _turns, context) => (contexts.push(context), "I hear you.") };
    for (const [from, sid] of [["+15550001234", "a"], ["+447700900123", "b"]] as const) {
      await processSms({ from, body: "START", media: [], messageSid: `${sid}1` }, deps);
      await processSms({ from, body: "5", media: [], messageSid: `${sid}2` }, deps);
      await processSms({ from, body: "My cofounder and I keep fighting.", media: [], messageSid: `${sid}3` }, deps);
    }
    expect((contexts[0] as { region?: string }).region).toBe("us-canada");
    expect((contexts[1] as { region?: string }).region).toBeUndefined();
    expect(JSON.stringify(contexts)).not.toMatch(/5550001234|7700900123/);
  });
});

const SHA_OF_BRIEF = "1d29cbab2bb8e98df2f3343729febc2881e7d6075cb1b5df0d1754b42af57574";
