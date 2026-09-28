"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircleIcon,
  FileIcon,
  FileTextIcon,
  ImageIcon,
  LoaderIcon,
  MoreHorizontalIcon,
  RotateCcwIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import { deleteFile, fileViewUrl, finishUploads, reindexFile, startUploads } from "@/app/library-actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { FileRow, RoomRow } from "@/lib/db/types";
import { detectFileKind, LIBRARY_ACCEPT } from "@/lib/library/file-types";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { notifyLibraryChanged } from "./use-library-processor";

const UPLOAD_CONCURRENCY = 3;
const STALE_UPLOAD_MS = 30 * 60 * 1000;

interface Props {
  projectId: string;
  rooms: RoomRow[];
  files: FileRow[];
  activeRoomId: string | null;
  notice?: string | null;
}

export function LibrarySection({ projectId, rooms, files, activeRoomId, notice }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const roomName = new Map(rooms.map((r) => [r.id, r.name]));
  const visible = activeRoomId ? files.filter((f) => f.room_id === activeRoomId) : files;
  const target = activeRoomId ? roomName.get(activeRoomId) : null;

  async function upload(list: FileList | File[]) {
    const chosen = Array.from(list);
    if (!chosen.length) return;
    setProblems([]);
    const started = await startUploads({
      projectId,
      roomId: activeRoomId,
      files: chosen.map((f) => ({ name: f.name, size: f.size, type: f.type || detectFileKind(f.name)?.mime || "" })),
    });
    if (!started.ok) {
      setProblems([started.error]);
      return;
    }
    const issues = started.rejected.map((r) => `${r.name}: ${r.reason}`);
    setUploading(started.slots.map((s) => s.name));
    const supabase = createClient();
    const uploaded: string[] = [];
    const failed: string[] = [];
    const queue = [...started.slots];
    await Promise.all(
      Array.from({ length: UPLOAD_CONCURRENCY }, async () => {
        for (let slot = queue.shift(); slot; slot = queue.shift()) {
          const file = chosen[slot.index];
          const { error } = await supabase.storage
            .from("files")
            .upload(slot.storagePath, file, { contentType: slot.contentType, upsert: false });
          if (error) {
            failed.push(slot.fileId);
            issues.push(`${slot.name}: ${error.message}`);
          } else {
            uploaded.push(slot.fileId);
          }
          setUploading((u) => u.filter((n) => n !== slot.name));
        }
      }),
    );
    await finishUploads({ uploaded, failed });
    setProblems(issues);
    router.refresh();
    notifyLibraryChanged();
  }

  return (
    <section
      className={cn("mt-5 rounded-md transition-colors", dragging && "bg-tobacco-soft/60 outline-1 outline-dashed outline-tobacco")}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void upload(e.dataTransfer.files);
      }}
    >
      <div className="mb-1.5 flex items-center justify-between px-2">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-muted">
          Library{target ? ` · ${target}` : ""}
        </h2>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-ink-muted hover:bg-paper-raised hover:text-ink"
          aria-label="Upload files"
        >
          <UploadIcon className="size-3.5" /> Upload
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={LIBRARY_ACCEPT}
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void upload(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {notice ? <p className="mx-2 mb-2 rounded-md bg-oxblood-soft px-2 py-1.5 text-xs text-oxblood">{notice}</p> : null}
      {problems.map((p) => (
        <p key={p} className="mx-2 mb-1 text-xs text-oxblood">
          {p}
        </p>
      ))}

      <div className="space-y-0.5">
        {uploading.map((name) => (
          <div key={`up-${name}`} className="flex items-center gap-2 px-2 py-1.5 text-sm text-ink-muted">
            <LoaderIcon className="size-4 shrink-0 animate-spin" />
            <span className="min-w-0 flex-1 truncate">{name}</span>
          </div>
        ))}
        {visible.length === 0 && uploading.length === 0 ? (
          <p className="px-2 py-1.5 text-sm leading-snug text-ink-muted">
            {target ? `No files for ${target} yet.` : "No files yet."} Drop PDFs, photos, .docx or notes here.
          </p>
        ) : (
          visible.map((file) => (
            <FileItem key={file.id} file={file} roomName={!activeRoomId && file.room_id ? roomName.get(file.room_id) : undefined} />
          ))
        )}
      </div>
    </section>
  );
}

