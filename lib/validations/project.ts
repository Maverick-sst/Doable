import { z } from "zod"

const DomainEnum = ['FULL_STACK_APPLICATION',
    'LANDING_PAGE'] as const;

export const CreateProjectSchema = z.object({
    name: z.string().min(1).max(120),
    description: z.string().optional(),
    domain: z.enum(DomainEnum) ,  // ensures only above are sent / first line of defence
    techStack: z.string(),
    requirements: z.string()
})

export type CreateProjectInput = z.infer<typeof CreateProjectSchema>