import { getMessageById } from "@/lib/ephemeral/db";

export async function GET(request: Request, { params }: { params: Promise<{ messageId: string }> }) {
  const { messageId } = await params;

  try {
    const message = await getMessageById(messageId);
    if (!message) {
      return Response.json({ error: "Message not found" }, { status: 404 });
    }

    return Response.json(message);
  } catch (err) {
    console.error("Failed to fetch message:", err);
    return Response.json(
      { error: "Failed to fetch message status" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
