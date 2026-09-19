import { z } from "zod";

export const CreateProjectSchema = z.object({
    name: z.string().min(1).max(120),
    description: z.string().optional(),
});

export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;
