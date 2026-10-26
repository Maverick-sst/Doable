/**
 * Local test double for the Ollama provider seam. It lets the full HCR graph
 * run without spending real model tokens. Not a production server.
 *
 *   bun scripts/mock-provider.ts
 */
import { createServer } from "node:http";

type Message = {
  role: string;
  content?: string | null;
  tool_calls?: unknown[];
};

function architectureSpec() {
  return {
    projectUnderstanding: {
      oneLiner: "A tiny demo app",
      coreValue: "Proves the graph works",
      targetUser: "Developer",
      successCriteria: ["Build completes"],
    },
    architectureDecisions: {
      pattern: "SPA with local API",
      reasoning: "Smallest runnable shape",
      tradeoffs: ["Minimal"],
    },
    systemBoundaries: {
      frontend: "React + Vite",
      backend: "Node",
      database: "Postgres",
      externalServices: [],
    },
    majorImplementationAreas: ["UI", "API"],
    executionStrategy: "Create UI then API",
    risksIdentified: ["None significant"],
  };
}

function researchDossier() {
  return {
    frameworkRecommendations: [
      {
        name: "React",
        version: "latest",
        justification: "Simple UI",
        alternatives: ["Vue"],
      },
    ],
    implementationPatterns: [
      {
        area: "UI",
        recommendedPattern: "Small components",
        codePattern: "function App() {}",
        reasoning: "Clear",
      },
    ],
    libraryChoices: [
      {
        library: "react",
        purpose: "UI",
        installCommand: "npm install react",
        justification: "Required",
      },
    ],
    technicalFindings: ["Keep it small"],
    risks: [],
    projectStructure: {
      directories: ["src"],
      namingConventions: "kebab-case",
    },
  };
}

function approvedPrd() {
  return {
    validatedRequirements: [
      {
        feature: "Demo screen",
        acceptanceCriteria: ["Renders"],
        priority: "must-have",
        complexity: "low",
      },
    ],
    clarifiedScope: {
      inScope: ["Demo screen"],
      outOfScope: ["Auth"],
      deferredToLater: [],
    },
    resolvedAmbiguities: [],
    implementationReadyPlan: [
      {
        phase: "Phase 1",
        description: "Build the demo",
        deliverables: ["UI"],
        blockers: [],
      },
    ],
    estimatedComplexity: "low",
    approvalNotes: "Approved for the test",
  };
}

function executionPlan() {
  return {
    frontendTasks: [
      {
        id: "FE-001",
        title: "Create App",
        description: "Create the root component",
        filesToCreate: ["src/App.tsx"],
        filesToModify: [],
        dependencies: [],
        estimatedLines: 10,
        acceptanceCriteria: ["Renders"],
      },
    ],
    backendTasks: [
      {
        id: "BE-001",
        title: "Create API",
        description: "Create a tiny server",
        filesToCreate: ["server/index.ts"],
        filesToModify: [],
        dependencies: [],
        estimatedLines: 10,
        acceptanceCriteria: ["Starts"],
      },
    ],
    sharedTasks: [],
    executionOrder: [{ phase: 1, taskIds: ["FE-001", "BE-001"], canParallelize: true }],
    projectStructure: { rootFiles: ["package.json"], directories: ["src", "server"] },
    dependencyInstallCommands: ["npm install react"],
  };
}

function nodeKind(messages: Message[]): string {
  const system = messages.find((message) => message.role === "system")?.content ?? "";
  if (system.includes("requirement discovery agent")) return "DISCOVERY";
  if (system.includes("Principal Software Architect")) return "ARCHITECT";
  if (system.includes("Senior Technical Researcher")) return "RESEARCH";
  if (system.includes("Product Manager and Requirements Engineer")) return "PRD";
  if (system.includes("Staff Software Engineer")) return "PLANNER";
  if (system.includes("Senior Frontend Engineer")) return "FRONTEND";
  if (system.includes("Senior Backend Engineer")) return "BACKEND";
  return "UNKNOWN";
}

/**
 * Per-node failure counter for the resume drill.
 *
 * The structured executor retries a bad JSON response three times inside one
 * activity attempt before failing non-retryably, so a drill must fail at
 * least that many calls to make the first attempt actually fail.
 */
