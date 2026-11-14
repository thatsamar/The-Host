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
});
