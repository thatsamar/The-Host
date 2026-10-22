import { describe, expect, it } from "vitest";
import { decide, parseIntent } from "@/lib/channel/router";
import { lineup, welcome } from "@/lib/channel/copy";
import { newSession, type Session } from "@/lib/channel/types";

const L = lineup();
const msg = (text: string, extra: Partial<{ attachments: { ref: string }[]; selection: string }> = {}) => ({ text, attachments: [], ...extra });

describe("reading a message", () => {
  it("knows the commands, exactly", () => {
    expect(parseIntent("advisors", undefined, L)).toEqual({ kind: "command", command: "advisors" });
    expect(parseIntent(" Reset. ", undefined, L)).toEqual({ kind: "command", command: "reset" });
    expect(parseIntent("HELP!", undefined, L)).toEqual({ kind: "command", command: "help" });
    expect(parseIntent("help me plan Lisbon", undefined, L)).toEqual({ kind: "question", text: "help me plan Lisbon" });
  });

  it("goes straight to a named advisor, with or without a question", () => {
    expect(parseIntent("Amar: one night in Bangkok", undefined, L)).toEqual({ kind: "choose", advisor: "tony", question: "one night in Bangkok" });
    expect(parseIntent("goldie, my cofounder wants out", undefined, L)).toEqual({ kind: "choose", advisor: "goldie", question: "my cofounder wants out" });
    expect(parseIntent("Martine", undefined, L)).toEqual({ kind: "choose", advisor: "martini", question: "" });
    expect(parseIntent("Drinks", undefined, L)).toEqual({ kind: "choose", advisor: "alden", question: "" });
    expect(parseIntent("", "gio", L)).toEqual({ kind: "choose", advisor: "gio", question: "" });
    // A name later in the sentence is just part of the question.
    expect(parseIntent("What would Amar think of Lisbon?", undefined, L).kind).toBe("question");
  });

  it("never routes to a retired advisor", () => {
    expect(parseIntent("Jack: a martini", undefined, L).kind).toBe("question");
    expect(parseIntent("", "jack", L).kind).toBe("question");
  });
});

describe("deciding who answers", () => {
  it("welcomes once, with the picker, and keeps a question asked before choosing", () => {
    const first = decide(newSession(), msg("One night in Bangkok"), L);
    expect(first.ask).toBeUndefined();
    expect(first.replies[0]).toEqual({ kind: "text", text: welcome(true) });
    expect(first.replies[1]).toMatchObject({ kind: "picker", options: [{ id: "tony", title: "Amar", subtitle: "Travel" }, { id: "martini" }, { id: "gio" }, { id: "alden" }, { id: "goldie" }] });
    expect(first.session?.pending?.text).toBe("One night in Bangkok");

    const again = decide(first.session!, msg("Somewhere with live music"), L);
    expect(again.replies).toHaveLength(1);
    expect(again.replies[0].kind).toBe("text");

    const chosen = decide(again.session!, msg("", { selection: "tony" }), L);
    expect(chosen.ask).toEqual({ advisor: "tony", text: "One night in Bangkok\n\nSomewhere with live music", attachments: [], introduce: true });
    expect(chosen.session?.pending).toBeUndefined();
    expect(chosen.session?.active).toBe("tony");
  });

  it("keeps photos sent before choosing", () => {
    const first = decide(newSession(), msg("", { attachments: [{ ref: "a" }] }), L);
    const chosen = decide(first.session!, msg("Gio"), L);
    expect(chosen.ask).toMatchObject({ advisor: "gio", text: "", attachments: [{ ref: "a" }] });
  });

  it("answers a named request directly, without a welcome", () => {
    const d = decide(newSession(), msg("Amar: one night in Bangkok"), L);
    expect(d.replies).toEqual([]);
    expect(d.ask).toEqual({ advisor: "tony", text: "one night in Bangkok", attachments: [], introduce: true });
  });

  it("keeps the current advisor, and switches only when another is named", () => {
    const s: Session = { ...newSession(), active: "tony", welcomed: true, introduced: ["tony"] };
    expect(decide(s, msg("And the next morning?"), L).ask).toMatchObject({ advisor: "tony", introduce: false });
    const switched = decide(s, msg("Martine"), L);
    expect(switched.ask).toBeUndefined();
    expect(switched.session?.active).toBe("martini");
    expect((switched.replies[0] as { text: string }).text).toMatch(/Martine · Style\. Each advisor keeps a separate conversation/);
  });

  it("introduces an advisor again when they take over from another", () => {
    const s: Session = { ...newSession(), active: "martini", welcomed: true, introduced: ["tony", "martini"] };
    expect(decide(s, msg("Amar: and dinner?"), L).ask).toMatchObject({ advisor: "tony", introduce: true });
  });

  it("opens the picker, clears on reset, and asks for support on help", () => {
    const s: Session = { ...newSession(), active: "tony", histories: { tony: [{ role: "user", text: "x" }] } };
    expect(decide(s, msg("advisors"), L).replies[0].kind).toBe("picker");
    expect(decide(s, msg("reset"), L)).toMatchObject({ session: null });
    expect(decide(s, msg("help"), L)).toMatchObject({ support: true, replies: [] });
  });

  it("ignores an empty message", () => {
    expect(decide(newSession(), msg("   "), L).replies).toEqual([]);
  });
});
