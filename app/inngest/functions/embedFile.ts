import { prisma } from "@/lib/prisma";
import { inngest } from "../client";
import { getEmbeddings } from "@/lib/embeddings";


export const embedFileFunction = inngest.createFunction(
    {
        id: "embed-file", retries: 3, triggers: [{ event: "file/embedding-requested" }],
        onFailure: async ({ event }) => {
            await prisma.file.update({
                where: {
                    id: event.data.event.data.fileId,
                    projectId: event.data.event.data.projectId,
                },
                data: {
                    embeddingStatus: "EMBEDDING_FAILED"
                }
            })
        },
    },
    async ({ event, step }) => {
        await step.run("processing_file", async () => {
            const { fileId, projectId } = event.data;
            await prisma.file.update({
                where: {
                    id: fileId,
                    projectId: projectId,
                },
                data: {
                    embeddingStatus: "EMBEDDING_PROCESSING"
                }
            })
        })
        await step.run("embed_file", async () => {
            const { projectId, fileId, content } = event.data;

            const embeddings = await getEmbeddings(content);

            const embeddingsString = `[${embeddings.join(',')}]`;

            await prisma.$executeRaw`
            UPDATE "File" SET "embedding" = ${embeddingsString}::vector, "embeddingStatus" = 'EMBEDDING_SUCCESSFUL' WHERE "id" = ${fileId} AND "projectId" = ${projectId}`

        })
    }

)
