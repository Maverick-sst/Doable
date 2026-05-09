import { z } from "zod";

export const ProjectContextSchema = z.object({
    summary: z.string(),
    currentTask: z.string(),
    iteration: z.number(),
    scratchpad: z.array(z.string())
})

export type ProjectContext = z.infer<typeof ProjectContextSchema> ;

export const defaultContext: ProjectContext = {
  summary: "",
  currentTask: "",
  iteration: 0,
  scratchpad: []
}