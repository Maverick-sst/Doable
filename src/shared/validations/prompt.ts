import { z } from "zod";
import { ProjectDomainSchema } from "./project-domain";

const PromptSchema = z.string().min(1).max(10000).refine(val => !val.includes('\x00'), 'Invalid characters in prompt');

export const CreatePromptSchema = z.object({
    prompt : PromptSchema,
    domain: ProjectDomainSchema
})

export type CreatePromptInput = z.infer<typeof CreatePromptSchema>;
