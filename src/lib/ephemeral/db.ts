import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// Admin client for ephemeral messages (doesn't need auth)
function getAdminClient() {
  const client = createAdminClient();
  if (!client) {
    throw new Error("Supabase not configured. Check NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  }
  return client;
}

export interface EphemeralMessage {
  id: string;
  session_id: string;
  role: "user" | "assistant";
  status: "pending" | "completed" | "failed";
  content: string;
  error?: string;
  created_at: string;
  updated_at: string;
}

export async function createUserMessage(sessionId: string, text: string): Promise<EphemeralMessage> {
  const client = getAdminClient();
  const { data, error } = await client
    .from("ephemeral_messages")
    .insert({
      session_id: sessionId,
      role: "user",
      status: "completed",
      content: text,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function createAssistantMessage(sessionId: string): Promise<EphemeralMessage> {
  const client = getAdminClient();
  const { data, error } = await client
    .from("ephemeral_messages")
    .insert({
      session_id: sessionId,
      role: "assistant",
      status: "pending",
      content: "",
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateAssistantMessage(
  messageId: string,
  updates: { content?: string; status?: "pending" | "completed" | "failed"; error?: string | null },
): Promise<void> {
  const client = getAdminClient();
  const { error } = await client.from("ephemeral_messages").update(updates).eq("id", messageId);

  if (error) throw error;
}

export async function getSessionMessages(sessionId: string): Promise<EphemeralMessage[]> {
  const client = getAdminClient();
  const { data, error } = await client
    .from("ephemeral_messages")
    .select()
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function getMessageById(messageId: string): Promise<EphemeralMessage | null> {
  const client = getAdminClient();
  const { data, error } = await client
    .from("ephemeral_messages")
    .select()
    .eq("id", messageId)
    .single();

  if (error && error.code !== "PGRST116") throw error; // PGRST116 = no rows
  return data || null;
}