function KindIcon({ file }: { file: FileRow }) {
  const kind = detectFileKind(file.name, file.mime_type)?.kind;
  const className = "mt-0.5 size-4 shrink-0 text-ink-muted";
  if (kind === "image") return <ImageIcon className={className} />;
  if (kind === "pdf" || kind === "docx") return <FileTextIcon className={className} />;
  return <FileIcon className={className} />;
}

export function statusLabel(file: FileRow, now = Date.now()): { text: string; tone: "muted" | "busy" | "ok" | "bad" } {
  switch (file.status) {
    case "uploading":
      return now - new Date(file.created_at).getTime() > STALE_UPLOAD_MS
        ? { text: "Upload didn't finish", tone: "bad" }
        : { text: "Uploading…", tone: "busy" };
    case "pending":
      return { text: "Queued", tone: "muted" };
    case "processing": {
      const { next_unit, total_units } = file.progress ?? {};
      const isPdf = file.mime_type === "application/pdf";
      return {
        text: total_units && total_units > 1 ? `Indexing ${next_unit ?? 0}/${total_units}${isPdf ? " pages" : ""}` : "Indexing…",
        tone: "busy",
      };
    }
    case "indexed":
      return {
        text: `Indexed · ${file.chunk_count} ${file.chunk_count === 1 ? "passage" : "passages"}${file.page_count ? ` · ${file.page_count} pp` : ""}`,
        tone: "ok",
      };
    case "failed":
      return { text: file.error ? `Failed: ${file.error}` : "Failed", tone: "bad" };
  }
}

function FileItem({ file, roomName }: { file: FileRow; roomName?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const status = statusLabel(file);
  const warnings = file.progress?.warnings?.length ?? 0;

  return (
    <div className="group flex items-start rounded-md hover:bg-paper-raised/70">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-start gap-2 px-2 py-1.5 text-left"
        onClick={() =>
          start(async () => {
            const res = await fileViewUrl(file.id);
            if (res.ok) window.open(res.url, "_blank", "noopener,noreferrer");
          })
        }
        title={file.name}
      >
        <KindIcon file={file} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-ink-soft">{file.name}</span>
          <span
            className={cn(
              "flex items-center gap-1 truncate text-[11px]",
              status.tone === "bad" ? "text-oxblood" : status.tone === "ok" ? "text-olive" : "text-ink-muted",
            )}
          >
            {status.tone === "busy" ? <LoaderIcon className="size-3 shrink-0 animate-spin" /> : null}
            {status.tone === "bad" ? <AlertCircleIcon className="size-3 shrink-0" /> : null}
            <span className="truncate">
              {status.text}
              {warnings && file.status === "indexed" ? ` · ${warnings} skipped` : ""}
              {roomName ? ` · ${roomName}` : ""}
            </span>
          </span>
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={pending}
          className="mr-1 mt-1 rounded p-1 text-ink-muted hover:bg-paper-sunk hover:text-ink lg:opacity-0 lg:group-hover:opacity-100 data-[state=open]:opacity-100"
          aria-label="File options"
        >
          <MoreHorizontalIcon className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[10rem]">
          {file.status === "failed" || file.status === "indexed" ? (
            <DropdownMenuItem
              onSelect={() =>
                start(async () => {
                  await reindexFile(file.id);
                  router.refresh();
                  notifyLibraryChanged();
                })
              }
            >
              <RotateCcwIcon /> {file.status === "failed" ? "Retry" : "Re-index"}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            className="text-oxblood"
            onSelect={() => {
              if (!confirm(`Delete "${file.name}" from the library?`)) return;
              start(async () => {
                await deleteFile(file.id);
                router.refresh();
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
