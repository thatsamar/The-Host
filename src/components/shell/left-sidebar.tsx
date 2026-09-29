"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CheckIcon,
  ChevronsUpDownIcon,
  LogOutIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  SettingsIcon,
  SquarePenIcon,
  Trash2Icon,
} from "lucide-react";
import { createProject, createRoom, deleteChat, renameChat, signOut } from "@/app/actions";
import { LibrarySection } from "@/components/library/library-section";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Workspace } from "@/lib/db/workspace";
import type { ChatRow } from "@/lib/db/types";
import { cn } from "@/lib/utils";

interface Props {
  workspace: Workspace;
  activeChatId: string | null;
  activeRoomId: string | null;
  libraryNotice?: string | null;
}

export function LeftSidebar({ workspace, activeChatId, activeRoomId, libraryNotice }: Props) {
  const { project, rooms, chats } = workspace;
  const base = `/p/${project.id}`;
  const newChatHref = activeRoomId ? `${base}?room=${activeRoomId}` : base;
  const visibleChats = activeRoomId ? chats.filter((c) => c.room_id === activeRoomId) : chats;
  const roomName = new Map(rooms.map((r) => [r.id, r.name]));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-5 pb-3 pt-5">
        <p className="font-serif text-2xl font-light tracking-tight text-ink">Gio</p>
      </div>

      <div className="px-3">
        <ProjectSwitcher workspace={workspace} />
      </div>

      <div className="px-3 pt-3">
        <Button asChild variant="outline" className="w-full justify-start">
          <Link href={newChatHref}>
            <SquarePenIcon />
            New conversation
          </Link>
        </Button>
      </div>

      <nav className="mt-4 min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <Section title="Rooms">
          <RoomLink href={base} active={!activeRoomId && !activeChatId} label="Whole project" />
          {rooms.map((room) => (
            <RoomLink
              key={room.id}
              href={`${base}?room=${room.id}`}
              active={activeRoomId === room.id}
              label={room.name}
            />
          ))}
          <AddRoom projectId={project.id} />
        </Section>

        <Section title={activeRoomId ? `Conversations · ${roomName.get(activeRoomId) ?? "Room"}` : "Conversations"}>
          {visibleChats.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-ink-muted">None yet.</p>
          ) : (
            visibleChats.map((chat) => (
              <ChatItem
                key={chat.id}
                chat={chat}
                href={`${base}/c/${chat.id}`}
                active={chat.id === activeChatId}
                roomName={!activeRoomId && chat.room_id ? roomName.get(chat.room_id) : undefined}
                afterDelete={chat.id === activeChatId ? base : undefined}
              />
            ))
          )}
        </Section>

        <LibrarySection
          projectId={project.id}
          rooms={rooms}
          files={workspace.files}
          activeRoomId={activeRoomId}
          notice={libraryNotice}
        />
      </nav>

      <div className="flex items-center gap-1 border-t border-stone p-3">
        <Button asChild variant="ghost" size="sm" className="flex-1 justify-start text-ink-muted">
          <Link href="/settings">
            <SettingsIcon />
            Settings
          </Link>
        </Button>
        <form action={signOut}>
          <Button type="submit" variant="ghost" size="sm" className="text-ink-muted">
            <LogOutIcon />
            Sign out
          </Button>
        </form>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5 first:mt-0">
      <h2 className="mb-1.5 px-2 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-muted">{title}</h2>
      <div className="space-y-0.5">{children}</div>
    </section>
  );
}

function RoomLink({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "block truncate rounded-md px-2 py-1.5 text-sm transition-colors",
        active ? "bg-paper-raised font-medium text-ink shadow-[inset_2px_0_0_var(--oxblood)]" : "text-ink-soft hover:bg-paper-raised/70",
      )}
    >
      {label}
    </Link>
  );
}

