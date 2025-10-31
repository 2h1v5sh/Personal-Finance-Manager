"use client";

import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
// import { ScrollArea } from "@/components/ui/scroll-area";
import { sendChatMessage, clearChatHistory } from "@/actions/chat";
import { Loader2, Send, Trash2, Bot, User } from "lucide-react";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";

export default function ChatInterface({ initialMessages = [] }) {
  const [messages, setMessages] = useState(initialMessages);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async (e) => {
    e.preventDefault();
    
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput("");
    setIsLoading(true);

    // Add user message immediately
    const newUserMessage = {
      id: Date.now().toString(),
      content: userMessage,
      role: 'user',
      createdAt: new Date().toISOString()
    };
    
    setMessages(prev => [...prev, newUserMessage]);

    try {
      const result = await sendChatMessage(userMessage);
      
      if (result.success) {
        // Add AI response
        const aiMessage = {
          id: (Date.now() + 1).toString(),
          content: result.message,
          role: 'assistant',
          createdAt: new Date().toISOString()
        };
        
        setMessages(prev => [...prev, aiMessage]);
        toast.success("Message sent successfully!");
      } else {
        toast.error(result.error || "Failed to send message");
        // Remove the user message if it failed
        setMessages(prev => prev.slice(0, -1));
      }
    } catch (error) {
      console.error("Error sending message:", error);
      toast.error("Failed to send message");
      setMessages(prev => prev.slice(0, -1));
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleClearChat = async () => {
    if (!confirm("Are you sure you want to clear your chat history?")) return;

    try {
      const result = await clearChatHistory();
      if (result.success) {
        setMessages([]);
        toast.success("Chat history cleared!");
      } else {
        toast.error(result.error || "Failed to clear chat");
      }
    } catch (error) {
      console.error("Error clearing chat:", error);
      toast.error("Failed to clear chat");
    }
  };

  const formatTimestamp = (timestamp) => {
    return new Date(timestamp).toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  return (
    <Card className="w-full max-w-4xl mx-auto h-[700px] flex flex-col overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <CardTitle className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-blue-600" />
          FinAI Assistant
        </CardTitle>
        <Button
          variant="outline"
          size="sm"
          onClick={handleClearChat}
          className="text-red-600 hover:bg-red-50"
        >
          <Trash2 className="w-4 h-4 mr-2" />
          Clear Chat
        </Button>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col space-y-4 p-6 overflow-hidden min-w-0">
        {/* Messages Area */}
        <div className="flex-1 pr-4 overflow-y-auto overflow-x-hidden">
          <div className="space-y-4 max-w-full">
            {messages.length === 0 ? (
              <div className="text-center text-gray-500 py-8">
                <Bot className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                <p className="text-lg font-medium mb-2">Welcome to FinAI!</p>
                <p className="text-sm">
                  I can help you with budgeting, expense analysis, financial planning, and more.
                  <br />
                  I have access to your account balances, transactions, and spending patterns.
                </p>
                <div className="mt-4 flex flex-wrap gap-2 justify-center">
                  <Badge variant="secondary">Budget Analysis</Badge>
                  <Badge variant="secondary">Spending Insights</Badge>
                  <Badge variant="secondary">Savings Tips</Badge>
                  <Badge variant="secondary">Financial Planning</Badge>
                </div>
                <div className="mt-6 space-y-2">
                  <p className="text-sm font-medium text-gray-700">Try asking me:</p>
                  <div className="space-y-1 text-xs text-gray-600">
                    <p>• &quot;How much did I spend on groceries this month?&quot;</p>
                    <p>• &quot;What&apos;s my biggest expense category?&quot;</p>
                    <p>• &quot;How can I improve my budget?&quot;</p>
                    <p>• &quot;Give me tips to save more money&quot;</p>
                  </div>
                </div>
              </div>
            ) : (
              messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex gap-3 max-w-full ${
                    message.role === 'user' ? 'justify-end' : 'justify-start'
                  }`}
                >
                  {message.role === 'assistant' && (
                    <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                      <Bot className="w-4 h-4 text-blue-600" />
                    </div>
                  )}
                  
                  <div
                    className={`max-w-[75%] min-w-0 rounded-lg px-4 py-2 break-words overflow-hidden word-wrap ${
                      message.role === 'user'
                        ? 'bg-blue-600 text-white ml-12'
                        : 'bg-gray-100 text-gray-900'
                    }`}
                    style={{ wordWrap: 'break-word', overflowWrap: 'break-word' }}
                  >
                    {message.role === 'user' ? (
                      <div className="whitespace-pre-wrap text-sm leading-relaxed">
                        {message.content}
                      </div>
                    ) : (
                      <div className="text-sm leading-relaxed prose prose-sm max-w-none overflow-wrap-anywhere">
                        <ReactMarkdown
                          components={{
                            // Custom styling for markdown elements
                            p: ({ children }) => <p className="mb-2 last:mb-0 break-words">{children}</p>,
                            strong: ({ children }) => <strong className="font-semibold text-gray-900 break-words">{children}</strong>,
                            em: ({ children }) => <em className="italic break-words">{children}</em>,
                            ul: ({ children }) => <ul className="list-disc list-inside mb-2 space-y-1 break-words">{children}</ul>,
                            ol: ({ children }) => <ol className="list-decimal list-inside mb-2 space-y-1 break-words">{children}</ol>,
                            li: ({ children }) => <li className="text-sm break-words">{children}</li>,
                            h1: ({ children }) => <h1 className="text-lg font-bold mb-2 break-words">{children}</h1>,
                            h2: ({ children }) => <h2 className="text-base font-bold mb-2 break-words">{children}</h2>,
                            h3: ({ children }) => <h3 className="text-sm font-bold mb-1 break-words">{children}</h3>,
                            code: ({ children }) => <code className="bg-gray-200 px-1 py-0.5 rounded text-xs font-mono break-all">{children}</code>,
                            pre: ({ children }) => <pre className="bg-gray-200 p-2 rounded text-xs font-mono overflow-x-auto mb-2 break-words whitespace-pre-wrap">{children}</pre>
                          }}
                        >
                          {message.content}
                        </ReactMarkdown>
                      </div>
                    )}
                    <div
                      className={`text-xs mt-1 ${
                        message.role === 'user' ? 'text-blue-100' : 'text-gray-500'
                      }`}
                    >
                      {formatTimestamp(message.createdAt)}
                    </div>
                  </div>

                  {message.role === 'user' && (
                    <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                      <User className="w-4 h-4 text-gray-600" />
                    </div>
                  )}
                </div>
              ))
            )}
            
            {isLoading && (
              <div className="flex gap-3 justify-start">
                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                  <Bot className="w-4 h-4 text-blue-600" />
                </div>
                <div className="bg-gray-100 rounded-lg px-4 py-2">
                  <div className="flex items-center gap-2 text-gray-600">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-sm">Thinking...</span>
                  </div>
                </div>
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input Area */}
        <form onSubmit={handleSend} className="flex gap-2">
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask me about your finances, budgeting, or financial advice..."
            disabled={isLoading}
            className="flex-1"
            maxLength={1000}
          />
          <Button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="px-4"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </form>

        <p className="text-xs text-gray-500 text-center">
          AI responses are generated based on your financial data and may not always be accurate. 
          Please consult with a qualified financial advisor for important decisions.
        </p>
      </CardContent>
    </Card>
  );
}