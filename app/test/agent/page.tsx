"use client";

import { useState } from "react";

type Message = {
  role: "user" | "assistant" | "system";
  content: string;
  toolCalls?: any[];
  toolResults?: any[];
};

export default function AgentTestPage() {
  const [projectId, setProjectId] = useState("");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [rawResponse, setRawResponse] = useState<any>(null);

  const handleSend = async () => {
    if (!input.trim() || !projectId.trim()) return;

    const userMessage: Message = { role: "user", content: input };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");
    setIsLoading(true);
    setRawResponse(null);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          prompt: input,
          messages: newMessages, // Send history as requested for multi-turn
        }),
      });

      const contentType = res.headers.get("content-type") || "";

      if (contentType.includes("application/json")) {
        const data = await res.json();
        setRawResponse(data);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: typeof data.message === "string" ? data.message : JSON.stringify(data, null, 2),
            toolCalls: data.toolCalls,
            toolResults: data.toolResults,
          },
        ]);
      } else {
        // Handle streaming response
        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        let assistantContent = "";

        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            assistantContent += chunk;
            setRawResponse((prev: any) => (prev ? prev + chunk : chunk));
            
            setMessages((prev) => {
              const updated = [...prev];
              if (updated.length > 0 && updated[updated.length - 1].role === "assistant") {
                updated[updated.length - 1].content = assistantContent;
              } else {
                updated.push({ role: "assistant", content: assistantContent });
              }
              return updated;
            });
          }
        }
      }
    } catch (error) {
      console.error(error);
      setMessages((prev) => [
        ...prev,
        { role: "system", content: `Error: ${error instanceof Error ? error.message : String(error)}` },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen p-8 font-sans bg-gray-50 text-gray-900">
      <div className="max-w-4xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold">Agent Pipeline Test Harness</h1>

        <div className="bg-white p-4 rounded shadow space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Project ID</label>
            <input
              type="text"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="w-full border border-gray-300 rounded p-2"
              placeholder="Enter projectId (required for tool execution)..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Prompt</label>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="w-full border border-gray-300 rounded p-2 min-h-[100px]"
              placeholder='e.g. "Create a simple counter component in React with Tailwind"'
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleSend}
              disabled={isLoading || !input.trim() || !projectId.trim()}
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? "Thinking..." : "Send to Agent"}
            </button>
            <button
              onClick={() => { setMessages([]); setRawResponse(null); }}
              className="bg-gray-200 text-gray-800 px-4 py-2 rounded hover:bg-gray-300"
            >
              Clear Chat
            </button>
          </div>
        </div>

        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Conversation Flow</h2>
          <div className="bg-white p-4 rounded shadow min-h-[300px] max-h-[600px] overflow-y-auto space-y-4 border border-gray-200">
            {messages.length === 0 && (
              <p className="text-gray-500 italic">No messages yet. Send a prompt to start the conversation.</p>
            )}
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`p-4 rounded-lg ${
                  msg.role === "user" ? "bg-blue-50 border border-blue-100" :
                  msg.role === "system" ? "bg-red-50 border border-red-100" :
                  "bg-gray-50 border border-gray-200"
                }`}
              >
                <div className="font-bold text-sm mb-2 text-gray-700 capitalize">
                  {msg.role}
                </div>
                <div className="whitespace-pre-wrap text-sm">{msg.content}</div>
                
                {msg.toolCalls && msg.toolCalls.length > 0 && (
                  <div className="mt-4 space-y-2">
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Tool Calls</div>
                    {msg.toolCalls.map((tc, j) => (
                      <pre key={j} className="bg-gray-800 text-green-400 p-3 rounded text-xs overflow-x-auto">
                        {JSON.stringify(tc, null, 2)}
                      </pre>
                    ))}
                  </div>
                )}

                {msg.toolResults && msg.toolResults.length > 0 && (
                  <div className="mt-4 space-y-2">
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Tool Results</div>
                    {msg.toolResults.map((tr, j) => (
                      <pre key={j} className="bg-gray-800 text-blue-400 p-3 rounded text-xs overflow-x-auto">
                        {JSON.stringify(tr, null, 2)}
                      </pre>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {isLoading && (
              <div className="p-4 rounded-lg bg-gray-50 border border-gray-200 animate-pulse">
                <div className="font-bold text-sm mb-2 text-gray-700">Assistant</div>
                <div className="text-gray-500 text-sm">Processing request...</div>
              </div>
            )}
          </div>
        </div>

        {rawResponse && (
          <div className="space-y-2">
            <h2 className="text-xl font-semibold">Raw API Response</h2>
            <pre className="bg-gray-800 text-gray-100 p-4 rounded shadow text-xs overflow-x-auto max-h-[300px]">
              {typeof rawResponse === "object" ? JSON.stringify(rawResponse, null, 2) : rawResponse}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