function AddRoom({ projectId }: { projectId: string }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  if (!adding) {
    return (
      <button
        onClick={() => setAdding(true)}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-ink-muted hover:bg-paper-raised/70 hover:text-ink"
      >
        <PlusIcon className="size-3.5" /> Add room
      </button>
    );
  }
  const submit = () =>
    start(async () => {
      const result = await createRoom({ projectId, name });
      if (!result.ok) return setError(result.error);
      setName("");
      setAdding(false);
      setError(null);
      router.push(`/p/${projectId}?room=${result.id}`);
    });
  return (
    <form
      className="px-1 py-1"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setAdding(false)}
        onBlur={() => !name.trim() && setAdding(false)}
        placeholder="Dining room, Terrace…"
        className="h-8"
        disabled={pending}
      />
      {error ? <p className="mt-1 px-1 text-xs text-oxblood">{error}</p> : null}
    </form>
  );
}

function ChatItem({
  chat,
  href,
  active,
  roomName,
  afterDelete,
}: {
  chat: ChatRow;
  href: string;
  active: boolean;
  roomName?: string;
  afterDelete?: string;
}) {
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(chat.title ?? "");
  const [, start] = useTransition();

  if (renaming) {
    return (
      <form
        className="px-1 py-1"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            await renameChat(chat.id, title);
            setRenaming(false);
          });
        }}
      >
        <Input
          autoFocus
          className="h-8"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => setRenaming(false)}
          onKeyDown={(e) => e.key === "Escape" && setRenaming(false)}
        />
      </form>
    );
  }

  return (
    <div
      className={cn(
        "group flex items-center rounded-md transition-colors",
        active ? "bg-paper-raised shadow-[inset_2px_0_0_var(--oxblood)]" : "hover:bg-paper-raised/70",
      )}
    >
      <Link href={href} className="min-w-0 flex-1 px-2 py-1.5">
        <span className={cn("block truncate text-sm", active ? "font-medium text-ink" : "text-ink-soft")}>
          {chat.title || "Untitled conversation"}
        </span>
        {roomName ? <span className="block truncate text-[11px] text-ink-muted">{roomName}</span> : null}
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="mr-1 rounded p-1 text-ink-muted opacity-100 hover:bg-paper-sunk hover:text-ink lg:opacity-0 lg:group-hover:opacity-100 data-[state=open]:opacity-100"
          aria-label="Conversation options"
        >
          <MoreHorizontalIcon className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[10rem]">
          <DropdownMenuItem onSelect={() => setRenaming(true)}>
            <PencilIcon /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-oxblood"
            onSelect={() => {
              if (!confirm("Delete this conversation? This can't be undone.")) return;
              start(async () => {
                await deleteChat(chat.id);
                if (afterDelete) router.push(afterDelete);
              });
            }}
          >
            <Trash2Icon className="!text-oxblood" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function ProjectSwitcher({ workspace }: { workspace: Workspace }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger className="flex w-full items-center gap-2 rounded-md border border-stone bg-paper-raised px-3 py-2 text-left outline-none hover:border-stone-strong focus-visible:ring-2 focus-visible:ring-tobacco/30">
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] font-medium uppercase tracking-[0.14em] text-ink-muted">Project</span>
            <span className="block truncate font-serif text-[15px] text-ink">{workspace.project.name}</span>
          </span>
          <ChevronsUpDownIcon className="size-4 shrink-0 text-ink-muted" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)]">
          <DropdownMenuLabel>Projects</DropdownMenuLabel>
          {workspace.projects.map((p) => (
            <DropdownMenuItem key={p.id} onSelect={() => router.push(`/p/${p.id}`)}>
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              {p.id === workspace.project.id ? <CheckIcon /> : null}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setOpen(true)}>
            <PlusIcon /> New project
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="New project" description="A home or a place. Rooms and conversations live inside it.">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const result = await createProject({ name, location });
                if (!result.ok) return setError(result.error);
                setOpen(false);
                setName("");
                setLocation("");
                router.push(`/p/${result.id}`);
              });
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="project-name">Name</Label>
              <Input id="project-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="The Marfa house" autoFocus />
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-location">Location</Label>
              <Input
                id="project-location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Marfa, Texas"
              />
            </div>
            {error ? <p className="text-sm text-oxblood">{error}</p> : null}
            <div className="flex justify-end">
              <Button type="submit" disabled={pending}>
                {pending ? "Creating…" : "Create project"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
