"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteProject, deleteRoom, updateProject, updateRoom } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DecisionsSection, MemorySection, PanelSection, ProductsSection, ProposalsSection } from "@/components/notebook/sections";
import type { RoomRow } from "@/lib/db/types";
import type { Workspace } from "@/lib/db/workspace";

export function RightPanel({ workspace, activeRoom }: { workspace: Workspace; activeRoom: RoomRow | null }) {
  const { project, memories, decisions, products } = workspace;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto px-5 pb-8 pt-5">
      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-accent">Notebook</p>

      <ProjectForm key={project.id + project.updated_at} workspace={workspace} />

      {activeRoom ? <RoomForm key={activeRoom.id} room={activeRoom} projectId={project.id} /> : null}

      <ProposalsSection
        projectId={project.id}
        memories={memories.filter((m) => m.review_state === "proposed")}
        decisions={decisions.filter((d) => d.review_state === "proposed")}
      />
      <MemorySection projectId={project.id} memories={memories.filter((m) => m.review_state === "approved")} />
      <DecisionsSection projectId={project.id} decisions={decisions.filter((d) => d.review_state === "approved")} />
      <ProductsSection projectId={project.id} products={products} />
    </div>
  );
}

function useSaved() {
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 1800);
    return () => clearTimeout(t);
  }, [saved]);
  return [saved, setSaved] as const;
}

function ProjectForm({ workspace }: { workspace: Workspace }) {
  const { project } = workspace;
  const [name, setName] = useState(project.name);
  const [location, setLocation] = useState(project.location ?? "");
  const [brief, setBrief] = useState(project.brief ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useSaved();
  const [pending, start] = useTransition();
  const dirty = name !== project.name || location !== (project.location ?? "") || brief !== (project.brief ?? "");

  return (
    <form
      className="mt-3 space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const result = await updateProject({ id: project.id, name, location, brief });
          if (!result.ok) return setError(result.error);
          setError(null);
          setSaved(true);
        });
      }}
    >
      <input
        aria-label="Project name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full bg-transparent font-serif text-2xl leading-tight text-ink outline-none focus:underline focus:decoration-line-strong focus:underline-offset-4"
      />
      <div className="space-y-1.5">
        <Label htmlFor="project-location-edit">Place</Label>
        <Input
          id="project-location-edit"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="Where is it? City, landscape, climate"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="project-brief">Brief</Label>
        <Textarea
          id="project-brief"
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          rows={7}
          placeholder="Architecture, light, how you live here, who visits, constraints. Gio reads this on every turn."
          className="font-serif text-[15px] leading-relaxed md:text-[15px]"
        />
      </div>
      {error ? <p className="text-sm text-warn">{error}</p> : null}
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={!dirty || pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        {saved ? <span className="text-xs text-ok">Saved</span> : null}
        {!project.is_default ? <DeleteProject id={project.id} name={project.name} /> : null}
      </div>
    </form>
  );
}

function DeleteProject({ id, name }: { id: string; name: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      className="ml-auto text-xs text-ink-muted hover:text-warn"
      onClick={() => {
        if (!confirm(`Delete "${name}" with all its rooms and conversations? This can't be undone.`)) return;
        start(() => deleteProject(id).then(() => undefined));
      }}
    >
      Delete project
    </button>
  );
}

function RoomForm({ room, projectId }: { room: RoomRow; projectId: string }) {
  const router = useRouter();
  const [name, setName] = useState(room.name);
  const [notes, setNotes] = useState(room.notes ?? "");
  const [saved, setSaved] = useSaved();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const dirty = name !== room.name || notes !== (room.notes ?? "");

  return (
    <PanelSection title="Room">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const result = await updateRoom({ id: room.id, name, notes });
            if (!result.ok) return setError(result.error);
            setError(null);
            setSaved(true);
          });
        }}
      >
        <Input aria-label="Room name" value={name} onChange={(e) => setName(e.target.value)} />
        <Textarea
          aria-label="Room notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          placeholder="Dimensions, light, what's in it now, what isn't working."
          className="font-serif text-[15px] leading-relaxed md:text-[15px]"
        />
        {error ? <p className="text-sm text-warn">{error}</p> : null}
        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" disabled={!dirty || pending}>
            Save room
          </Button>
          {saved ? <span className="text-xs text-ok">Saved</span> : null}
          <button
            type="button"
            className="ml-auto text-xs text-ink-muted hover:text-warn"
            onClick={() => {
              if (!confirm(`Delete the room "${room.name}"? Its conversations stay in the project.`)) return;
              start(async () => {
                await deleteRoom(room.id);
                router.push(`/p/${projectId}`);
              });
            }}
          >
            Delete room
          </button>
        </div>
      </form>
    </PanelSection>
  );
}
