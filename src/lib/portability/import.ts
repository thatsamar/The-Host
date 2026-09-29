// Imports a Gio export (JSON or Markdown) into the signed-in account.
//
// Rows keep their original ids, so importing the same export twice adds
// nothing the second time. The export's General Design Brain merges into this
// account's, and rooms merge by name within a project. Library files are
// listed in exports but not included, so they're reported, not imported.

import type { ExportBundle } from "./bundle";
import type { DataStore, Row } from "./store";

export interface ImportReport {
  added: Record<"projects" | "rooms" | "chats" | "messages" | "memories" | "decisions" | "products" | "promptVersions", number>;
  skipped: number;
  filesNotIncluded: number;
  /** Approved memories added; they need embeddings for relevance search. */
  memoryIdsToEmbed: string[];
}

const pick = (row: Row, keys: string[]) => Object.fromEntries(keys.filter((k) => k in row).map((k) => [k, row[k]]));

const COLUMNS = {
  projects: ["id", "name", "location", "brief", "created_at", "updated_at"],
  rooms: ["id", "project_id", "name", "notes", "created_at"],
  chats: ["id", "project_id", "room_id", "title", "source", "external_id", "created_at", "updated_at"],
  messages: ["id", "chat_id", "role", "speaker", "content", "attachments", "metadata", "created_at"],
  memories: ["id", "project_id", "room_id", "type", "content", "attributed_to", "review_state", "source", "evidence", "source_message_id", "created_at", "updated_at"],
  decisions: ["id", "project_id", "room_id", "title", "detail", "status", "review_state", "product_id", "source_message_id", "decided_by", "source", "evidence", "created_at", "updated_at"],
  products: ["id", "project_id", "room_id", "name", "designer", "vendor", "url", "dimensions", "material_color", "provenance", "price_amount", "price_currency", "price_basis", "price_source_url", "placement", "rationale", "verdict", "status", "source_message_id", "created_at", "updated_at"],
};

