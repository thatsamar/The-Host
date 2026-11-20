import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseSmsStore } from "@/lib/sms/supabase-store";

// A stand-in for the one table the store reads and writes.
function fakeClient() {
  const rows = new Map<string, Record<string, unknown>>();
  const client = {
    from: () => ({
      select: () => ({
        eq: (_: string, phone: string) => ({ maybeSingle: async () => ({ data: rows.get(phone) ?? null, error: null }) }),
      }),
      upsert: async (row: Record<string, unknown>) => {
        rows.set(row.phone_number as string, row);
        return { error: null };
      },
    }),
  };
  return { rows, store: new SupabaseSmsStore(client as unknown as SupabaseClient) };
}

describe("Supabase SMS store", () => {
  it("remembers the last ack line beside the turns, without it ever reading as a conversation", async () => {
    const { rows, store } = fakeClient();
    const turns = { gio: [{ role: "user" as const, text: "Sofa?" }, { role: "assistant" as const, text: "Smaller." }] };
    await store.saveSession({ phone: "+1555", optedIn: true, advisorId: "gio", turnsByAdvisor: turns, lastAck: 2 });
    expect(rows.get("+1555")!.turns_by_advisor).toEqual({ ...turns, _lastAck: 2 });
    expect(await store.getSession("+1555")).toEqual({ phone: "+1555", optedIn: true, advisorId: "gio", turnsByAdvisor: turns, lastAck: 2 });
  });

  it("reads sessions saved before acks varied, and saves them as before when no ack was sent", async () => {
    const { rows, store } = fakeClient();
    await store.saveSession({ phone: "+1555", optedIn: true, advisorId: null, turnsByAdvisor: {} });
    expect(rows.get("+1555")!.turns_by_advisor).toEqual({});
    expect(await store.getSession("+1555")).toEqual({ phone: "+1555", optedIn: true, advisorId: null, turnsByAdvisor: {} });
  });

  it("keeps a pending handoff offer beside the turns, and drops a malformed one", async () => {
    const { rows, store } = fakeClient();
    await store.saveSession({ phone: "+1555", optedIn: true, advisorId: "alden", turnsByAdvisor: {}, pendingHandoff: { from: "alden", to: "martini" } });
    expect(rows.get("+1555")!.turns_by_advisor).toEqual({ _pendingHandoff: { from: "alden", to: "martini" } });
    expect((await store.getSession("+1555"))?.pendingHandoff).toEqual({ from: "alden", to: "martini" });
    rows.get("+1555")!.turns_by_advisor = { _pendingHandoff: "martini" };
    const session = await store.getSession("+1555");
    expect(session?.pendingHandoff).toBeUndefined();
    expect(session?.turnsByAdvisor).toEqual({});
  });
});

describe("Supabase SMS store: introductions", () => {
  it("remembers which advisors a number has met, beside the turns", async () => {
    const rows = new Map<string, Record<string, unknown>>();
    const client = {
      from: () => ({
        select: () => ({ eq: (_: string, phone: string) => ({ maybeSingle: async () => ({ data: rows.get(phone) ?? null, error: null }) }) }),
        upsert: async (row: Record<string, unknown>) => (rows.set(row.phone_number as string, row), { error: null }),
      }),
    };
    const store = new SupabaseSmsStore(client as unknown as SupabaseClient);
    await store.saveSession({ phone: "+1555", optedIn: true, advisorId: "gio", turnsByAdvisor: {}, introduced: ["gio"] });
    expect(rows.get("+1555")!.turns_by_advisor).toEqual({ _introduced: ["gio"] });
    expect((await store.getSession("+1555"))?.introduced).toEqual(["gio"]);
    expect((await store.getSession("+1555"))?.turnsByAdvisor).toEqual({});
  });

  it("names a failed save for its kind, never carrying the database's message", async () => {
    const failing = (code: string) =>
      new SupabaseSmsStore({
        from: () => ({ upsert: async () => ({ error: { code, message: "canceling statement due to statement timeout" } }) }),
      } as unknown as SupabaseClient);
    const timeout = await failing("57014").saveSession({ phone: "+1555", optedIn: true, advisorId: null, turnsByAdvisor: {} }).catch((e: Error) => e);
    expect((timeout as Error).name).toBe("SmsStoreTimeoutError");
    expect((timeout as Error).message).toBe("sms_store_save_failed");
    const other = await failing("PGRST000").saveSession({ phone: "+1555", optedIn: true, advisorId: null, turnsByAdvisor: {} }).catch((e: Error) => e);
    expect((other as Error).name).toBe("SmsStoreSaveError");
  });
});
