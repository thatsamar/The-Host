import { describe, expect, it } from "vitest";
import { decide } from "@/lib/channel/router";
import { lineup } from "@/lib/channel/copy";
import * as copy from "@/lib/channel/copy";
import { readOfferReply, summarize } from "@/lib/channel/handoff";
import { newSession, type Session } from "@/lib/channel/types";

const L = lineup();
const msg = (text: string) => ({ text, attachments: [] });
const PHOTO = { mediaType: "image/jpeg", data: "c21hbGwtcGhvdG8=" };

/** Someone who has talked with Amar, photo included, and now switches to Alden. */
function withAmar(): Session {
  return {
    ...newSession(),
    welcomed: true,
    active: "tony",
    introduced: ["tony"],
    histories: {
      tony: [
        { role: "user", text: "Anniversary dinner in Lisbon on Saturday, somewhere with a view", images: [PHOTO] },
        { role: "assistant", text: "**Book Feitoria** for the tasting menu. Ask for the window table. Then walk to the miradouro." },
      ],
    },
  };
}

const textOf = (d: ReturnType<typeof decide>) => d.replies.map((r) => (r.kind === "text" ? r.text : "[picker]")).join("\n");

describe("sharing a summary when switching advisors", () => {
  it("offers, in the switch message, and shares nothing by default", () => {
    const switched = decide(withAmar(), msg("Alden"), L);
    expect(textOf(switched)).toContain("Would you like me to share a short summary with Alden?");
    expect(switched.session?.offer).toEqual({ from: "tony", to: "alden" });
    // The person just asks Alden something: the offer lapses and Alden's conversation stays empty.
    const asked = decide(switched.session!, msg("What should we drink with the tasting menu?"), L);
    expect(asked.ask).toMatchObject({ advisor: "alden", text: "What should we drink with the tasting menu?" });
    expect(asked.session?.offer).toBeUndefined();
    expect(asked.session?.histories.alden).toBeUndefined();
  });

  it("shows the exact summary first, then shares it only on an explicit reply, without photos", () => {
    const switched = decide(withAmar(), msg("Alden"), L);
    const shown = decide(switched.session!, msg("yes"), L);
    const summary = summarize("tony", withAmar().histories.tony!);
    expect(textOf(shown)).toBe(copy.summaryPreview("alden", "tony", summary, 1));
    expect(textOf(shown)).toContain("they stay out unless you reply share with photos");
    expect(shown.session?.histories.alden).toBeUndefined();

    const shared = decide(shown.session!, msg("share"), L);
    expect(textOf(shared)).toBe(copy.shared("alden", false));
    const turn = shared.session!.histories.alden![0];
    expect(turn.role).toBe("user");
    expect(turn.text).toContain(summary);
    expect(turn.images).toBeUndefined();
    // Amar's own conversation is untouched.
    expect(shared.session!.histories.tony).toEqual(withAmar().histories.tony);
  });

  it("includes photos only when the person says so", () => {
    let s = decide(withAmar(), msg("Alden"), L).session!;
    s = decide(s, msg("yes"), L).session!;
    const shared = decide(s, msg("share with photos"), L);
    expect(shared.session!.histories.alden![0].images).toEqual([PHOTO]);
    expect(textOf(shared)).toBe(copy.shared("alden", true));
  });

  it("never shares before showing, and a no or a new question ends the offer", () => {
    const s = decide(withAmar(), msg("Alden"), L).session!;
    const early = decide(s, msg("share"), L);
    expect(early.session?.histories.alden).toBeUndefined();
    expect(textOf(early)).toMatch(/^Here's what I'd share with Alden/);
    const no = decide(early.session!, msg("no thanks"), L);
    expect(textOf(no)).toBe(copy.NOT_SHARED);
    expect(no.session?.offer).toBeUndefined();
    expect(no.session?.histories.alden).toBeUndefined();
  });

  it("makes no offer when there's nothing to carry over, or when a question comes with the switch", () => {
    expect(decide(newSession(), msg("Alden"), L).session?.offer).toBeUndefined();
    const direct = decide(withAmar(), msg("Alden: a wine for the tasting menu?"), L);
    expect(direct.session?.offer).toBeUndefined();
    expect(direct.ask).toMatchObject({ advisor: "alden" });
  });

  it("builds the summary from what was said, briefly, with no Markdown", () => {
    const summary = summarize("tony", withAmar().histories.tony!);
    expect(summary).toBe(
      [
        "From my conversation with Amar (Travel):",
        "What I asked:\n• Anniversary dinner in Lisbon on Saturday, somewhere with a view (with 1 photo)",
        "Amar's latest reply, in short: Book Feitoria for the tasting menu. Ask for the window table. Then walk to the miradouro.",
      ].join("\n\n"),
    );
    expect(readOfferReply("Yes please")).toBe("show");
    expect(readOfferReply("Share it.")).toBe("share");
    expect(readOfferReply("what about red?")).toBe("other");
  });
});
