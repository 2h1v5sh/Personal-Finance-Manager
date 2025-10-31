import { sendChatMessage, getChatHistory } from "@/actions/chat";

export async function POST(request) {
  try {
    const { message } = await request.json();
    
    if (!message) {
      return Response.json({ error: "Message is required" }, { status: 400 });
    }

    const result = await sendChatMessage(message);
    return Response.json(result);
  } catch (error) {
    console.error("Chat API error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET() {
  try {
    const result = await getChatHistory();
    return Response.json(result);
  } catch (error) {
    console.error("Chat history API error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}