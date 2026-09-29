"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUpIcon,
  BookmarkPlusIcon,
  CameraIcon,
  ImagePlusIcon,
  ListChecksIcon,
  LoaderIcon,
  RotateCcwIcon,
  ScaleIcon,
  ShoppingBagIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import { CommandDialogs, type CommandRequest } from "@/components/notebook/command-dialogs";
import { Button } from "@/components/ui/button";
import type { ChatServerEvent } from "@/lib/chat/service";
import { readNdjson } from "@/lib/chat/ndjson";
import type { MessageRow } from "@/lib/db/types";
import { MODE_LABELS, type ChatMode } from "@/lib/gio/modes";
import type { HumanSpeaker } from "@/lib/gio/speakers";
import { cn } from "@/lib/utils";
import { CHAT_PHOTO_ACCEPT, resizeForUpload } from "@/lib/library/client-image";
import { createClient } from "@/lib/supabase/client";
import { Message, type DisplayMessage, type MessageCommand } from "./message";
import { SpeakerToggle } from "./speaker-toggle";

const STARTERS = [
  "What is the highest-leverage move in this room?",
  "Create a lighting plan for the dining room.",
  "What have we learned about Courtney and Amar's taste?",
  "Find us a vintage lounge chair under $2,000 for the reading corner.",
];

const MAX_PHOTOS = 6;
const DRAFT_KEY = "gio.carryDraft";

function toDisplay(m: MessageRow, imageUrls: Record<string, string> = {}): DisplayMessage {
  return {
    id: m.id,
    role: m.role,
    speaker: m.speaker,
    content: m.content,
    images: (m.attachments ?? []).map((a) => imageUrls[a.storage_path]).filter(Boolean),
    webSearches: m.metadata?.web_searches,
    webSources: m.metadata?.web_sources,
    references: m.metadata?.references,
    mode: m.metadata?.mode ?? null,
    proposals: m.metadata?.proposals,
    error: m.metadata?.error,
  };
}

interface PendingPhoto {
  key: string;
  name: string;
  previewUrl: string;
  storagePath?: string;
  status: "uploading" | "ready" | "error";
  error?: string;
}

interface Props {
  projectId: string;
  roomId: string | null;
  chatId: string | null;
  initialMessages: MessageRow[];
  initialSpeaker: HumanSpeaker;
  /** Signed URLs for attached photos, keyed by storage path. */
  imageUrls: Record<string, string>;
  userId: string;
}

