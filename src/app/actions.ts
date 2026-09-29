"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/db/workspace";

const id = z.string().uuid();
const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .transform((s) => s.trim() || null)
    .nullable()
    .optional();

export type ActionResult = { ok: true; id?: string } | { ok: false; error: string };

function fail(error: unknown): ActionResult {
  return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

export async function createProject(input: { name: string; location?: string | null }): Promise<ActionResult> {
  const parsed = z.object({ name: z.string().trim().min(1).max(120), location: optionalText(200) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Give the project a name." };
  const { supabase, userId } = await requireSession();
  const { data, error } = await supabase
    .from("projects")
    .insert({ user_id: userId, name: parsed.data.name, location: parsed.data.location ?? null })
    .select("id")
    .single();
  if (error) return fail(error.message);
  revalidatePath("/", "layout");
  return { ok: true, id: (data as { id: string }).id };
}

export async function updateProject(input: {
  id: string;
  name?: string;
  location?: string | null;
  brief?: string | null;
}): Promise<ActionResult> {
  const parsed = z
    .object({
      id,
      name: z.string().trim().min(1).max(120).optional(),
      location: optionalText(200),
      brief: optionalText(20000),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the project fields." };
  const { id: projectId, ...fields } = parsed.data;
  const { supabase } = await requireSession();
  const { error } = await supabase.from("projects").update(fields).eq("id", projectId);
  if (error) return fail(error.message);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteProject(projectId: string): Promise<ActionResult> {
  if (!id.safeParse(projectId).success) return { ok: false, error: "Bad project" };
  const { supabase } = await requireSession();
  const { error } = await supabase.from("projects").delete().eq("id", projectId).eq("is_default", false);
  if (error) return fail(error.message);
  revalidatePath("/", "layout");
  redirect("/");
}

export async function createRoom(input: { projectId: string; name: string }): Promise<ActionResult> {
  const parsed = z.object({ projectId: id, name: z.string().trim().min(1).max(120) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Give the room a name." };
  const { supabase, userId } = await requireSession();
  const { data, error } = await supabase
    .from("rooms")
    .insert({ user_id: userId, project_id: parsed.data.projectId, name: parsed.data.name })
    .select("id")
    .single();
  if (error?.code === "23505") return { ok: false, error: "There's already a room with that name." };
  if (error) return fail(error.message);
  revalidatePath("/", "layout");
  return { ok: true, id: (data as { id: string }).id };
}

export async function updateRoom(input: { id: string; name?: string; notes?: string | null }): Promise<ActionResult> {
  const parsed = z
    .object({ id, name: z.string().trim().min(1).max(120).optional(), notes: optionalText(20000) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the room fields." };
  const { id: roomId, ...fields } = parsed.data;
  const { supabase } = await requireSession();
  const { error } = await supabase.from("rooms").update(fields).eq("id", roomId);
  if (error?.code === "23505") return { ok: false, error: "There's already a room with that name." };
  if (error) return fail(error.message);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteRoom(roomId: string): Promise<ActionResult> {
  if (!id.safeParse(roomId).success) return { ok: false, error: "Bad room" };
  const { supabase } = await requireSession();
  const { error } = await supabase.from("rooms").delete().eq("id", roomId);
  if (error) return fail(error.message);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function renameChat(chatId: string, title: string): Promise<ActionResult> {
  const parsed = z.object({ chatId: id, title: z.string().trim().min(1).max(120) }).safeParse({ chatId, title });
  if (!parsed.success) return { ok: false, error: "Title can't be empty." };
  const { supabase } = await requireSession();
  const { error } = await supabase.from("chats").update({ title: parsed.data.title }).eq("id", chatId);
  if (error) return fail(error.message);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteChat(chatId: string): Promise<ActionResult> {
  if (!id.safeParse(chatId).success) return { ok: false, error: "Bad chat" };
  const { supabase } = await requireSession();
  const { error } = await supabase.from("chats").delete().eq("id", chatId);
  if (error) return fail(error.message);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function signOut() {
  const { supabase } = await requireSession();
  await supabase.auth.signOut();
  redirect("/login");
}
