import { Suspense } from "react";
import { checkUser } from "@/lib/checkUser";
import { getChatHistory } from "@/actions/chat";
import ChatInterface from "@/components/chat-interface";
import { Loader2 } from "lucide-react";
import { redirect } from "next/navigation";

async function ChatPageContent() {
  // Check if user is authenticated
  const user = await checkUser();
  
  if (!user) {
    redirect("/sign-in");
  }

  // Get chat history
  const chatResult = await getChatHistory();
  const messages = chatResult.success ? chatResult.messages : [];

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          FinAI Assistant
        </h1>
        <p className="text-gray-600">
          Your intelligent personal finance advisor - Get personalized advice based on your transactions and accounts
        </p>
      </div>
      
      <ChatInterface initialMessages={messages} />
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense
      fallback={
        <div className="container mx-auto py-8 px-4">
          <div className="flex items-center justify-center h-64">
            <div className="flex items-center gap-2 text-gray-600">
              <Loader2 className="w-6 h-6 animate-spin" />
              <span>Loading your AI advisor...</span>
            </div>
          </div>
        </div>
      }
    >
      <ChatPageContent />
    </Suspense>
  );
}