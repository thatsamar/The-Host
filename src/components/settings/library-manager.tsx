"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderIcon, RotateCcwIcon, UploadIcon } from "lucide-react";
import { reindexAllFiles } from "@/app/settings-actions";
import { FileItem, statusLabel } from "@/components/library/library-section";
import { notifyLibraryChanged } from "@/components/library/use-library-processor";
import { useLibraryUpload } from "@/components/library/use-library-upload";
import { selectClass } from "@/components/notebook/forms";
import { Button } from "@/components/ui/button";
import type { FileRow, ProjectRow, RoomRow } from "@/lib/db/types";
import { LIBRARY_ACCEPT } from "@/lib/library/file-types";
import { cn } from "@/lib/utils";

export function LibraryManager({
  files,
  projects,
  rooms,
  notice,
}: {
  files: FileRow[];
  projects: ProjectRow[];
  rooms: RoomRow[];
  notice: string | null;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [roomId, setRoomId] = useState("");
  const [view, setView] = useState("");
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const { upload, uploading, problems } = useLibraryUpload();
  const projectRooms = rooms.filter((r) => r.project_id === projectId);
  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  const roomName = new Map(rooms.map((r) => [r.id, r.name]));
  const shown = useMemo(() => (view ? files.filter((f) => f.project_id === view) : files), [files, view]);
  const tally = shown.reduce<Record<string, number>>((acc, f) => {
    acc[f.status] = (acc[f.status] ?? 0) + 1;
    return acc;
  }, {});

  const send = (list: FileList | File[]) => projectId && void upload(list, { projectId, roomId: roomId || null });

  return (
    <section>
      <h2 className="font-serif text-xl text-ink">Library</h2>
      <p className="mt-1 max-w-2xl text-sm text-ink-muted">
        Reference files for every project. Gio searches the current project plus the General Design Brain before each answer.
        Indexing runs while the app is open and resumes where it left off.
      </p>

      <div
        className={cn(
          "mt-5 rounded-lg border border-dashed border-stone-strong p-4 transition-colors",
          dragging && "border-tobacco bg-tobacco-soft/50",
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          send(e.dataTransfer.files);
        }}
      >
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <label className="space-y-1">
            <span className="block text-xs font-medium uppercase tracking-[0.08em] text-ink-muted">Project</span>
            <select
              className={selectClass + " h-10"}
              value={projectId}
              onChange={(e) => {
                setProjectId(e.target.value);
                setRoomId("");
              }}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="block text-xs font-medium uppercase tracking-[0.08em] text-ink-muted">Room</span>
            <select className={selectClass + " h-10"} value={roomId} onChange={(e) => setRoomId(e.target.value)}>
              <option value="">Whole project</option>
              {projectRooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <Button onClick={() => inputRef.current?.click()} className="w-full sm:w-auto">
              <UploadIcon /> Upload files
            </Button>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={LIBRARY_ACCEPT}
              className="hidden"
              onChange={(e) => {
                if (e.target.files) send(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
        </div>
        <p className="mt-2 text-xs text-ink-muted">PDF, JPEG, PNG, WebP, GIF, .docx, .txt and .md, up to 50 MB each. Or drop files here.</p>
        {uploading.map((n) => (
          <p key={n} className="mt-1 flex items-center gap-1.5 text-sm text-ink-muted">
            <LoaderIcon className="size-3.5 animate-spin" /> {n}
          </p>
        ))}
        {problems.map((p) => (
          <p key={p} className="mt-1 text-sm text-oxblood">
            {p}
          </p>
        ))}
        {notice ? <p className="mt-2 rounded-md bg-oxblood-soft px-2 py-1.5 text-sm text-oxblood">{notice}</p> : null}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <select aria-label="Show files from" className={selectClass + " h-9 w-auto"} value={view} onChange={(e) => setView(e.target.value)}>
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <span className="text-sm text-ink-muted">
          {shown.length} files
          {Object.entries(tally)
            .map(([s, n]) => ` · ${n} ${s}`)
            .join("")}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          disabled={pending || !shown.some((f) => f.status === "indexed" || f.status === "failed")}
          onClick={() => {
            if (
              !confirm(
                `Re-index ${view ? "this project's" : "every"} file? Image-heavy files are described again, which costs a background-model call per picture.`,
              )
            )
              return;
            start(async () => {
              const res = await reindexAllFiles(view || null);
              setMessage(res.ok ? `${res.data?.count ?? 0} files queued for re-indexing.` : res.error);
              router.refresh();
              notifyLibraryChanged();
            });
          }}
        >
          <RotateCcwIcon /> Re-index all
        </Button>
      </div>
      {message ? <p className="mt-2 text-sm text-olive">{message}</p> : null}

      <div className="mt-3 divide-y divide-stone border-y border-stone">
        {shown.length === 0 ? <p className="py-6 text-sm text-ink-muted">No files yet.</p> : null}
        {shown.map((f) => (
          <div key={f.id} className="flex items-start gap-3 py-1">
            <div className="min-w-0 flex-1">
              <FileItem file={f} roomName={f.room_id ? roomName.get(f.room_id) : undefined} />
            </div>
            <span className="hidden w-44 shrink-0 truncate pt-2 text-xs text-ink-muted sm:block" title={statusLabel(f).text}>
              {projectName.get(f.project_id)}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
