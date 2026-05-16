import { inngest } from "../client";
import { prisma } from "@/lib/prisma";
import { getEmbeddings } from "@/lib/embeddings";
import { LLmMessage } from "@/lib/types";
import { buildContext } from "@/lib/context-engine";
import { callLLM } from "@/lib/llm";
import { tools } from "@/lib/tools";
import { executeTool } from "@/lib/tool-executor";
import { ExecutionStatus, NodeStatus, NodeType } from "@prisma/client";
import { handleFailure } from "@/lib/handleFailure";
import { handleToolCompletion } from "@/lib/toolCompletion";

export const agentFunction = inngest.createFunction(
    {
        id: "agent", retries: 3,
        onFailure: async ({ event }) => {
            const workflowId = event.data.event.data.workflowId;
            const executionId = event.data.event.data.executionId;
            const nodeId = event.data.event.data.nodeId;

            await handleFailure(executionId, nodeId, workflowId);
        }
        , triggers: [{ event: "chat/requested" }]
    },
    async ({ event, step }) => {
        // step-1 - fetch initial context to prepare for agent execution
        const contextData = await step.run("fetch_initial_context", async () => {
            const { projectId, userId, prompt } = event.data;
            const inital_context = await prisma.project.findFirst({
                where: {
                    id: projectId,
                    userId: userId
                },
                include: {
                    files: {
                        select: { id: true, path: true, embeddingStatus: true }
                    },
                    messages: {
                        orderBy: { createdAt: "desc" },
                        take: 10,
                        select: { role: true, content: true }
                    }

                }
            })
            return { projectId: inital_context?.id || "", files: inital_context?.files || [], messages: inital_context?.messages?.reverse() || [], prompt: prompt };
        })

        // step-2 - agentic loop
        const result = await step.run("agent-loop", async () => {
            const { userId, executionId, nodeId } = event.data;
            const { projectId, files, messages, prompt } = contextData;
            let iterations = 0;
            const MAX_ITERATIONS = Number(process.env.MAX_ITERATIONS) || 12;
            // before we get into the agentic loop get the current context 


            let currentContext: {
                currentTask: string,
                iteration: number,
                scratchpad: string[]
            } = {
                currentTask: "",
                iteration: 0,
                scratchpad: []
            }

            const toolHistory: Array<{
                role: "assistant" | "tool";
                content: string | null;
                tool_calls?: unknown[];
                tool_call_id?: string;
            }> = []

            //1. generate prompt -embeddings
            const promptEmbedding: number[] = await getEmbeddings(prompt);

            const execution = await prisma.execution.update({
                where: {
                    id: executionId
                },
                data: {
                    status: ExecutionStatus.RUNNING
                }
            })

            const node = await prisma.node.update({
                where: {
                    id: nodeId
                },
                data: {
                    status: NodeStatus.RUNNING
                }
            })

            await prisma.runtimeEvent.createMany({
                data: [

                    { executionId: executionId, type: "execution.running", payload: { executionId: executionId } },
                    { executionId: executionId, nodeId: nodeId, type: "node.running", payload: { nodeId: nodeId, type: NodeType.ARCHITECT } },

                ]
            })

            while (iterations < MAX_ITERATIONS) {
                iterations++;

                // build context to be passed to llm
                const request: LLmMessage[] = await buildContext(projectId, files, messages, promptEmbedding, prompt, toolHistory, currentContext);

                // 2. call llm message + tools
                const response = await callLLM(request, tools);

                // 3. parsing the response
                const message = response.choices[0].message;

                // assistant's msg to tool_history
                toolHistory.push({
                    role: "assistant",
                    content: message.content,
                    tool_calls: message.tool_calls || undefined,
                })

                if (!message.tool_calls || message.tool_calls.length === 0) break;

                // 1 tool call --> future parallel tool calls

                const tool_call = message.tool_calls[0];
                await prisma.runtimeEvent.create({
                    data: {
                        executionId: executionId, nodeId: nodeId, type: "tool.called", payload: {
                            tool: tool_call.function.name,
                            args: JSON.parse(tool_call.function.arguments),
                            iteration: iterations
                        }
                    },

                })
                let toolResult = "";
                if (tool_call.function.name === "mark_complete") {
                    const args = JSON.parse(tool_call.function.arguments);

                    await executeTool("mark_complete", args, projectId, userId, execution.id, node.id);
                    handleToolCompletion(executionId, nodeId, { tool: tool_call.function.name, result: "execution.completed", iteration: iterations });
                    break;
                } else {
                    const args = JSON.parse(tool_call.function.arguments);
                    toolResult = await executeTool(tool_call.function.name, args, projectId, userId, execution.id, node.id);
                }

                // add tool call result to toolHistory
                toolHistory.push({
                    role: "tool",
                    content: toolResult,
                    tool_call_id: tool_call.id
                })

                const shortLog = toolResult.length > 100 ? toolResult.substring(0, 100) + "..." : toolResult;

                handleToolCompletion(executionId, nodeId, { tool: tool_call.function.name, result: shortLog, iteration: iterations });

                // update scratchpad / short-term memory 
                currentContext = {
                    currentTask: prompt,
                    iteration: iterations,
                    scratchpad: [
                        ...currentContext.scratchpad,
                        `[${iterations}]: ${tool_call.function.name}() -> ${shortLog}`
                    ]
                }

            }
        })

        // step - 3 
        await step.run("finalize", async () => {
            await prisma.project.update({
                where: {
                    id: contextData.projectId
                },
                data: {
                    status: "IDLE"
                }
            })
        })
    }
)



