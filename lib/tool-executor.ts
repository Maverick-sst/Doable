import { inngest } from "@/app/inngest/client";
import { prisma } from "./prisma";
import { Prisma } from "@prisma/client";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/client";

export async function executeTool(
    toolName: string,
    args: Record<string, string>,
    projectId: string,
    userId: string
): Promise<string> {

    // authenticate user + projects
    // get project roor 
    // tool definitions
    await validateProjectAccess(projectId,userId);

    try {
        switch (toolName) {
            case "create_file": 
              return await createFile(args.path,args.content,projectId);
              
            case "edit_file":
              return await editFile({path: args.path, old_str: args.old_str, new_str: args.new_str}, projectId);
                
            case "read_file":
              return await readFile(args.path, projectId);
              
            case "delete_file":
              return await deleteFile(args.path, projectId);
              
            case "mark_complete":
              return await markComplete(args.summary, projectId);
              
            default:
              throw new Error("Invalid tool name: "+ toolName);
        }
    } catch (error: unknown) {
        return "Error: Tool execution failed: " + (error as Error).message;
    }

}

async function validateProjectAccess(projectId: string, userId: string): Promise<void>{
        
          const project = await prisma.project.count({
            where: {
                id: projectId,
                userId: userId
            }
          })  
           if(project === 0){
            throw new Error("Project not found or access denied");
           }
     
    }

    // tool handlers

    async function createFile(path: string, content: string, projectId: string): Promise<string> {
           
                const file = await prisma.file.create({
                    data: {
                        path,
                        content: content ?? "",
                        projectId: projectId
                    },
                    select: {
                        id: true,
                        path: true,
                        createdAt: true,
                    },
                });
                // trigger inngest event to process embeddings in background
                try {
                    await inngest.send({
                        name: "file/embedding-requested",
                        data: {
                            projectId: projectId,
                            fileId: file.id,
                            content: content ?? "",
                        }
                    })
                } catch (error) {
                    throw new Error("Failed to send event to inngest");
                }
    
                return `File created successfully with id: ${file.id} and path: ${file.path}`;
        
    }

    async function editFile(
        args: {
            path: string,
            old_str: string,
            new_str: string
        },
        projectId: string
    ): Promise<string> {
        // oldStr can be empty for full rewrite,
        // if oldStr is provided, do search-replace, else full rewrite
        const { path, old_str, new_str } = args;
        const file = await prisma.file.findFirst({
            where: {
                projectId: projectId,
                path: path
            }
        })
        if (!file) {
            return `Error: File not found at path: ${path}`;
        }

        let newContent = file.content;
        if(!old_str || old_str === ""){
            newContent = new_str;
        }else{
            if(!file.content.includes(old_str)){
                throw new Error("old_str not found in file content");
            }
            newContent = file.content.replace(old_str, new_str);
        }
        let updatedFile = null;
        
            updatedFile = await prisma.file.update({
                    where: {
                        projectId_path: {
                            projectId: projectId,
                            path: path,
                        }
                    },
                    data: {
                content: newContent,
                embeddingStatus: "EMBEDDING_PENDING",
                updatedAt: new Date(),
            }
                })
        
                // trigger inngest event to process embeddings in background
                try {
                    await inngest.send({
                        name: "file/embedding-requested",
                        data: {
                            projectId: projectId,
                            fileId: updatedFile.id,
                            content: updatedFile.content ?? "",
                        }
                    })
                } catch (error) {
                    throw new Error("Failed to send event to inngest");
                }
                return `File updated successfully at path: ${updatedFile.path}`;

            
       
    }

    async function readFile(path:string, projectId: string): Promise<string> {
        const file = await prisma.file.findFirst({
            where: {
                projectId: projectId,
                path: path
            }
        })
        if (!file) {
            return `Error: File not found at path: ${path}`;
        }
        return file.content;
    }
    async function deleteFile(path: string, projectId: string): Promise<string> {
        const file = await prisma.file.findFirst({
            where: { projectId: projectId, path: path }
        });
        if (!file) {
            return `Error: File not found at path: ${path}`;
        }
        await prisma.file.delete({
            where: {
                projectId_path: {
                    projectId: projectId,
                    path: path
                }
            }
        })
        return `File at path ${path} deleted successfully.`;
    }

    async function markComplete(summary: string, projectId: string): Promise<string> {
        await prisma.project.update({
            where: {
                id: projectId
            },
            data: {
                // update status, context column---> which is basically short term memory alogn with updatedAt
                status: "IDLE",
                context: {
                    // short term mem updation
                    summary: summary,
                    currentTask: "",
                    iteration: 0,
                    scratchpad: [],
                } as Prisma.JsonObject,
                updatedAt: new Date()
            }
        })
        return `Project marked complete with summary.`;
    }
