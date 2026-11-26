import { describe, expect, it } from "vitest";
import { BLOCK_ORDER, CHANNEL_BLOCK, DATE_BLOCK, assemblePrompt, dateBlock } from "@/lib/ask/prompt";
import { COMPANIONS } from "@/lib/companions";
import { textChannelNotes } from "@/lib/sms/handoff";

const turns = [{ role: "user" as const, text: "What should we do this Thanksgiving?" }];

describe("today's date for every advisor (an approved factual-grounding exception)", () => {
  it("states the date and time in Cinq's home time zone, and that the person may be elsewhere", () => {
    // 2026-11-26 19:40 UTC is 1:40 PM in Austin.
    expect(dateBlock(new Date(Date.UTC(2026, 10, 26, 19, 40))).body).toBe(
      "Today is Thursday, November 26, 2026, 1:40 PM in Austin, Texas (US Central time). The person may be in another time zone. Something dated in an earlier year, such as an event, a season's schedule, an opening or a price, is not evidence of what is happening now.",
    );
  });

  it("follows daylight saving time", () => {
    // 2026-07-04 17:00 UTC is noon CDT.
    expect(dateBlock(new Date(Date.UTC(2026, 6, 4, 17, 0))).body).toContain("Saturday, July 4, 2026, 12:00 PM");
  });

  it("is the last block, on the website and by text, and never cached", () => {
    const now = new Date(Date.UTC(2026, 10, 26, 19, 40));
    for (const companion of Object.values(COMPANIONS).filter((c) => !c.retired)) {
      const web = assemblePrompt({ companion, turns, now });
      expect(web.system.map((b) => b.label)).toEqual([...BLOCK_ORDER, DATE_BLOCK]);
      expect(web.system.at(-1)!.cacheable).toBe(false);
      const text = assemblePrompt({ companion, turns, now, channel: textChannelNotes(companion.id as never, undefined, [], 450) });
      expect(text.system.map((b) => b.label)).toEqual([...BLOCK_ORDER, CHANNEL_BLOCK, DATE_BLOCK]);
    }
  });

  it("changes nothing else: every other block, word for word, and the conversation", () => {
    const now = new Date(Date.UTC(2026, 10, 26, 19, 40));
    for (const companion of Object.values(COMPANIONS).filter((c) => !c.retired)) {
      const without = assemblePrompt({ companion, turns });
      const withDate = assemblePrompt({ companion, turns, now });
      expect(withDate.system.slice(0, -1)).toEqual(without.system);
      expect(withDate.messages).toEqual(without.messages);
      expect(withDate.webSearch).toBe(without.webSearch);
    }
  });

  it("says nothing about how to advise: only the date, the time zone and what counts as current", () => {
    const body = dateBlock(new Date()).body;
    expect(body).not.toMatch(/\b(recommend|should|tone|voice|answer|brief|concise)\b/i);
  });
});
