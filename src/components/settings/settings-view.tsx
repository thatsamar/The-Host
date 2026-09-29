"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { useExtractionProcessor } from "@/components/library/use-extraction-processor";
import { useLibraryProcessor } from "@/components/library/use-library-processor";
import type { DecisionRow, FileRow, MemoryRow, ProjectRow, RoomRow } from "@/lib/db/types";
import { cn } from "@/lib/utils";
import { DecisionManager } from "./decision-manager";
import { ImportExport } from "./import-export";
import { LibraryManager } from "./library-manager";
import { MemoryManager } from "./memory-manager";
import { PromptEditor } from "./prompt-editor";

export interface SettingsData {
  userId: string;
  prompt: string;
  defaultPrompt: string;
  versions: { id: string; content: string; label: string; note: string | null; created_at: string }[];
  projects: ProjectRow[];
  rooms: RoomRow[];
  memories: MemoryRow[];
  decisions: DecisionRow[];
  files: FileRow[];
}

const TABS = [
  { id: "gio", label: "Gio's prompt" },
  { id: "memory", label: "Memory" },
  { id: "decisions", label: "Decisions" },
  { id: "library", label: "Library" },
  { id: "data", label: "Import & export" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export function SettingsView({ data, initialTab }: { data: SettingsData; initialTab?: string }) {
  const [tab, setTab] = useState<TabId>(TABS.some((t) => t.id === initialTab) ? (initialTab as TabId) : "gio");
  const { notice } = useLibraryProcessor();
  const extraction = useExtractionProcessor();
  const home = data.projects[0] ? `/p/${data.projects[0].id}` : "/";

  const select = (id: TabId) => {
    setTab(id);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", id);
    window.history.replaceState(null, "", url);
  };

  return (
    <div className="min-h-dvh bg-paper">
      <header className="sticky top-0 z-10 border-b border-stone bg-paper/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3 sm:px-6">
          <Link href={home} className="flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink">
            <ArrowLeftIcon className="size-4" /> Studio
          </Link>
          <h1 className="ml-2 font-serif text-2xl font-light text-ink">Settings</h1>
        </div>
        <nav className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-3 [scrollbar-width:none] sm:px-5" aria-label="Settings sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => select(t.id)}
              aria-current={tab === t.id ? "page" : undefined}
              className={cn(
                "shrink-0 border-b-2 px-3 pb-2.5 pt-1 text-sm transition-colors",
                tab === t.id ? "border-oxblood text-ink" : "border-transparent text-ink-muted hover:text-ink",
              )}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        {tab === "gio" ? <PromptEditor prompt={data.prompt} defaultPrompt={data.defaultPrompt} versions={data.versions} /> : null}
        {tab === "memory" ? <MemoryManager memories={data.memories} projects={data.projects} /> : null}
        {tab === "decisions" ? <DecisionManager decisions={data.decisions} projects={data.projects} /> : null}
        {tab === "library" ? <LibraryManager files={data.files} projects={data.projects} rooms={data.rooms} notice={notice} /> : null}
        {tab === "data" ? <ImportExport userId={data.userId} projects={data.projects} extraction={extraction} /> : null}
      </main>
    </div>
  );
}