export async function importBundle(store: DataStore, bundle: ExportBundle, userId: string): Promise<ImportReport> {
  const report: ImportReport = {
    added: { projects: 0, rooms: 0, chats: 0, messages: 0, memories: 0, decisions: 0, products: 0, promptVersions: 0 },
    skipped: 0,
    filesNotIncluded: bundle.files.length,
    memoryIdsToEmbed: [],
  };
  const ids = async (table: Parameters<DataStore["selectAll"]>[0], cols = "id") => store.selectAll(table, cols);
  const own = (row: Row): Row => ({ ...row, user_id: userId });

  // Projects: the exported default project maps onto this account's.
  const existingProjects = await ids("projects", "id,is_default");
  const existingProjectIds = new Set(existingProjects.map((p) => p.id));
  const myDefault = existingProjects.find((p) => p.is_default)?.id as string | undefined;
  const projectMap = new Map<string, string>();
  const newProjects: Row[] = [];
  for (const p of bundle.projects) {
    const id = String(p.id);
    if (p.is_default && myDefault) projectMap.set(id, myDefault);
    else {
      projectMap.set(id, id);
      if (existingProjectIds.has(id)) report.skipped++;
      else newProjects.push(own({ ...pick(p, COLUMNS.projects), is_default: false }));
    }
  }
  await store.insert("projects", newProjects);
  report.added.projects = newProjects.length;
  const mapProject = (id: unknown) => (id == null ? null : projectMap.get(String(id)) ?? String(id));

  // Rooms: merge by name within a project.
  const existingRooms = await ids("rooms", "id,project_id,name");
  const roomKey = (projectId: unknown, name: unknown) => `${projectId}:${String(name).trim().toLowerCase()}`;
  const roomsByKey = new Map(existingRooms.map((r) => [roomKey(r.project_id, r.name), String(r.id)]));
  const existingRoomIds = new Set(existingRooms.map((r) => r.id));
  const roomMap = new Map<string, string>();
  const newRooms: Row[] = [];
  for (const r of bundle.rooms) {
    const projectId = mapProject(r.project_id);
    const key = roomKey(projectId, r.name);
    const match = roomsByKey.get(key);
    if (match || existingRoomIds.has(r.id)) {
      roomMap.set(String(r.id), match ?? String(r.id));
      report.skipped++;
      continue;
    }
    roomMap.set(String(r.id), String(r.id));
    roomsByKey.set(key, String(r.id));
    newRooms.push(own({ ...pick(r, COLUMNS.rooms), project_id: projectId }));
  }
  await store.insert("rooms", newRooms);
  report.added.rooms = newRooms.length;
  const mapRoom = (id: unknown) => (id == null ? null : roomMap.get(String(id)) ?? null);

  // Chats: skip ones already here, by id or by ChatGPT conversation id.
  const existingChats = await ids("chats", "id,external_id");
  const chatIds = new Set(existingChats.map((c) => c.id));
  const externalIds = new Set(existingChats.map((c) => c.external_id).filter(Boolean));
  const newChats: Row[] = [];
  const importedChatIds = new Set<string>();
  for (const c of bundle.chats) {
    if (chatIds.has(c.id) || (c.external_id && externalIds.has(c.external_id))) {
      report.skipped++;
      continue;
    }
    importedChatIds.add(String(c.id));
    newChats.push(own({ ...pick(c, COLUMNS.chats), project_id: mapProject(c.project_id), room_id: mapRoom(c.room_id) }));
  }
  await store.insert("chats", newChats);
  report.added.chats = newChats.length;

  const newMessages = bundle.messages.filter((m) => importedChatIds.has(String(m.chat_id))).map((m) => own(pick(m, COLUMNS.messages)));
  await store.insert("messages", newMessages);
  report.added.messages = newMessages.length;

  // Links to messages only survive if the message exists here.
  const messageIds = new Set([...(await ids("messages")).map((m) => String(m.id))]);
  const linkMessage = (id: unknown) => (id != null && messageIds.has(String(id)) ? id : null);

  const existingProducts = new Set((await ids("products")).map((p) => p.id));
  const newProducts = bundle.products
    .filter((p) => !existingProducts.has(p.id))
    .map((p) =>
      own({ ...pick(p, COLUMNS.products), project_id: mapProject(p.project_id), room_id: mapRoom(p.room_id), source_message_id: linkMessage(p.source_message_id) }),
    );
  await store.insert("products", newProducts);
  report.added.products = newProducts.length;
  report.skipped += bundle.products.length - newProducts.length;
  const productIds = new Set([...existingProducts, ...newProducts.map((p) => p.id)].map(String));

  const existingDecisions = new Set((await ids("decisions")).map((d) => d.id));
  const newDecisions = bundle.decisions
    .filter((d) => !existingDecisions.has(d.id))
    .map((d) =>
      own({
        ...pick(d, COLUMNS.decisions),
        project_id: mapProject(d.project_id),
        room_id: mapRoom(d.room_id),
        product_id: d.product_id != null && productIds.has(String(d.product_id)) ? d.product_id : null,
        source_message_id: linkMessage(d.source_message_id),
      }),
    );
  await store.insert("decisions", newDecisions);
  report.added.decisions = newDecisions.length;
  report.skipped += bundle.decisions.length - newDecisions.length;

  const existingMemories = new Set((await ids("memories")).map((m) => m.id));
  const newMemories = bundle.memories
    .filter((m) => !existingMemories.has(m.id))
    .map((m) =>
      own({ ...pick(m, COLUMNS.memories), project_id: mapProject(m.project_id), room_id: mapRoom(m.room_id), source_message_id: linkMessage(m.source_message_id) }),
    );
  await store.insert("memories", newMemories);
  report.added.memories = newMemories.length;
  report.skipped += bundle.memories.length - newMemories.length;
  report.memoryIdsToEmbed = newMemories.filter((m) => m.review_state === "approved").map((m) => String(m.id));

  // The prompt: never replaced silently. A different prompt becomes a
  // version you can restore from Settings.
  const versions = await ids("system_prompt_versions", "id,content");
  const versionIds = new Set(versions.map((v) => v.id));
  const contents = new Set(versions.map((v) => v.content));
  const settings = await ids("settings", "key,value");
  const live = settings.find((s) => s.key === "system_prompt")?.value;
  const newVersions = bundle.system_prompt_versions
    .filter((v) => !versionIds.has(v.id))
    .map((v) => own(pick(v, ["id", "content", "label", "note", "created_at"])));
  newVersions.forEach((v) => contents.add(v.content));
  if (bundle.system_prompt && bundle.system_prompt !== live && !contents.has(bundle.system_prompt)) {
    newVersions.push(own({ content: bundle.system_prompt, label: "imported", note: `From an export made ${bundle.exported_at.slice(0, 10)}` }));
  }
  await store.insert("system_prompt_versions", newVersions);
  report.added.promptVersions = newVersions.length;

  return report;
}
