import z from "zod";

export const DomainEnum = ['FULL_STACK_APPLICATION',
    'LANDING_PAGE'] as const;

export const ProjectDomainSchema = z.object({
    domain: z.enum(DomainEnum)
});

export type ProjectDomainInput = z.infer<typeof ProjectDomainSchema>;
