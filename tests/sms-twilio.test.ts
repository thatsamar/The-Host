import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTwilioSender,
  downloadTwilioMedia,
  twilioSignature,
  validTwilioSignature,
} from "../src/lib/sms/twilio";

// Independent reference implementation of Twilio's signing rule.
function referenceSignature(token: string, url: string, params: Record<string, string>): string {
  const data =
    url +
    Object.keys(params)
      .sort()
      .map((key) => key + params[key])
      .join("");
  return createHmac("sha1", token).update(data).digest("base64");
}

const URL = "https://thehub-chi.vercel.app/api/sms";
const PARAMS = {
  MessageSid: "SMaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  From: "+15551234567",
  To: "+15557654321",
  Body: "Hello",
};

describe("twilio signature", () => {
  it("matches an independent implementation of the signing rule", () => {
    expect(twilioSignature("token123", URL, PARAMS)).toBe(referenceSignature("token123", URL, PARAMS));
  });

  it("accepts a signature made with the right token", () => {
    const signature = referenceSignature("token123", URL, PARAMS);
    expect(validTwilioSignature("token123", URL, PARAMS, signature)).toBe(true);
  });

  it("rejects a tampered parameter", () => {
    const signature = referenceSignature("token123", URL, PARAMS);
    expect(validTwilioSignature("token123", URL, { ...PARAMS, Body: "Goodbye" }, signature)).toBe(false);
  });

  it("rejects the wrong token", () => {
    const signature = referenceSignature("token123", URL, PARAMS);
    expect(validTwilioSignature("other-token", URL, PARAMS, signature)).toBe(false);
  });

  it("rejects a missing signature or token", () => {
    const signature = referenceSignature("token123", URL, PARAMS);
    expect(validTwilioSignature("token123", URL, PARAMS, "")).toBe(false);
    expect(validTwilioSignature("", URL, PARAMS, signature)).toBe(false);
  });
});

describe("twilio sender", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts to the Messages API with basic auth and the right fields", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        seen.push({ url, init });
        return new Response("{}", { status: 201 });
      }),
    );
    const sender = createTwilioSender({ accountSid: "AC123", authToken: "tok", from: "+15557654321" });
    await sender.send("+15551234567", "Hi there");
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json");
    expect(seen[0].init.headers).toMatchObject({
      Authorization: "Basic " + Buffer.from("AC123:tok").toString("base64"),
    });
    const body = new URLSearchParams(seen[0].init.body as string);
    expect(body.get("From")).toBe("+15557654321");
    expect(body.get("To")).toBe("+15551234567");
    expect(body.get("Body")).toBe("Hi there");
  });

  it("throws on a failed send", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 400 })));
    const sender = createTwilioSender({ accountSid: "AC123", authToken: "tok", from: "+15557654321" });
    await expect(sender.send("+15551234567", "Hi")).rejects.toThrow("twilio_send_400");
  });
});

describe("twilio media download", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns base64 and the content type on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const buf = Buffer.from("fake-jpeg-bytes");
        return new Response(buf as unknown as BodyInit, {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        });
      }),
    );
    const media = await downloadTwilioMedia({
      accountSid: "AC123",
      authToken: "tok",
      url: "https://api.twilio.com/media/1",
    });
    expect(media?.mediaType).toBe("image/jpeg");
    expect(media?.data).toBe(Buffer.from("fake-jpeg-bytes").toString("base64"));
  });

  it("returns null on failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("gone", { status: 404 })));
    const media = await downloadTwilioMedia({
      accountSid: "AC123",
      authToken: "tok",
      url: "https://api.twilio.com/media/1",
    });
    expect(media).toBeNull();
  });
});
