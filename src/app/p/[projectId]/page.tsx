import { ChatView } from "@/components/chat/chat-view";
import { loadWorkspace } from "@/lib/db/workspace";

export default async function NewChatPage({ params, searchParams }: PageProps<"/p/[projectId]">) {
  const { projectId } = await params;
  const { room } = await searchParams;
  const workspace = (await loadWorkspace(projectId))!;
  const roomId = typeof room === "string" && workspace.rooms.some((r) => r.id === room) ? room : null;
  return (
    <ChatView
      key={`new-${roomId ?? "project"}`}
      projectId={projectId}
      roomId={roomId}
      chatId={null}
      initialMessages={[]}
      initialSpeaker={workspace.lastSpeaker}
    />
  );
}
