// @vitest-environment jsdom
//
// The page's own wiring, rendered: what it sends, what it shows, and when it
// asks the server to stop. Only the network and photo decoding are stand-ins.

import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/login/actions", () => ({ signOut: async () => {} }));
// jsdom has no canvas: a "prepared" photo carries its file name, full and small.
vi.mock("@/lib/ask/photos", () => ({
  PHOTO_ACCEPT: "image/*",
  preparePhoto: async (file: File) => ({
    full: { mediaType: "image/jpeg", data: `FULL${file.name.replace(/\W/g, "")}` },
    small: { mediaType: "image/jpeg", data: `SMALL${file.name.replace(/\W/g, "")}` },
    previewUrl: `blob:${file.name}`,
  }),
}));

const { Studio } = await import("@/components/studio");
const { copyOf, COMPANIONS } = await import("@/lib/companions");

interface Sent {
  method: string;
  url: string;
  turns?: { role: string; text: string; images?: { data: string }[] }[];
}
let sent: Sent[] = [];
let respond: (request: Sent) => Promise<Response> | Response;

const ndjson = (...events: object[]) =>
  new Response(events.map((e) => `${JSON.stringify(e)}\n`).join(""), { headers: { "Content-Type": "application/x-ndjson" } });
const asks = () => sent.filter((r) => r.method === "POST" && r.url === "/api/ask");
const stops = () => sent.filter((r) => r.method === "DELETE");
const setVisible = (visible: boolean) => {
  Object.defineProperty(document, "visibilityState", { value: visible ? "visible" : "hidden", configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
};

beforeEach(() => {
  sent = [];
  setVisible(true);
  URL.createObjectURL = () => "blob:local";
  URL.revokeObjectURL = () => {};
  Element.prototype.scrollIntoView = () => {};
  window.matchMedia = (() => ({ matches: false })) as unknown as typeof window.matchMedia;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const request: Sent = { method: init?.method ?? "GET", url };
      if (typeof init?.body === "string") request.turns = JSON.parse(init.body).turns;
      sent.push(request);
      return respond(request);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const QUESTION = "Plan both sides of our south-facing house.";
const photoFiles = () => ["south.jpg", "east.jpg", "west.jpg"].map((name) => new File(["x"], name, { type: "image/jpeg" }));

function renderPage() {
  render(createElement(Studio, { companion: copyOf(COMPANIONS.gio) }));
}
const textBox = () => screen.getByLabelText("Ask Gio") as HTMLTextAreaElement;
const composerPhotos = () => textBox().closest("form")!.querySelectorAll("img").length;

async function askWithPhotos(question: string) {
  fireEvent.change(textBox().closest("form")!.querySelector('input[type="file"]')!, { target: { files: photoFiles() } });
  await waitFor(() => expect(composerPhotos()).toBe(3));
  await waitFor(() => expect((screen.getByLabelText("Send") as HTMLButtonElement).disabled).toBe(false));
  fireEvent.change(textBox(), { target: { value: question } });
  fireEvent.submit(textBox().closest("form")!);
}

describe("photos too large to send (413)", () => {
  it("hands the question and photos back to edit, with no Retry, and then sends only what's sent", async () => {
    respond = (r) => (asks().length === 1 && r.method === "POST" ? new Response("Too Large", { status: 413 }) : ndjson({ type: "text", text: "Done." }, { type: "done" }));
    renderPage();
    await askWithPhotos(QUESTION);

    await waitFor(() => expect(textBox().value).toBe(QUESTION));
    expect(composerPhotos()).toBe(3);
    expect(screen.getByText(/too large to send together. Remove one or more/)).toBeTruthy();
    expect(screen.queryByText("Retry")).toBeNull();
    expect(screen.queryByText(QUESTION, { selector: "p" })).toBeNull(); // not left in the conversation

    // Remove a photo and send: just this question, with the two photos left.
    fireEvent.click(screen.getAllByLabelText("Remove photo")[0]);
    fireEvent.submit(textBox().closest("form")!);
    await waitFor(() => expect(asks()).toHaveLength(2));
    expect(asks()[1].turns).toEqual([
      { role: "user", text: QUESTION, images: [{ mediaType: "image/jpeg", data: "FULLeastjpg" }, { mediaType: "image/jpeg", data: "FULLwestjpg" }] },
    ]);
  });

  it("keeps a draft typed meanwhile, saves the failed question whole, and sends each only when chosen", async () => {
    let tooLarge!: (r: Response) => void;
    respond = (r) =>
      r.method === "POST" && asks().length === 1
        ? new Promise<Response>((resolve) => (tooLarge = resolve))
        : ndjson({ type: "text", text: "Answer." }, { type: "done" });
    renderPage();
    await askWithPhotos(QUESTION);
    await waitFor(() => expect(asks()).toHaveLength(1));

    // While it's sending, a new draft goes in the box.
    fireEvent.change(textBox(), { target: { value: "Which mulch?" } });
    await act(async () => tooLarge(new Response("Too Large", { status: 413 })));

    // The draft stays as typed, with no photos added; the failed question is saved whole.
    await waitFor(() => expect(screen.getByLabelText("Saved questions")).toBeTruthy());
    expect(textBox().value).toBe("Which mulch?");
    expect(composerPhotos()).toBe(0);
    const saved = within(screen.getByLabelText("Saved questions"));
    expect(saved.getByText(/Too large to send/).parentElement!.textContent).toContain(`${QUESTION} · 3 photos`);
    expect(screen.queryByText("Retry")).toBeNull();

    // Switching swaps them, neither merged: the failed question in the box, the draft saved.
    fireEvent.click(saved.getByText("Switch"));
    await waitFor(() => expect(textBox().value).toBe(QUESTION));
    expect(composerPhotos()).toBe(3);
    expect(within(screen.getByLabelText("Saved questions")).getByText(/Saved draft/).parentElement!.textContent).toContain("Which mulch?");
    fireEvent.click(within(screen.getByLabelText("Saved questions")).getByText("Switch"));
    await waitFor(() => expect(textBox().value).toBe("Which mulch?"));
    expect(composerPhotos()).toBe(0);

    // Sending the draft sends only the draft: the abandoned question isn't history.
    fireEvent.submit(textBox().closest("form")!);
    await waitFor(() => expect(asks()).toHaveLength(2));
    expect(asks()[1].turns).toEqual([{ role: "user", text: "Which mulch?", images: [] }]);
    await waitFor(() => expect(screen.getByText("Answer.")).toBeTruthy());

    // The failed question is still there to send, on its own, when chosen.
    fireEvent.click(within(screen.getByLabelText("Saved questions")).getByText("Switch"));
    await waitFor(() => expect(textBox().value).toBe(QUESTION));
    fireEvent.click(screen.getAllByLabelText("Remove photo")[2]);
    fireEvent.submit(textBox().closest("form")!);
    await waitFor(() => expect(asks()).toHaveLength(3));
    const turns = asks()[2].turns!;
    expect(turns.map((t) => t.text)).toEqual(["Which mulch?", "Answer.", QUESTION]);
    expect(turns.at(-1)!.images!.map((i) => i.data)).toEqual(["FULLsouthjpg", "FULLeastjpg"]);
  });
});

describe("coming back after the connection went", () => {
  it("shows an answer that finished meanwhile, seven minutes later, without asking the server to stop", async () => {
    respond = (r) =>
      r.method === "POST"
        ? ndjson({ type: "phase", phase: "thinking" }) // the stream ends early: the phone suspended the page
        : Response.json({ phase: "writing", text: "The whole plan, finished while you were away.", sources: [], done: true });
    setVisible(false);
    renderPage();
    fireEvent.change(textBox(), { target: { value: QUESTION } });
    fireEvent.submit(textBox().closest("form")!);
    await waitFor(() => expect(asks()).toHaveLength(1));

    // Seven minutes on, the owner comes back.
    const realNow = Date.now.bind(Date);
    vi.spyOn(Date, "now").mockImplementation(() => realNow() + 7 * 60_000);
    act(() => setVisible(true));

    await waitFor(() => expect(screen.getByText("The whole plan, finished while you were away.")).toBeTruthy(), { timeout: 4000 });
    expect(sent.filter((r) => r.method === "GET")).toHaveLength(1);
    expect(stops()).toHaveLength(0);
    expect(screen.queryByText("Retry")).toBeNull();
  });

  it("gives up on an answer still unfinished seven minutes later, keeping its text and stopping the server copy", async () => {
    respond = (r) =>
      r.method === "POST"
        ? ndjson({ type: "phase", phase: "writing" }, { type: "text", text: "Start with drainage." })
        : r.method === "GET"
          ? Response.json({ phase: "writing", text: "Start with drainage. Then", sources: [], done: false, updatedAt: 1 })
          : new Response(null, { status: 204 });
    setVisible(false);
    renderPage();
    fireEvent.change(textBox(), { target: { value: QUESTION } });
    fireEvent.submit(textBox().closest("form")!);
    await waitFor(() => expect(asks()).toHaveLength(1));

    const realNow = Date.now.bind(Date);
    vi.spyOn(Date, "now").mockImplementation(() => realNow() + 7 * 60_000);
    act(() => setVisible(true));

    await waitFor(() => expect(screen.getByText(/stopped responding before the answer finished/)).toBeTruthy(), { timeout: 4000 });
    expect(screen.getByText(/Start with drainage. Then/)).toBeTruthy();
    expect(sent.filter((r) => r.method === "GET")).toHaveLength(1);
    expect(stops()).toHaveLength(1);
    expect(screen.getByText("Retry")).toBeTruthy();
  });
});
