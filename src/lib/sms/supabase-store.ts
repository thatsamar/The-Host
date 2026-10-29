import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SmsSession, SmsStore } from "./store";

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
      turns_by_advisor: SmsSession["turnsByAdvisor"] | null;
    };
    return {
      phone: row.phone_number,
      optedIn: row.opted_in,
      advisorId: row.advisor_id,
      turnsByAdvisor: row.turns_by_advisor ?? {},
    };
  }

  async saveSession(session: SmsSession): Promise<void> {
    const { error } = await this.client.from("sms_sessions").upsert(
      {
        phone_number: session.phone,
        opted_in: session.optedIn,
        advisor_id: session.advisorId,
        turns_by_advisor: session.turnsByAdvisor,
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
