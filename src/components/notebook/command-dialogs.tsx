"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderIcon } from "lucide-react";
import { createDecision, createMemory, draftDecisionFromMessage, draftMemoryFromMessage } from "@/app/memory-actions";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import type { HumanSpeaker } from "@/lib/gio/speakers";
import { preferenceTypeFor } from "@/lib/memory/attribution";
import { DecisionForm, type DecisionFormValue, MemoryForm, type MemoryFormValue } from "./forms";

/** What a command dialog was opened on: a saved message, or composer text. */
export interface CommandRequest {
  kind: "decision" | "memory";
  nonce: number;
  messageId?: string;
  text?: string;
  presetStatus?: DecisionFormValue["status"];
}

interface Scope {
  projectId: string;
  roomId: string | null;
  speaker: HumanSpeaker;
}

export function CommandDialogs({
  request,
  onClose,
  onSaved,
  scope,
}: {
  request: CommandRequest | null;
  onClose: () => void;
  onSaved?: (request: CommandRequest) => void;
  scope: Scope;
}) {
  const saved = () => {
    if (request) onSaved?.(request);
    onClose();
  };
  return (
    <Dialog open={Boolean(request)} onOpenChange={(open) => !open && onClose()}>
      {request?.kind === "decision" ? (
        <DialogContent
          title={request.presetStatus === "keep_looking" ? "Keep looking" : "Save as decision"}
          description="Logged in the project's decision log, linked to this message."
          className="max-h-[90dvh] max-w-lg overflow-y-auto"
        >
          <DecisionBody key={request.nonce} request={request} scope={scope} onCancel={onClose} onSaved={saved} />
        </DialogContent>
      ) : request?.kind === "memory" ? (
        <DialogContent title="Add to memory" description="Gio uses approved memories in every answer.">
          <MemoryBody key={request.nonce} request={request} scope={scope} onCancel={onClose} onSaved={saved} />
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

function Drafting() {
  return (
    <p className="flex items-center gap-2 py-6 text-sm text-ink-muted">
      <LoaderIcon className="size-4 animate-spin" /> Drafting from the message…
    </p>
  );
}

function DecisionBody({ request, scope, onCancel, onSaved }: { request: CommandRequest; scope: Scope; onCancel: () => void; onSaved: () => void }) {
  const router = useRouter();
  const fromText: DecisionFormValue = {
    title: (request.text ?? "").split("\n")[0].slice(0, 200),
    detail: (request.text ?? "").split("\n").slice(1).join("\n").trim(),
    status: request.presetStatus ?? "approved",
    product: null,
  };
  const [initial, setInitial] = useState<DecisionFormValue | null>(request.messageId ? null : fromText);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!request.messageId) return;
    let live = true;
    draftDecisionFromMessage(request.messageId, scope.speaker, request.presetStatus).then((res) => {
      if (!live) return;
      if (res.ok && res.data) {
        const d = res.data;
        setInitial({ title: d.title, detail: d.detail, status: d.status, product: d.product ? { ...d.product, status: "considering" } : null });
      } else {
        setNote(res.ok ? null : `Couldn't draft from the message (${res.error}). Fill it in below.`);
        setInitial(fromText);
      }
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- draft once per request
  }, [request.nonce]);

  if (!initial) return <Drafting />;
  return (
    <>
      {note ? <p className="mb-3 text-xs text-ink-muted">{note}</p> : null}
      {error ? <p className="mb-3 text-sm text-oxblood">{error}</p> : null}
      <DecisionForm
        initial={initial}
        submitLabel="Save decision"
        busy={busy}
        onCancel={onCancel}
        onSubmit={async (v) => {
          setBusy(true);
          const res = await createDecision({
            projectId: scope.projectId,
            roomId: scope.roomId,
            title: v.title,
            detail: v.detail || null,
            status: v.status,
            decidedBy: scope.speaker,
            sourceMessageId: request.messageId ?? null,
            product: v.product,
          });
          setBusy(false);
          if (!res.ok) return setError(res.error);
          router.refresh();
          onSaved();
        }}
      />
    </>
  );
}

function MemoryBody({ request, scope, onCancel, onSaved }: { request: CommandRequest; scope: Scope; onCancel: () => void; onSaved: () => void }) {
  const router = useRouter();
  const fromText: MemoryFormValue = {
    type: preferenceTypeFor(scope.speaker),
    content: request.text ?? "",
    attributedTo: scope.speaker,
    household: false,
  };
  const [initial, setInitial] = useState<MemoryFormValue | null>(request.messageId ? null : fromText);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!request.messageId) return;
    let live = true;
    draftMemoryFromMessage(request.messageId, scope.speaker).then((res) => {
      if (!live) return;
      if (res.ok && res.data) {
        const d = res.data;
        setInitial({ type: d.type, content: d.content, attributedTo: d.holder, household: d.scope === "household" });
      } else {
        setNote(res.ok ? null : `Couldn't draft from the message (${res.error}). Write it below.`);
        setInitial(fromText);
      }
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- draft once per request
  }, [request.nonce]);

  if (!initial) return <Drafting />;
  return (
    <>
      {note ? <p className="mb-3 text-xs text-ink-muted">{note}</p> : null}
      {error ? <p className="mb-3 text-sm text-oxblood">{error}</p> : null}
      <MemoryForm
        initial={initial}
        submitLabel="Remember"
        busy={busy}
        onCancel={onCancel}
        onSubmit={async (v) => {
          setBusy(true);
          const res = await createMemory({
            projectId: scope.projectId,
            roomId: scope.roomId,
            sourceMessageId: request.messageId ?? null,
            ...v,
          });
          setBusy(false);
          if (!res.ok) return setError(res.error);
          router.refresh();
          onSaved();
        }}
      />
    </>
  );
}
