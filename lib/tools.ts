export const tools = [
  {
    type: "function",
    function: {
      name: "create_file",
      description: "Create a new file. Use only when the file does not exist.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path relative to project root" },
          content: { type: "string", description: "Full content of the new file" },
          projectId: { type: "string", description: "ProjectId - currently working in" }
        },
        required: ["path", "content", "projectId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "edit_file",
      description: "Edit an existing file. Use old_str + new_str for precise changes. Leave old_str empty for full file rewrite.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          old_str: { type: "string", description: "Exact text to replace (leave empty for full overwrite)" },
          new_str: { type: "string", description: "Replacement text or entire new file content" },
          projectId: { type: "string", description: "ProjectId - currently working in" }

        },
        required: ["path", "old_str", "new_str", "projectId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read the full content of a file before editing it.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" }, projectId: { type: "string", description: "ProjectId - currently working in" }
        },
        required: ["path", "projectId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "delete_file",
      description: "Delete a file that is no longer needed.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" }, projectId: { type: "string", description: "ProjectId - currently working in" }
        },
        required: ["path", "projectId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "mark_complete",
      description: "Call ONLY when the project is fully complete and runnable with no bugs.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string", description: "Short summary of what was built" },
          projectId: { type: "string", description: "ProjectId - currently working in" }
        },
        required: ["summary", "projectId"]
      }
    }
  }
];