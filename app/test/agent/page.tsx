"use client";

import { useState, useEffect, useRef } from "react";

interface ProjectFile {
  id: string;
  path: string;
  createdAt: string;
  updatedAt: string;
}

interface ProjectMessage {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  createdAt: string;
}

interface ProjectDetails {
  id: string;
  name: string;
  description: string | null;
  status: string;
  files: ProjectFile[];
  messages: ProjectMessage[];
}

interface StatusDetails {
  status: string;
  latestWorkflow: {
    id: string;
    type: string;
    status: string;
  } | null;
  latestExecution: {
    id: string;
    status: string;
    nodeCount: number;
  } | null;
}

export default function Phase4TestDashboard() {
  // Navigation & Project selection
  const [projectId, setProjectId] = useState("");
  const [domain, setDomain] = useState("FULL_STACK_APPLICATION");
  const [project, setProject] = useState<ProjectDetails | null>(null);
  const [statusInfo, setStatusInfo] = useState<StatusDetails | null>(null);

  // Discovery chat
  const [discoveryPrompt, setDiscoveryPrompt] = useState("");
  const [isDiscoveryLoading, setIsDiscoveryLoading] = useState(false);
  const [discoveryCompleteInfo, setDiscoveryCompleteInfo] = useState<{
    complete: boolean;
    artifactId?: string;
  } | null>(null);

  // HCR chat
  const [hcrPrompt, setHcrPrompt] = useState("");
  const [isHcrLoading, setIsHcrLoading] = useState(false);

  // File Preview
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [selectedFileContent, setSelectedFileContent] = useState<string>("");
  const [isFileLoading, setIsFileLoading] = useState(false);

  // Error/Log feedback
  const [logs, setLogs] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState("");

  const addLog = (msg: string) => {
    setLogs((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev]);
  };

  // 1. Create Project
  const handleCreateProject = async () => {
    setErrorMsg("");
    try {
      addLog(`Creating project with domain: ${domain}...`);
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create project");

      setProjectId(data.projectId);
      addLog(`Project created successfully! ID: ${data.projectId}`);
      await handleLoadProject(data.projectId);
    } catch (err: any) {
      setErrorMsg(err.message);
      addLog(`Error: ${err.message}`);
    }
  };

  // 2. Load Project details
  const handleLoadProject = async (targetId?: string) => {
    setErrorMsg("");
    const idToLoad = targetId || projectId;
    if (!idToLoad.trim()) {
      setErrorMsg("Please enter a Project ID");
      return;
    }

    try {
      addLog(`Loading project ${idToLoad}...`);
      const res = await fetch(`/api/projects/${idToLoad}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.msg || "Project not found");

      setProject(data.project);
      setProjectId(idToLoad);
      addLog(`Loaded project state. Status: ${data.project.status}`);

      // Reset selected file on project load
      setSelectedFileId(null);
      setSelectedFileContent("");

      // Trigger status check
      await handleRefreshStatus(idToLoad);
    } catch (err: any) {
      setErrorMsg(err.message);
      addLog(`Error: ${err.message}`);
    }
  };

  // 3. Refresh status & latest execution
  const handleRefreshStatus = async (targetId?: string) => {
    const idToCheck = targetId || projectId;
    if (!idToCheck) return;

    try {
      const res = await fetch(`/api/projects/${idToCheck}/status`);
      const data = await res.json();
      if (res.ok) {
        setStatusInfo(data);
        // Sync project status state if project is loaded
        setProject((prev) => (prev ? { ...prev, status: data.status } : null));
      }
    } catch (err) {
      console.error("Failed to fetch status:", err);
    }
  };

  // Auto-poll status when in progress or discovery (to watch discovery complete or HCR runs)
  useEffect(() => {
    if (!projectId) return;

    // Set up polling interval
    const interval = setInterval(() => {
      handleRefreshStatus();
      // Also refresh file tree occasionally if running to capture updates
      if (project?.status === "IN_PROGRESS") {
        fetchFileTreeOnly();
      }
    }, 2500);

    return () => clearInterval(interval);
  }, [projectId, project?.status]);

  const fetchFileTreeOnly = async () => {
    if (!projectId) return;
    try {
      const res = await fetch(`/api/projects/${projectId}`);
      const data = await res.json();
      if (res.ok && data.project) {
        setProject((prev) => prev ? { ...prev, files: data.project.files } : null);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // 4. Discovery Chat Send
  const handleSendDiscovery = async () => {
    if (!discoveryPrompt.trim() || !projectId) return;
    setIsDiscoveryLoading(true);
    setErrorMsg("");
    addLog(`Sending discovery prompt...`);

    const userMsg = discoveryPrompt;
    setDiscoveryPrompt("");

    // optimistic user message insertion
    setProject((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        messages: [
          ...prev.messages,
          { id: `temp-usr-${Date.now()}-${Math.random()}`, role: "USER", content: userMsg, createdAt: new Date().toISOString() },
        ],
      };
    });

    try {
      const res = await fetch(`/api/projects/${projectId}/discovery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: userMsg }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Discovery message failed");

      addLog(`Discovery response received.`);
      setDiscoveryCompleteInfo({
        complete: data.discoveryComplete,
        artifactId: data.artifactId,
      });

      // reload full state to grab server-saved messages
      await handleLoadProject(projectId);
    } catch (err: any) {
      setErrorMsg(err.message);
      addLog(`Discovery Error: ${err.message}`);
    } finally {
      setIsDiscoveryLoading(false);
    }
  };

  // 5. HCR Chat Send
  const handleSendHcr = async () => {
    if (!hcrPrompt.trim() || !projectId) return;
    setIsHcrLoading(true);
    setErrorMsg("");
    addLog(`Triggering HCR coding run...`);

    const userMsg = hcrPrompt;
    setHcrPrompt("");

    // optimistic user message insertion
    setProject((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        messages: [
          ...prev.messages,
          { id: `temp-usr-${Date.now()}-${Math.random()}`, role: "USER", content: userMsg, createdAt: new Date().toISOString() },
        ],
      };
    });

    try {
      const res = await fetch(`/api/projects/${projectId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: userMsg }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "HCR run initiation failed");

      addLog(`HCR workflow started successfully.`);
      // reload full state
      await handleLoadProject(projectId);
    } catch (err: any) {
      setErrorMsg(err.message);
      addLog(`HCR Error: ${err.message}`);
    } finally {
      setIsHcrLoading(false);
    }
  };

  // 6. View File Content
  const handleViewFile = async (fileId: string) => {
    setSelectedFileId(fileId);
    setSelectedFileContent("");
    setIsFileLoading(true);
    setErrorMsg("");

    try {
      const res = await fetch(`/api/projects/${projectId}/files/${fileId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load file content");

      setSelectedFileContent(data.file.content);
      addLog(`Loaded file: ${data.file.path}`);
    } catch (err: any) {
      setErrorMsg(err.message);
      addLog(`File Load Error: ${err.message}`);
    } finally {
      setIsFileLoading(false);
    }
  };

  return (
    <div className="min-h-screen p-6 font-sans bg-slate-900 text-slate-100 flex flex-col">
      {/* Header */}
      <header className="border-b border-slate-800 pb-4 mb-6 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-white flex items-center gap-2">
            <span className="w-3 h-3 bg-indigo-500 rounded-full inline-block animate-ping"></span>
            Doable Phase 4 Manual Testing Dashboard
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Manual flow sandbox to validate requirements discovery, HCR agent loops, polling, and versioned artifacts.
          </p>
        </div>
        <div className="flex gap-2">
          {projectId && (
            <button
              onClick={() => handleLoadProject()}
              className="bg-slate-800 hover:bg-slate-700 text-white px-3 py-1.5 rounded text-xs border border-slate-700 transition"
            >
              Sync Dashboard
            </button>
          )}
        </div>
      </header>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1">
        {/* LEFT COLUMN: Controls & Project Status (width 4/12) */}
        <div className="lg:col-span-4 space-y-6 flex flex-col">
          {/* Project Setup */}
          <div className="bg-slate-800 p-5 rounded-lg border border-slate-700 space-y-4">
            <h2 className="text-lg font-bold text-white border-b border-slate-700 pb-2">1. Project Control</h2>
            
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1 uppercase">Domain Intent</label>
                <select
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
                >
                  <option value="FULL_STACK_APPLICATION">Full Stack Application</option>
                  <option value="LANDING_PAGE">Landing Page</option>
                </select>
              </div>

              <button
                onClick={handleCreateProject}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-sm py-2 rounded transition"
              >
                Create Project
              </button>
            </div>

            <div className="border-t border-slate-700 pt-4 space-y-2">
              <label className="block text-xs font-semibold text-slate-400 uppercase">Active Project ID</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  placeholder="Paste projectId here..."
                  className="flex-1 bg-slate-900 border border-slate-700 rounded p-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
                />
                <button
                  onClick={() => handleLoadProject()}
                  className="bg-slate-700 hover:bg-slate-600 text-white px-3 py-2 rounded text-sm transition"
                >
                  Load
                </button>
              </div>
            </div>
          </div>

          {/* Project Details / Polling Status */}
          <div className="bg-slate-800 p-5 rounded-lg border border-slate-700 space-y-4 flex-1">
            <h2 className="text-lg font-bold text-white border-b border-slate-700 pb-2 flex justify-between items-center">
              <span>2. Live Polling Status</span>
              <span className="text-[10px] text-slate-400 font-mono">2.5s Polling</span>
            </h2>

            {project ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="bg-slate-900 p-3 rounded border border-slate-800">
                    <span className="text-xs text-slate-400 block mb-0.5">Project Status</span>
                    <span className="font-mono text-indigo-400 font-bold uppercase">{project.status}</span>
                  </div>
                  <div className="bg-slate-900 p-3 rounded border border-slate-800">
                    <span className="text-xs text-slate-400 block mb-0.5">DB Messages</span>
                    <span className="font-mono font-bold text-slate-200">{project.messages.length}</span>
                  </div>
                </div>

                {statusInfo && (
                  <div className="space-y-3 bg-slate-900 p-4 rounded border border-slate-800 text-xs">
                    <div>
                      <span className="text-slate-400 block">Latest Workflow</span>
                      {statusInfo.latestWorkflow ? (
                        <div className="mt-1 flex items-center justify-between font-mono text-slate-200">
                          <span className="bg-slate-800 px-1.5 py-0.5 rounded text-[11px]">{statusInfo.latestWorkflow.type}</span>
                          <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-bold ${
                            statusInfo.latestWorkflow.status === "COMPLETED" ? "bg-green-950 text-green-400" :
                            statusInfo.latestWorkflow.status === "FAILED" ? "bg-red-950 text-red-400" :
                            "bg-yellow-950 text-yellow-400 animate-pulse"
                          }`}>
                            {statusInfo.latestWorkflow.status}
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-500 italic block mt-0.5">No workflow yet</span>
                      )}
                    </div>

                    <div className="border-t border-slate-800 pt-2.5">
                      <span className="text-slate-400 block">Latest Execution</span>
                      {statusInfo.latestExecution ? (
                        <div className="mt-1 space-y-1 font-mono text-slate-200">
                          <div className="flex justify-between items-center">
                            <span>Status:</span>
                            <span className="text-slate-300 font-bold uppercase">{statusInfo.latestExecution.status}</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span>Nodes Ran:</span>
                            <span className="text-indigo-400 font-bold">{statusInfo.latestExecution.nodeCount}</span>
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-500 italic block mt-0.5">No execution yet</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-slate-500 text-sm italic">No project loaded. Create or load a project above to view status.</p>
            )}
          </div>
        </div>

        {/* MIDDLE COLUMN: Interactive Workflows (width 5/12) */}
        <div className="lg:col-span-5 space-y-6 flex flex-col">
          {/* Workflow Chat panels */}
          <div className="bg-slate-800 p-5 rounded-lg border border-slate-700 flex-1 flex flex-col space-y-4">
            <h2 className="text-lg font-bold text-white border-b border-slate-700 pb-2">3. Workflow Interactive Execution</h2>

            {project ? (
              <div className="flex-1 flex flex-col space-y-4">
                {/* Status-specific instructions */}
                {project.status === "DISCOVERY" && (
                  <div className="bg-indigo-950 border border-indigo-900 p-3.5 rounded text-xs text-indigo-300">
                    <strong className="block mb-1">Requirement Gathering Active</strong>
                    Answer the discovery agent's queries. Once discovery is complete, the platform flips status to PENDING and generates requirements artifacts.
                  </div>
                )}
                {project.status === "PENDING" && (
                  <div className="bg-emerald-950 border border-emerald-900 p-3.5 rounded text-xs text-emerald-300">
                    <strong className="block mb-1">Requirements Captured Successfully!</strong>
                    The project status is PENDING. You can now prompt the HCR agent to initiate coding run.
                  </div>
                )}
                {project.status === "IN_PROGRESS" && (
                  <div className="bg-amber-950 border border-amber-900 p-3.5 rounded text-xs text-amber-300">
                    <strong className="block mb-1">HCR Codebase Generation Running</strong>
                    The senior coding agent is modifying components. Watch progress count or review execution events.
                  </div>
                )}

                {/* Conversation messages */}
                <div className="flex-1 overflow-y-auto bg-slate-900 p-4 rounded border border-slate-950 space-y-3 max-h-[350px]">
                  {project.messages.length === 0 && (
                    <span className="text-slate-500 italic text-sm">No messages yet.</span>
                  )}
                  {project.messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`p-3 rounded text-xs max-w-[85%] ${
                        msg.role === "USER"
                          ? "bg-indigo-650 ml-auto text-white"
                          : "bg-slate-800 text-slate-200 border border-slate-700"
                      }`}
                    >
                      <span className="font-bold text-[9px] uppercase block mb-1 text-slate-300">{msg.role}</span>
                      <div className="whitespace-pre-wrap">{msg.content}</div>
                    </div>
                  ))}
                </div>

                {/* Discovery complete alert */}
                {discoveryCompleteInfo?.complete && (
                  <div className="bg-green-900/40 border border-green-800 p-3 rounded text-xs text-green-300">
                    ✓ Discovery completed. Artifact Created: <span className="font-mono text-white text-[11px]">{discoveryCompleteInfo.artifactId}</span>
                  </div>
                )}

                {/* Inputs based on current status */}
                {project.status === "DISCOVERY" ? (
                  <div className="space-y-2 pt-2 border-t border-slate-700">
                    <span className="text-xs text-slate-400 block uppercase font-bold">Send to Discovery Route</span>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={discoveryPrompt}
                        onChange={(e) => setDiscoveryPrompt(e.target.value)}
                        placeholder="e.g. Surprise me..."
                        className="flex-1 bg-slate-900 border border-slate-700 rounded p-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                        onKeyDown={(e) => e.key === "Enter" && handleSendDiscovery()}
                      />
                      <button
                        onClick={handleSendDiscovery}
                        disabled={isDiscoveryLoading || !discoveryPrompt.trim()}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 rounded text-xs font-semibold disabled:opacity-50"
                      >
                        {isDiscoveryLoading ? "..." : "Send"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2 pt-2 border-t border-slate-700">
                    <span className="text-xs text-slate-400 block uppercase font-bold">Start HCR Coding Task</span>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={hcrPrompt}
                        onChange={(e) => setHcrPrompt(e.target.value)}
                        placeholder="e.g. Build counter app..."
                        className="flex-1 bg-slate-900 border border-slate-700 rounded p-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                        onKeyDown={(e) => e.key === "Enter" && handleSendHcr()}
                      />
                      <button
                        onClick={handleSendHcr}
                        disabled={isHcrLoading || !hcrPrompt.trim()}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 rounded text-xs font-semibold disabled:opacity-50"
                      >
                        {isHcrLoading ? "..." : "Trigger"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-slate-500 text-sm italic">Load project to start workflows.</p>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: Code tree & Files (width 3/12) */}
        <div className="lg:col-span-3 space-y-6 flex flex-col">
          <div className="bg-slate-800 p-5 rounded-lg border border-slate-700 flex-1 flex flex-col space-y-4">
            <h2 className="text-lg font-bold text-white border-b border-slate-700 pb-2">4. Generated Files</h2>

            {project ? (
              <div className="flex-1 flex flex-col space-y-4">
                <div className="flex-1 overflow-y-auto bg-slate-900 p-3 rounded border border-slate-950 max-h-[300px]">
                  {project.files.length === 0 ? (
                    <span className="text-slate-500 italic text-xs">No files generated yet.</span>
                  ) : (
                    <ul className="space-y-1">
                      {project.files.map((f) => (
                        <li key={f.id}>
                          <button
                            onClick={() => handleViewFile(f.id)}
                            className={`w-full text-left text-xs font-mono py-1 px-2 rounded truncate transition ${
                              selectedFileId === f.id
                                ? "bg-indigo-650 text-white"
                                : "text-slate-300 hover:bg-slate-800"
                            }`}
                          >
                            📁 {f.path}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {selectedFileId && (
                  <div className="border-t border-slate-700 pt-3 space-y-2 flex-1 flex flex-col">
                    <span className="text-xs text-indigo-400 font-semibold block uppercase">File Preview</span>
                    <div className="flex-1 bg-slate-950 p-3 rounded font-mono text-[10px] text-green-400 overflow-auto max-h-[250px] border border-slate-950 relative">
                      {isFileLoading ? (
                        <span className="text-slate-500 italic">Loading file content...</span>
                      ) : (
                        <pre className="whitespace-pre-wrap">{selectedFileContent || "(empty file)"}</pre>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-slate-500 text-sm italic">Load project to see generated components.</p>
            )}
          </div>
        </div>
      </div>

      {/* FOOTER Console Logs */}
      <div className="mt-6 bg-slate-800 border border-slate-700 p-4 rounded-lg">
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Logs & Operations Terminal</h2>
        {errorMsg && (
          <div className="bg-red-950 border border-red-900 text-red-300 text-xs p-2.5 rounded mb-3">
            ⚠ Error: {errorMsg}
          </div>
        )}
        <div className="bg-slate-950 p-3 rounded font-mono text-xs text-indigo-300 h-28 overflow-y-auto space-y-1 border border-slate-900">
          {logs.length === 0 && <span className="text-slate-600">Terminal ready. Load a project to begin.</span>}
          {logs.map((lg, i) => (
            <div key={i}>{lg}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
