"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { finishUploads, startUploads } from "@/app/library-actions";
import { detectFileKind } from "@/lib/library/file-types";
import { createClient } from "@/lib/supabase/client";
import { notifyLibraryChanged } from "./use-library-processor";

const UPLOAD_CONCURRENCY = 3;

/**
 * Uploads files straight to the private `files` bucket, then queues them for
 * indexing. Returns the names in flight and any problems to show.
 */
export function useLibraryUpload() {
  const router = useRouter();
  const [uploading, setUploading] = useState<string[]>([]);
  const [problems, setProblems] = useState<string[]>([]);

  const upload = useCallback(
    async (list: FileList | File[], target: { projectId: string; roomId: string | null }) => {
      const chosen = Array.from(list);
      if (!chosen.length) return;
      setProblems([]);
      const started = await startUploads({
        projectId: target.projectId,
        roomId: target.roomId,
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
    },
    [router],
  );

  return { upload, uploading, problems };
}
