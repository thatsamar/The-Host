"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpIcon, SquareIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ChatServerEvent } from "@/lib/chat/service";
import { readNdjson } from "@/lib/chat/ndjson";
import type { MessageRow } from "@/lib/db/types";
import type { HumanSpeaker } from "@/lib/gio/speakers";
import { Message, type DisplayMessage } from "./message";
import { SpeakerToggle } from "./speaker-toggle";

const STARTERS = [
  "What is the highest-leverage move in this room?",
  "Create a lighting plan for the dining room.",
  "What have we learned about Courtney and Amar's taste?",
  "Find us a vintage lounge chair under $2,000 for the reading corner.",
];

function toDisplay(m: MessageRow): DisplayMessage {
  return {
    id: m.id,
    role: m.role,
    speaker: m.speaker,
    content: m.content,
    webSearches: m.metadata?.web_searches,
    webSources: m.metadata?.web_sources,
    error: m.metadata?.error,
  };
}

interface Props {
  projectId: string;
  roomId: string | null;
  chatId: string | null;
  initialMessages: MessageRow[];
  initialSpeaker: HumanSpeaker;
}

export function ChatView({ projectId, roomId, chatId: initialChatId, initialMessages, initialSpeaker }: Props) {
  const router = useRouter();
  const [messages, setMessages] = useState<DisplayMessage[]>(() => initialMessages.map(toDisplay));
  const [chatId, setChatId] = useState<string | null>(initialChatId);
  const [speaker, setSpeaker] = useState<HumanSpeaker>(initialSpeaker);
  const [input, setInput] = useState("");
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

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || streaming) return;
      setInput("");
      stickToBottom.current = true;
      const tempUserId = `local-user-${Date.now()}`;
      const tempAssistantId = `local-gio-${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        { id: tempUserId, role: "user", speaker, content: text },
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
          body: JSON.stringify({ chatId, projectId, roomId, speaker, text }),
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
        if (!initialChatId && resolvedChatId) router.replace(`/p/${projectId}/c/${resolvedChatId}`);
        router.refresh();
      }
    },
    [chatId, initialChatId, projectId, roomId, router, speaker, streaming, updateAssistant],
  );

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
                <Message key={m.id} message={m} />
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
          <div className="rounded-lg border border-stone-strong bg-paper-raised focus-within:border-tobacco focus-within:ring-2 focus-within:ring-tobacco/15">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder="Ask Gio…"
              aria-label="Message Gio"
              className="block max-h-60 w-full resize-none bg-transparent px-4 pt-3 text-base leading-relaxed text-ink outline-none placeholder:text-ink-muted"
            />
            <div className="flex items-center justify-between gap-2 px-2 pb-2 pt-1">
              <SpeakerToggle value={speaker} onChange={setSpeaker} disabled={streaming} />
              {streaming ? (
                <Button type="button" size="icon-sm" variant="outline" onClick={() => abortRef.current?.abort()} aria-label="Stop">
                  <SquareIcon className="size-3.5 fill-current" />
                </Button>
              ) : (
                <Button type="submit" size="icon-sm" variant="accent" disabled={!input.trim()} aria-label="Send">
                  <ArrowUpIcon />
                </Button>
              )}
            </div>
          </div>
        </form>
      </div>
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
