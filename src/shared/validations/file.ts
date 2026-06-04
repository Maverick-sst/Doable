import { z } from 'zod';

const PATH_REGEX = /^[A-Za-z0-9._\-/]+$/;
const PathSchema = z
    .string()
    .min(1, "Path is required")
    .max(300, "Path too long")
    .regex(PATH_REGEX, "Path contains invalid characters")
    .refine((p) => !p.startsWith("/"), "Path must be relative")
    .refine((p) => !p.includes(".."), "Path cannot contain '..'")
    .refine((p) => !p.includes("//"), "Path cannot contain '//' ");


const ContentSchema = z.string().max(20_00_000, "content too large");

export const CreateFileSchema = z.object({
    path: PathSchema,
    content: ContentSchema.optional()
})

export const UpdateFileSchema = z.object({
    path: PathSchema.optional(),
    content: ContentSchema.optional()
}).refine((data) => data.path !== undefined || data.content !== undefined, {
    message: "At least one field (path or content) must be provided",
})

export type CreateFileInput = z.infer<typeof CreateFileSchema>;
export type UpdateFileInput = z.infer<typeof UpdateFileSchema>;
