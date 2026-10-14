// @vitest-environment jsdom
//
// Cinq's lineup as people see it: the hub's five cards, Alden's page on the
// shared answer flow, and Jack's old address.

import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/login/actions", () => ({ signOut: async () => {} }));
vi.mock("@/lib/ask/photos", () => ({
  PHOTO_ACCEPT: "image/*",
  preparePhoto: async (file: File) => ({
    full: { mediaType: "image/jpeg", data: `FULL${file.name.replace(/\W/g, "")}` },
    small: { mediaType: "image/jpeg", data: `SMALL${file.name.replace(/\W/g, "")}` },
    previewUrl: `blob:${file.name}`,
  }),
}));

const { Hub } = await import("@/components/hub");
const { Studio } = await import("@/components/studio");
const { default: Home } = await import("@/app/page");
const { COMPANIONS, copyOf } = await import("@/lib/companions");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the hub", () => {
  it("lists Tony, Martine, Gio, Alden and Goldie, and not Jack", () => {
    render(createElement(Hub));
    const names = ["Tony", "Martine", "Gio", "Alden", "Goldie"];
    for (const name of names) expect(screen.getByText(new RegExp(`^${name}\\b`))).toBeTruthy();
    expect(screen.queryByText(/Jack/)).toBeNull();
    expect(screen.queryByText("Reality check")).toBeNull();
    expect(screen.getByText("Wine, cocktails & spirits")).toBeTruthy();
    // No address for Alden in this build: his card isn't a link anywhere, least of all Jack's.
    expect(screen.getByText("Alden · Coming soon").closest("a")).toBeNull();
    for (const link of document.querySelectorAll("a")) expect(link.getAttribute("href")).not.toMatch(/jack/);
  });
});

describe("Jack's old address", () => {
  it("says Jack has retired, under his own name, and offers Cinq rather than another advisor", () => {
    vi.stubEnv("COMPANION", "jack");
    render(Home());
    expect(screen.getByRole("heading").textContent).toBe("Jack is no longer one of Cinq’s advisors.");
    expect(screen.getByText("Nothing you asked Jack was saved, so there’s nothing to move.")).toBeTruthy();
    expect(screen.getByText("Meet Cinq’s advisors").getAttribute("href")).toBe("https://fresh2-pi.vercel.app");
    expect(document.body.textContent).not.toMatch(/Alden/);
    expect(screen.queryByLabelText("Ask Jack")).toBeNull();
  });

  it("is not where Alden lives: Alden's address shows Alden's page", () => {
    vi.stubEnv("COMPANION", "alden");
    render(Home());
    expect(screen.getByLabelText("Ask Alden")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Jack/);
  });
});

describe("Alden's page", () => {
  let sent: { url: string; method: string; body?: { turns: { role: string; text: string; images?: { data: string }[] }[] } }[];

  beforeEach(() => {
    sent = [];
    URL.createObjectURL = () => "blob:local";
    URL.revokeObjectURL = () => {};
    Element.prototype.scrollIntoView = () => {};
    window.matchMedia = (() => ({ matches: false })) as unknown as typeof window.matchMedia;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        sent.push({ url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
        const events = [{ type: "text", text: "The call: the Etna Rosso." }, { type: "done" }];
        return new Response(events.map((e) => `${JSON.stringify(e)}\n`).join(""), { headers: { "Content-Type": "application/x-ndjson" } });
      }),
    );
  });

  it("shows Alden's words and sends a photographed list through the shared answer flow", async () => {
    render(createElement(Studio, { companion: copyOf(COMPANIONS.alden) }));
    expect(screen.getByText("Wine, Cocktails & Spirits Advisor")).toBeTruthy();
    expect(screen.getByText("The right drink at the right time", { selector: "p" })).toBeTruthy();
    const box = screen.getByLabelText("Ask Alden") as HTMLTextAreaElement;
    expect(box.placeholder).toBe("What are we drinking?");

    const form = box.closest("form")!;
    fireEvent.change(form.querySelector('input[type="file"]')!, { target: { files: [new File(["x"], "list.jpg", { type: "image/jpeg" })] } });
    await waitFor(() => expect(form.querySelectorAll("img").length).toBe(1));
    await waitFor(() => expect((screen.getByLabelText("Send") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.change(box, { target: { value: "Roast chicken, $80 tops." } });
    fireEvent.submit(form);

    await waitFor(() => expect(screen.getByText("The call: the Etna Rosso.")).toBeTruthy());
    const asks = sent.filter((r) => r.method === "POST" && r.url === "/api/ask");
    expect(asks).toHaveLength(1);
    expect(asks[0].body!.turns).toEqual([
      { role: "user", text: "Roast chicken, $80 tops.", images: [{ mediaType: "image/jpeg", data: "FULLlistjpg" }] },
    ]);
  });
});
