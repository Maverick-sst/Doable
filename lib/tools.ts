/**
 * Model-facing tool contracts. Project identity is never supplied by the
 * model; the server injects it into the execution seam.
 */
export const tools = [
  {
    type: "function",
    function: {
      name: "create_file",
      description: "Create a new file. Use only when the file does not exist.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: {
            type: "string",
            description: "File path relative to the project root",
          },
          content: { type: "string", description: "Full content of the new file" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_file",
      description:
        "Edit an existing file. Use old_str + new_str for precise changes. Leave old_str empty for a full rewrite.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string" },
          old_str: {
            type: "string",
            description: "Exact text to replace (empty for full overwrite)",
          },
          new_str: {
            type: "string",
            description: "Replacement text or entire new file content",
          },
        },
        required: ["path", "old_str", "new_str"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read the full content of a file before editing it.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_file",
      description: "Delete a file that is no longer needed.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mark_complete",
      description:
        "Call ONLY when the assigned work is fully complete and the project is runnable.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          summary: {
            type: "string",
            description: "Short summary of what was built",
          },
        },
        required: ["summary"],
      },
    },
  },
] as const;