export function ChatView({
  projectId,
  roomId,
  chatId: initialChatId,
  initialMessages,
  initialSpeaker,
  imageUrls,
  userId,
}: Props) {
  const router = useRouter();
  const [messages, setMessages] = useState<DisplayMessage[]>(() => initialMessages.map((m) => toDisplay(m, imageUrls)));
  const [photos, setPhotos] = useState<PendingPhoto[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photosUploading = photos.some((p) => p.status === "uploading");
  const readyPhotos = photos.filter((p) => p.status === "ready");
  const [mode, setMode] = useState<ChatMode | null>(null);
  const [command, setCommand] = useState<CommandRequest | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);

  // Links from the notebook land on the source message (#msg-<id>).
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.startsWith("#msg-")) return;
    const id = hash.slice(5);
    const el = document.getElementById(`msg-${id}`);
    if (!el) return;
    stickToBottom.current = false;
    el.scrollIntoView({ block: "center" });
    const on = setTimeout(() => setHighlight(id), 50);
    const off = setTimeout(() => setHighlight(null), 2500);
    return () => {
      clearTimeout(on);
      clearTimeout(off);
    };
  }, []);
  const [chatId, setChatId] = useState<string | null>(initialChatId);
  const [speaker, setSpeaker] = useState<HumanSpeaker>(initialSpeaker);
  const [input, setInput] = useState("");
  // The latest draft, readable from async callbacks.
  const draftRef = useRef("");
  useEffect(() => {
    draftRef.current = input;
  }, [input]);
  // A new chat moves to its own URL after the first reply, which remounts this
  // view; pick up anything typed in the meantime.
  useEffect(() => {
    if (!initialChatId) return;
    try {
      const saved = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? "null") as { chatId: string; text: string } | null;
      if (saved?.chatId === initialChatId) {
        sessionStorage.removeItem(DRAFT_KEY);
        setInput(saved.text);
      }
    } catch {}
  }, [initialChatId]);
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Keep the newest text in view while streaming, unless the reader scrolled up.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const updateAssistant = useCallback((id: string, fn: (m: DisplayMessage) => DisplayMessage) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? fn(m) : m)));
  }, []);

  const addPhotos = useCallback(
    async (files: FileList | File[]) => {
      const room = MAX_PHOTOS - photos.length;
      const chosen = Array.from(files).slice(0, Math.max(0, room));
      const supabase = createClient();
      await Promise.all(
        chosen.map(async (file) => {
          const key = crypto.randomUUID();
          setPhotos((p) => [...p, { key, name: file.name, previewUrl: URL.createObjectURL(file), status: "uploading" }]);
          try {
            const blob = await resizeForUpload(file);
            const storagePath = `${userId}/chat/${key}.jpg`;
            const { error } = await supabase.storage
              .from("images")
              .upload(storagePath, blob, { contentType: "image/jpeg", upsert: false });
            if (error) throw new Error(error.message);
            setPhotos((p) => p.map((x) => (x.key === key ? { ...x, storagePath, status: "ready" } : x)));
          } catch (err) {
            const error = err instanceof Error ? err.message : "Upload failed";
            setPhotos((p) => p.map((x) => (x.key === key ? { ...x, status: "error", error } : x)));
          }
        }),
      );
    },
    [photos.length, userId],
  );

  const send = useCallback(
    async (raw: string, override?: { mode?: ChatMode | null }) => {
      const text = raw.trim();
      const attached = photos.filter((p) => p.status === "ready");
      const sendMode = override?.mode !== undefined ? override.mode : mode;
      if ((!text && !attached.length) || streaming || photosUploading) return;
      if (sendMode === "analyze_photo" && !attached.length) return;
      setMode(null);
      setInput("");
      setPhotos([]);
      stickToBottom.current = true;
      const tempUserId = `local-user-${Date.now()}`;
      const tempAssistantId = `local-gio-${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        { id: tempUserId, role: "user", speaker, content: text, images: attached.map((p) => p.previewUrl), mode: sendMode },
        { id: tempAssistantId, role: "assistant", speaker: "Gio", content: "", pending: true, webSearches: [], webSources: [] },
      ]);
      setStreaming(true);
      const controller = new AbortController();
      abortRef.current = controller;
      let assistantId = tempAssistantId;
      let resolvedChatId = chatId;

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chatId,
            projectId,
            roomId,
            speaker,
            text,
            attachments: attached.map((p) => ({ storagePath: p.storagePath, mimeType: "image/jpeg", name: p.name })),
            mode: sendMode,
          }),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error ?? `Request failed (${response.status})`);
        }
        for await (const event of readNdjson<ChatServerEvent>(response.body)) {
          switch (event.type) {
            case "meta":
              resolvedChatId = event.chatId;
              setChatId(event.chatId);
              setMessages((prev) => prev.map((m) => (m.id === tempUserId ? { ...m, id: event.userMessage.id } : m)));
              break;
            case "text":
              updateAssistant(assistantId, (m) => ({ ...m, content: m.content + event.text }));
              break;
            case "web_search":
              updateAssistant(assistantId, (m) => ({ ...m, webSearches: [...(m.webSearches ?? []), event.query] }));
              break;
            case "web_results":
              updateAssistant(assistantId, (m) => ({ ...m, webSources: [...(m.webSources ?? []), ...event.sources] }));
              break;
            case "done": {
              const final = toDisplay(event.message);
              updateAssistant(assistantId, () => final);
              assistantId = final.id;
              break;
            }
            case "error":
              updateAssistant(assistantId, (m) => ({ ...m, pending: false, error: event.message }));
              break;
            case "proposals":
              updateAssistant(assistantId, (m) => ({ ...m, proposals: { memories: event.memories, decisions: event.decisions } }));
              break;
            case "title":
              break;
          }
        }
      } catch (err) {
        const aborted = err instanceof DOMException && err.name === "AbortError";
        updateAssistant(assistantId, (m) => ({
          ...m,
          pending: false,
          error: aborted ? "Stopped." : err instanceof Error ? err.message : "Something went wrong.",
        }));
      } finally {
        updateAssistant(assistantId, (m) => ({ ...m, pending: false }));
        setStreaming(false);
        abortRef.current = null;
        // Move a new chat to its own URL, then re-render the shell so the
        // sidebar and header pick up the new conversation and its title.
        if (!initialChatId && resolvedChatId) {
          try {
            if (draftRef.current.trim()) {
              sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ chatId: resolvedChatId, text: draftRef.current }));
            }
          } catch {}
          router.replace(`/p/${projectId}/c/${resolvedChatId}`);
        }
        router.refresh();
      }
    },
    [chatId, initialChatId, mode, photos, photosUploading, projectId, roomId, router, speaker, streaming, updateAssistant],
  );

  const onMessageCommand = useCallback(
    (cmd: MessageCommand, message: DisplayMessage) => {
      const nonce = Date.now();
      if (cmd === "decision") setCommand({ kind: "decision", messageId: message.id, nonce });
      else if (cmd === "keep_looking") setCommand({ kind: "decision", messageId: message.id, nonce, presetStatus: "keep_looking" });
      else if (cmd === "memory") setCommand({ kind: "memory", messageId: message.id, nonce });
      else if (cmd === "compare") void send("Compare the options above.", { mode: "compare" });
      else if (cmd === "shopping_brief") void send("Turn this into a shopping brief.", { mode: "shopping_brief" });
    },
    [send],
  );

  const chooseMode = (next: ChatMode) => {
    setMode((current) => (current === next ? null : next));
    if (next === "analyze_photo" && !photos.length) fileInputRef.current?.click();
    textareaRef.current?.focus();
  };
  const needsPhoto = mode === "analyze_photo" && !readyPhotos.length;

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const finePointer = typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches;
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && finePointer) {
      e.preventDefault();
      void send(input);
    }
  };

  // Auto-grow the composer up to a limit.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [input]);

  return (
    <div className="flex h-full flex-col">
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
          {messages.length === 0 ? (
            <EmptyState onPick={(s) => setInput(s)} />
          ) : (
            <div className="space-y-9">
              {messages.map((m) => (
                <Message key={m.id} message={m} onCommand={onMessageCommand} highlighted={highlight === m.id} />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-stone bg-paper px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-6">
        <form
          className="mx-auto w-full max-w-2xl"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <CommandBar
            mode={mode}
            onMode={chooseMode}
            hasText={Boolean(input.trim())}
            disabled={streaming}
            onRemember={() => setCommand({ kind: "memory", text: input.trim(), nonce: Date.now() })}
            onDecision={() => setCommand({ kind: "decision", text: input.trim(), nonce: Date.now() })}
          />
          <div
            className="rounded-lg border border-stone-strong bg-paper-raised focus-within:border-tobacco focus-within:ring-2 focus-within:ring-tobacco/15"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (e.dataTransfer.files.length) void addPhotos(e.dataTransfer.files);
            }}
          >
            {photos.length ? (
              <div className="flex flex-wrap gap-2 px-3 pt-3">
                {photos.map((p) => (
                  <div key={p.key} className="relative" title={p.error ?? p.name}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- local preview */}
                    <img
                      src={p.previewUrl}
                      alt={p.name}
                      className={`size-16 rounded-md border border-stone object-cover ${p.status === "error" ? "opacity-40" : ""}`}
                    />
                    {p.status === "uploading" ? (
                      <LoaderIcon className="absolute inset-0 m-auto size-5 animate-spin text-paper drop-shadow" />
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setPhotos((all) => all.filter((x) => x.key !== p.key))}
                      className="absolute -right-1.5 -top-1.5 rounded-full border border-stone bg-paper-raised p-0.5 text-ink-muted hover:text-ink"
                      aria-label={`Remove ${p.name}`}
                    >
                      <XIcon className="size-3" />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            {photos.some((p) => p.status === "error") ? (
              <p className="px-4 pt-2 text-xs text-oxblood">
                {photos.find((p) => p.status === "error")?.error}
              </p>
            ) : null}
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder={
                mode
                  ? `${MODE_LABELS[mode]}${mode === "analyze_photo" ? ": attach a photo, add a note if you like" : ": add the details"}…`
                  : photos.length
                    ? "Add a note, or just send the photo…"
                    : "Ask Gio…"
              }
              aria-label="Message Gio"
              className="block max-h-60 w-full resize-none bg-transparent px-4 pt-3 text-base leading-relaxed text-ink outline-none placeholder:text-ink-muted"
            />
            <div className="flex items-center justify-between gap-2 px-2 pb-2 pt-1">
              <div className="flex items-center gap-1.5">
                <SpeakerToggle value={speaker} onChange={setSpeaker} disabled={streaming} />
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={streaming || photos.length >= MAX_PHOTOS}
                  aria-label="Attach photos"
                  title="Attach photos"
                >
                  <ImagePlusIcon />
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={CHAT_PHOTO_ACCEPT}
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) void addPhotos(e.target.files);
                    e.target.value = "";
                  }}
                />
              </div>
              {streaming ? (
                <Button type="button" size="icon-sm" variant="outline" onClick={() => abortRef.current?.abort()} aria-label="Stop">
                  <SquareIcon className="size-3.5 fill-current" />
                </Button>
              ) : (
                <Button
                  type="submit"
                  size="icon-sm"
                  variant="accent"
                  disabled={(!input.trim() && !readyPhotos.length) || photosUploading || needsPhoto}
                  aria-label="Send"
                >
                  <ArrowUpIcon />
                </Button>
              )}
            </div>
          </div>
        </form>
      </div>
      <CommandDialogs
        request={command}
        onClose={() => setCommand(null)}
        onSaved={(req) => {
          if (!req.messageId) setInput("");
        }}
        scope={{ projectId, roomId, speaker }}
      />
    </div>
  );
}

const chip =
  "inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-40 [&_svg]:size-3.5";

function CommandBar({
  mode,
  onMode,
  hasText,
  disabled,
  onRemember,
  onDecision,
}: {
  mode: ChatMode | null;
  onMode: (m: ChatMode) => void;
  hasText: boolean;
  disabled: boolean;
  onRemember: () => void;
  onDecision: () => void;
}) {
  const modes: { mode: ChatMode; icon: React.ReactNode }[] = [
    { mode: "analyze_photo", icon: <CameraIcon /> },
    { mode: "compare", icon: <ScaleIcon /> },
    { mode: "shopping_brief", icon: <ShoppingBagIcon /> },
    { mode: "keep_looking", icon: <RotateCcwIcon /> },
  ];
  return (
    <div className="-mx-1 mb-2 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]" role="toolbar" aria-label="Commands">
      {modes.map((m) => (
        <button
          key={m.mode}
          type="button"
          disabled={disabled}
          aria-pressed={mode === m.mode}
          onClick={() => onMode(m.mode)}
          className={cn(
            chip,
            mode === m.mode ? "border-oxblood bg-oxblood text-paper" : "border-stone text-ink-muted hover:border-stone-strong hover:text-ink",
          )}
        >
          {m.icon}
          {MODE_LABELS[m.mode]}
        </button>
      ))}
      <span className="mx-0.5 w-px shrink-0 bg-stone" aria-hidden />
      <button
        type="button"
        disabled={disabled || !hasText}
        onClick={onRemember}
        title="Save what you've typed as a memory, without sending it"
        className={cn(chip, "border-stone text-ink-muted hover:border-stone-strong hover:text-ink")}
      >
        <BookmarkPlusIcon /> Add to memory
      </button>
      <button
        type="button"
        disabled={disabled || !hasText}
        onClick={onDecision}
        title="Log what you've typed as a decision, without sending it"
        className={cn(chip, "border-stone text-ink-muted hover:border-stone-strong hover:text-ink")}
      >
        <ListChecksIcon /> Save as decision
      </button>
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="pt-[8vh]">
      <p className="font-serif text-3xl font-light leading-snug text-ink sm:text-4xl">What are we making better?</p>
      <p className="mt-3 max-w-md font-serif text-lg italic text-ink-muted">
        A room, a piece, a disagreement, a feeling you want at midnight.
      </p>
      <ul className="mt-10 space-y-1 border-t border-stone pt-4">
        {STARTERS.map((s) => (
          <li key={s}>
            <button
              type="button"
              onClick={() => onPick(s)}
              className="w-full rounded-md px-2 py-2 text-left text-[15px] text-ink-soft transition-colors hover:bg-paper-sunk hover:text-ink"
            >
              {s}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
