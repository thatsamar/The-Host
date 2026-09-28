import { notFound } from "next/navigation";
import { ChatView } from "@/components/chat/chat-view";
import { loadChat, loadWorkspace } from "@/lib/db/workspace";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ChatPage({ params }: PageProps<"/p/[projectId]/c/[chatId]">) {
  const { projectId, chatId } = await params;
  if (!UUID.test(chatId)) notFound();
  const [workspace, loaded] = await Promise.all([loadWorkspace(projectId), loadChat(chatId)]);
  if (!loaded || loaded.chat.project_id !== projectId) notFound();
  return (
    <ChatView
      key={chatId}
      projectId={projectId}
      roomId={loaded.chat.room_id}
      chatId={chatId}
      initialMessages={loaded.messages}
      imageUrls={loaded.imageUrls}
      userId={workspace!.userId}
      initialSpeaker={workspace!.lastSpeaker}
    />
  );
}