const failureCounts = new Map<string, number>();

function failureLimit(): number {
  const explicit = Number(process.env.MOCK_FAIL_TIMES);
  if (Number.isFinite(explicit) && explicit >= 0) return explicit;
  if (process.env.MOCK_FAIL_ONCE === "1") return 1;
  return Number.POSITIVE_INFINITY;
}

function chatResponse(messages: Message[]) {
  const kind = nodeKind(messages);
  const hasToolResult = messages.some((message) => message.role === "tool");

  const count = failureCounts.get(kind) ?? 0;
  const shouldFail =
    process.env.MOCK_FAIL_NODE === kind && count < failureLimit();

  if (shouldFail) {
    failureCounts.set(kind, count + 1);
    return { message: { content: "this is not valid json" } };
  }

  // Never finish: keeps producing files until the node budget is exhausted.
  // Only tool nodes make sense here; structured nodes must return JSON.
  if (
    process.env.MOCK_NEVER_COMPLETE === "1" &&
    (kind === "FRONTEND" || kind === "BACKEND")
  ) {
    const path = `src/generated-${Date.now()}.txt`;
    return {
      message: {
        content: "",
        tool_calls: [
          {
            function: {
              name: "create_file",
              arguments: JSON.stringify({ path, content: "generated\n" }),
            },
          },
        ],
      },
    };
  }

  if (kind === "DISCOVERY") {
    return {
      message: {
        content: JSON.stringify({
          message: "Approved. I have enough to start building.",
          discoveryComplete: true,
          requirements: {
            description: "A tiny demo app",
            features: ["demo screen"],
            userFlows: [],
            dataEntities: [],
            authRequirements: [],
            integrations: [],
            technicalConstraints: [],
            productConstraints: [],
            assumptions: [],
            ambiguities: [],
            acceptanceCriteria: ["Renders"],
          },
          techStack: { frontend: "React", backend: "Node", database: "Postgres", auth: "local" },
        }),
      },
    };
  }

  if (kind === "FRONTEND" || kind === "BACKEND") {
    if (hasToolResult) {
      return {
        message: {
          content: "",
          tool_calls: [
            {
              function: {
                name: "mark_complete",
                arguments: JSON.stringify({ summary: `${kind} done` }),
              },
            },
          ],
        },
      };
    }
    const path = kind === "FRONTEND" ? "src/App.tsx" : "server/index.ts";
    const content =
      kind === "FRONTEND"
        ? "export default function App() { return <main>Hello</main>; }\n"
        : "console.log('server');\n";
    return {
      message: {
        content: "",
        tool_calls: [
          {
            function: {
              name: "create_file",
              arguments: JSON.stringify({ path, content }),
            },
          },
        ],
      },
    };
  }

  const payload =
    kind === "ARCHITECT"
      ? architectureSpec()
      : kind === "RESEARCH"
        ? researchDossier()
        : kind === "PRD"
          ? approvedPrd()
          : kind === "PLANNER"
            ? executionPlan()
            : { error: "unknown node" };

  return {
    message: { content: JSON.stringify(payload) },
    prompt_eval_count: 10,
    eval_count: 10,
  };
}

const server = createServer((request, response) => {
  if (request.method !== "POST") {
    response.writeHead(404).end();
    return;
  }

  let body = "";
  request.on("data", (chunk) => {
    body += chunk;
  });
  request.on("end", () => {
    response.setHeader("Content-Type", "application/json");

    if (request.url === "/api/embed") {
      response.end(JSON.stringify({ embeddings: [Array(768).fill(0.01)] }));
      return;
    }

    if (request.url === "/api/chat") {
      try {
        const parsed = JSON.parse(body) as { messages?: Message[] };
        const result = chatResponse(parsed.messages ?? []);
        response.end(JSON.stringify(result));
      } catch {
        response.writeHead(500).end(JSON.stringify({ error: "bad request" }));
      }
      return;
    }

    response.writeHead(404).end();
  });
});

const port = Number(process.env.MOCK_PORT ?? "11435");
server.listen(port, "127.0.0.1", () => {
  console.log(`Mock provider listening on http://127.0.0.1:${port}`);
});