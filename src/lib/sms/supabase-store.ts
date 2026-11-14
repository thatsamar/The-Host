import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SmsSession, SmsStore, SmsTurn } from "./store";

// The last ack line rides in the turns column under a key no advisor uses,
// so remembering it needs no new column (and no migration on the live project).
const LAST_ACK_KEY = "_lastAck";
// So do the advisors this number has met.
const INTRODUCED_KEY = "_introduced";
// And a pending handoff offer.
const PENDING_KEY = "_pendingHandoff";

/**
 * Supabase-backed SMS store, using the service-role client so no signed-in
 * user is needed. Tables live in supabase/migrations/20261028000001_sms.sql
 * and must be applied in the Supabase dashboard before the number goes live.
 * The MessageSid primary key makes duplicate claims atomic.
 */
export class SupabaseSmsStore implements SmsStore {
  constructor(private client: SupabaseClient) {}

  async getSession(phone: string): Promise<SmsSession | null> {
    const { data, error } = await this.client
      .from("sms_sessions")
      .select("phone_number, opted_in, advisor_id, turns_by_advisor")
      .eq("phone_number", phone)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as {
      phone_number: string;
      opted_in: boolean;
      advisor_id: string | null;
      turns_by_advisor: Record<string, unknown> | null;
    };
    const { [LAST_ACK_KEY]: lastAck, [INTRODUCED_KEY]: met, [PENDING_KEY]: pending, ...turns } = row.turns_by_advisor ?? {};
    const pendingHandoff =
      pending && typeof pending === "object" && typeof (pending as { from?: unknown }).from === "string" && typeof (pending as { to?: unknown }).to === "string"
        ? { from: (pending as { from: string }).from, to: (pending as { to: string }).to }
        : undefined;
    const introduced = Array.isArray(met) ? met.filter((id): id is string => typeof id === "string") : undefined;
    return {
      phone: row.phone_number,
      optedIn: row.opted_in,
      advisorId: row.advisor_id,
      turnsByAdvisor: turns as Record<string, SmsTurn[]>,
      ...(typeof lastAck === "number" ? { lastAck } : {}),
      ...(introduced ? { introduced } : {}),
      ...(pendingHandoff ? { pendingHandoff } : {}),
    };
  }

  async saveSession(session: SmsSession): Promise<void> {
    const { error } = await this.client.from("sms_sessions").upsert(
      {
        phone_number: session.phone,
        opted_in: session.optedIn,
        advisor_id: session.advisorId,
        turns_by_advisor: {
          ...session.turnsByAdvisor,
          ...(session.lastAck === undefined ? {} : { [LAST_ACK_KEY]: session.lastAck }),
          ...(session.introduced?.length ? { [INTRODUCED_KEY]: session.introduced } : {}),
          ...(session.pendingHandoff ? { [PENDING_KEY]: session.pendingHandoff } : {}),
        },
        updated_at: new Date().toISOString(),
      },
      { onConflict: "phone_number" },
    );
    if (error) throw new Error("sms_store_save_failed");
  }

  async claimMessageSid(sid: string, phone: string): Promise<boolean> {
    const { error } = await this.client
      .from("sms_processed_messages")
      .insert({ message_sid: sid, phone_number: phone });
    if (!error) return true;
    if ((error as { code?: string }).code === "23505") return false;
    throw new Error("sms_store_claim_failed");
  }
}
