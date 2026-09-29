"use client";

import { useEffect, useState } from "react";
import { useParams, usePathname, useSearchParams } from "next/navigation";
import { MenuIcon, PanelRightCloseIcon, PanelRightOpenIcon, BookOpenIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useExtractionProcessor } from "@/components/library/use-extraction-processor";
import { useLibraryProcessor } from "@/components/library/use-library-processor";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import type { Workspace } from "@/lib/db/workspace";
import { LeftSidebar } from "./left-sidebar";
import { RightPanel } from "./right-panel";

const RIGHT_PANEL_KEY = "gio.rightPanelOpen";

export function AppShell({ workspace, children }: { workspace: Workspace; children: React.ReactNode }) {
  const params = useParams<{ chatId?: string }>();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const activeChatId = params.chatId ?? null;
  const activeChat = workspace.chats.find((c) => c.id === activeChatId) ?? null;
  const activeRoomId = activeChat ? activeChat.room_id : searchParams.get("room");
  const activeRoom = workspace.rooms.find((r) => r.id === activeRoomId) ?? null;

  const { notice: libraryNotice } = useLibraryProcessor();
  // Keeps proposing memories from imported ChatGPT history in the background.
  useExtractionProcessor();
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const [rightPinned, setRightPinned] = useState(true);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(RIGHT_PANEL_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restore a per-device preference after hydration
      if (saved !== null) setRightPinned(saved === "1");
    } catch {}
  }, []);

  // Close drawers after navigating.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- closing drawers in response to navigation
    setLeftOpen(false);
    setRightOpen(false);
  }, [pathname, searchParams]);

  const togglePinned = () => {
    setRightPinned((v) => {
      try {
        localStorage.setItem(RIGHT_PANEL_KEY, v ? "0" : "1");
      } catch {}
      return !v;
    });
  };

  const sidebar = (
    <LeftSidebar
      workspace={workspace}
      activeChatId={activeChatId}
      activeRoomId={activeRoom?.id ?? null}
      libraryNotice={libraryNotice}
    />
  );
  const panel = <RightPanel workspace={workspace} activeRoom={activeRoom} />;

  return (
    <div className="flex h-dvh overflow-hidden bg-ground">
      <aside className="hidden w-72 shrink-0 border-r border-line bg-sunk/60 lg:flex lg:flex-col">{sidebar}</aside>

      <Sheet open={leftOpen} onOpenChange={setLeftOpen}>
        <SheetContent side="left" title="Projects, rooms and conversations" className="bg-sunk">
          {sidebar}
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-3 lg:px-6">
          <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={() => setLeftOpen(true)} aria-label="Open sidebar">
            <MenuIcon />
          </Button>
          <div className="min-w-0 flex-1">
            <p className="truncate font-serif text-[17px] leading-tight text-ink">
              {activeChat?.title || (activeChatId ? "Conversation" : "New conversation")}
            </p>
            <p className="truncate text-xs text-ink-muted">
              {workspace.project.name}
              {activeRoom ? ` · ${activeRoom.name}` : ""}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            className="lg:hidden"
            onClick={() => setRightOpen(true)}
            aria-label="Open project notebook"
          >
            <BookOpenIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="hidden lg:inline-flex"
            onClick={togglePinned}
            aria-label={rightPinned ? "Collapse project notebook" : "Open project notebook"}
          >
            {rightPinned ? <PanelRightCloseIcon /> : <PanelRightOpenIcon />}
          </Button>
        </header>
        <main className="min-h-0 flex-1">{children}</main>
      </div>

      {rightPinned ? (
        <aside className="hidden w-80 shrink-0 border-l border-line bg-sunk/40 lg:flex lg:flex-col xl:w-[22rem]">
          {panel}
        </aside>
      ) : null}

      <Sheet open={rightOpen} onOpenChange={setRightOpen}>
        <SheetContent side="right" title="Project notebook">
          {panel}
        </SheetContent>
      </Sheet>
    </div>
  );
}
