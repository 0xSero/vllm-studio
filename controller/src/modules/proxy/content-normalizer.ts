export const normalizeToolRequest = (payload: Record<string, unknown>): Record<string, unknown> => {
  if (payload["functions"] && !payload["tools"] && Array.isArray(payload["functions"])) {
    payload["tools"] = (payload["functions"] as Array<Record<string, unknown>>).map(
      (functionDefinition) => ({
        type: "function",
        function: canonicalizeFunction(functionDefinition),
      })
    );
    delete payload["functions"];
  }

  const tools = payload["tools"];
  if (Array.isArray(tools)) {
    payload["tools"] = tools
      .map((tool) => {
        if (!tool || typeof tool !== "object" || Array.isArray(tool)) {
          return tool;
        }
        const toolRecord = tool as Record<string, unknown>;
        const functionDefinition = toolRecord["function"];
        if (
          functionDefinition &&
          typeof functionDefinition === "object" &&
          !Array.isArray(functionDefinition)
        ) {
          return {
            ...toolRecord,
            function: canonicalizeFunction(functionDefinition as Record<string, unknown>),
          };
        }
        return tool;
      })
      .sort((left, right) => {
        const leftName = getFunctionName(left);
        const rightName = getFunctionName(right);
        if (leftName === null && rightName === null) {
          return 0;
        }
        if (leftName === null) {
          return 1;
        }
        if (rightName === null) {
          return -1;
        }
        return leftName.localeCompare(rightName);
      });
  }

  if (payload["tool_choice"] === "auto") {
    delete payload["tool_choice"];
  }
  return payload;
};

const canonicalizeFunction = (
  functionDefinition: Record<string, unknown>
): Record<string, unknown> => {
  const rest: Record<string, unknown> = {};
  for (const key of Object.keys(functionDefinition)) {
    if (key !== "name" && key !== "description" && key !== "parameters") {
      rest[key] = functionDefinition[key];
    }
  }

  const canonical: Record<string, unknown> = {};
  if ("name" in functionDefinition) {
    canonical["name"] = functionDefinition["name"];
  }
  if ("description" in functionDefinition) {
    canonical["description"] = functionDefinition["description"];
  }
  if ("parameters" in functionDefinition) {
    canonical["parameters"] = functionDefinition["parameters"];
  }
  for (const key of Object.keys(rest).sort()) {
    canonical[key] = rest[key];
  }
  return canonical;
};

const getFunctionName = (tool: unknown): string | null => {
  if (!tool || typeof tool !== "object" || Array.isArray(tool)) {
    return null;
  }
  const toolRecord = tool as Record<string, unknown>;
  const functionDefinition = toolRecord["function"];
  if (
    !functionDefinition ||
    typeof functionDefinition !== "object" ||
    Array.isArray(functionDefinition)
  ) {
    return null;
  }
  const name = (functionDefinition as Record<string, unknown>)["name"];
  return typeof name === "string" ? name : null;
};

const collapseTextContentParts = (content: unknown): string | null => {
  if (!Array.isArray(content)) {
    return null;
  }

  const chunks: string[] = [];
  for (const part of content) {
    if (typeof part === "string") {
      chunks.push(part);
      continue;
    }
    if (!part || typeof part !== "object" || Array.isArray(part)) {
      return null;
    }

    const record = part as Record<string, unknown>;
    const type = typeof record["type"] === "string" ? record["type"] : "";
    if (type !== "text" && type !== "input_text") {
      return null;
    }
    const text = record["text"];
    if (typeof text === "string") {
      chunks.push(text);
      continue;
    }
    return null;
  }

  return chunks.join("");
};

export const normalizeChatMessageContentParts = (payload: Record<string, unknown>): boolean => {
  const messages = payload["messages"];
  if (!Array.isArray(messages)) {
    return false;
  }

  let changed = false;
  for (const message of messages) {
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      continue;
    }

    const record = message as Record<string, unknown>;
    const collapsed = collapseTextContentParts(record["content"]);
    if (collapsed === null) {
      continue;
    }

    record["content"] = collapsed;
    changed = true;
  }

  return changed;
};
