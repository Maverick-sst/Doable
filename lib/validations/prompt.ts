import { z } from "zod";

const ProjectIdSchema = z.string();
const PromptSchema = z.string().min(1).max(10000).refine(val => !val.includes('\x00'), 'Invalid characters in prompt');

export const CreatePromptSchema = z.object({
    projectId : ProjectIdSchema,
    prompt : PromptSchema
})

export type CreatePromptInput = z.infer<typeof CreatePromptSchema>;
