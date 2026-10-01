// What a visitor keeps from a companion with a journal: saved lines (the
// matchbook), remembered patterns and drafts. The app has no accounts, so it
// lives in this browser only, under one key per companion. The shapes follow
// the database tables a signed-in version would use (MatchbookEntry,
// MemoryPattern, Draft, User.settings), so moving it to a server later is a
// copy, not a redesign. Pure functions here; the React hook is in ./use-journal.

export type EntryType = "thing_under_the_thing" | "one_sentence" | "next_move";

export interface MatchbookEntry {
  id: string;
  type: EntryType;
  content: string;
  /** The mode the answer came from. */
  mode?: string;
  created_at: string;
}

export interface MemoryPattern {
  id: string;
  pattern: string;
  created_at: string;
  updated_at: string;
}

export interface Draft {
  id: string;
  /** What the person asked for, so the draft makes sense later. */
  original_context: string;
  draft_content: string;
  tone: string;
  created_at: string;
}

export interface Journal {
  version: 1;
  settings: { memory_enabled: boolean };
  matchbook: MatchbookEntry[];
  patterns: MemoryPattern[];
  drafts: Draft[];
}

export const MAX_ENTRIES = 500;

export const emptyJournal = (): Journal => ({
  version: 1,
  settings: { memory_enabled: true },
  matchbook: [],
  patterns: [],
  drafts: [],
});

export const storageKey = (companionId: string) => `${companionId}.journal`;

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
const now = () => new Date().toISOString();
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Reads a stored journal, keeping what's well-formed and dropping the rest. */
export function parseJournal(raw: string | null): Journal {
  const base = emptyJournal();
  if (!raw) return base;
  let data: Partial<Journal>;
  try {
    data = JSON.parse(raw);
  } catch {
    return base;
  }
  if (!data || typeof data !== "object") return base;
  const str = (v: unknown): v is string => typeof v === "string";
  return {
    version: 1,
    settings: { memory_enabled: data.settings?.memory_enabled !== false },
    matchbook: (Array.isArray(data.matchbook) ? data.matchbook : []).filter((e) => e && str(e.id) && str(e.content)),
    patterns: (Array.isArray(data.patterns) ? data.patterns : []).filter((p) => p && str(p.id) && str(p.pattern)),
    drafts: (Array.isArray(data.drafts) ? data.drafts : []).filter((d) => d && str(d.id) && str(d.draft_content)),
  };
}

export function saveLine(j: Journal, type: EntryType, content: string, mode?: string): Journal {
  if (j.matchbook.some((e) => e.type === type && same(e.content, content))) return j;
  const entry: MatchbookEntry = { id: newId(), type, content: content.trim(), ...(mode ? { mode } : {}), created_at: now() };
  return { ...j, matchbook: [entry, ...j.matchbook].slice(0, MAX_ENTRIES) };
}

export function keepPattern(j: Journal, pattern: string): Journal {
  if (!pattern.trim() || j.patterns.some((p) => same(p.pattern, pattern))) return j;
  const at = now();
  return { ...j, patterns: [{ id: newId(), pattern: pattern.trim(), created_at: at, updated_at: at }, ...j.patterns].slice(0, MAX_ENTRIES) };
}

export function editPattern(j: Journal, id: string, pattern: string): Journal {
  if (!pattern.trim()) return removeFrom(j, "patterns", id);
  return { ...j, patterns: j.patterns.map((p) => (p.id === id ? { ...p, pattern: pattern.trim(), updated_at: now() } : p)) };
}

export function saveDraft(j: Journal, draft: { original_context: string; draft_content: string; tone: string }): Journal {
  if (j.drafts.some((d) => same(d.draft_content, draft.draft_content))) return j;
  return { ...j, drafts: [{ id: newId(), ...draft, created_at: now() }, ...j.drafts].slice(0, MAX_ENTRIES) };
}

export function removeFrom(j: Journal, list: "matchbook" | "patterns" | "drafts", id: string): Journal {
  return { ...j, [list]: (j[list] as { id: string }[]).filter((x) => x.id !== id) };
}

export function setMemory(j: Journal, enabled: boolean): Journal {
  return { ...j, settings: { ...j.settings, memory_enabled: enabled } };
}

/** The patterns sent with a question: none when memory is off. */
export function memoryFor(j: Journal): string[] {
  return j.settings.memory_enabled ? j.patterns.map((p) => p.pattern) : [];
}

export function isSaved(j: Journal, type: EntryType, content: string): boolean {
  return j.matchbook.some((e) => e.type === type && same(e.content, content));
}
