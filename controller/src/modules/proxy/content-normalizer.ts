const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const CANONICAL_FUNCTION_KEYS = ["name", "description", "parameters"];

export const normalizeToolRequest = (payload: Record<string, unknown>): Record<string, unknown> => {
  if (payload["functions"] && !payload["tools"] && Array.isArray(payload["functions"])) {
    payload["tools"] = (payload["functions"] as Array<Record<string, unknown>>).map(
      (functionDefinition) => ({
        type: "function",
        function: canonicalizeFunction(functionDefinition),
      }),
    );
    delete payload["functions"];
  }

  const tools = payload["tools"];
  if (Array.isArray(tools)) {
    payload["tools"] = tools
      .map((tool) => {
        if (!isRecord(tool)) return tool;
        const functionDefinition = tool["function"];
        if (!isRecord(functionDefinition)) return tool;
        return { ...tool, function: canonicalizeFunction(functionDefinition) };
      })
      .sort((left, right) => {
        const leftName = getFunctionName(left);
        const rightName = getFunctionName(right);
        if (leftName === null) return rightName === null ? 0 : 1;
        if (rightName === null) return -1;
        return leftName.localeCompare(rightName);
      });
  }

  if (payload["tool_choice"] === "auto") delete payload["tool_choice"];
  return payload;
};

/** Canonical keys first, in fixed order; every other key follows, sorted. */
const canonicalizeFunction = (
  functionDefinition: Record<string, unknown>,
): Record<string, unknown> => {
  const canonical: Record<string, unknown> = {};
  for (const key of CANONICAL_FUNCTION_KEYS) {
    if (key in functionDefinition) canonical[key] = functionDefinition[key];
  }
  for (const key of Object.keys(functionDefinition).sort()) {
    if (!CANONICAL_FUNCTION_KEYS.includes(key)) canonical[key] = functionDefinition[key];
  }
  return canonical;
};

const getFunctionName = (tool: unknown): string | null => {
  if (!isRecord(tool) || !isRecord(tool["function"])) return null;
  const name = tool["function"]["name"];
  return typeof name === "string" ? name : null;
};

const collapseTextContentParts = (content: unknown): string | null => {
  if (!Array.isArray(content)) return null;

  const chunks: string[] = [];
  for (const part of content) {
    if (typeof part === "string") {
      chunks.push(part);
      continue;
    }
    if (!isRecord(part)) return null;
    if (part["type"] !== "text" && part["type"] !== "input_text") return null;
    const text = part["text"];
    if (typeof text !== "string") return null;
    chunks.push(text);
  }

  return chunks.join("");
};

export const normalizeChatMessageContentParts = (payload: Record<string, unknown>): boolean => {
  const messages = payload["messages"];
  if (!Array.isArray(messages)) return false;

  let changed = false;
  for (const message of messages) {
    if (!isRecord(message)) continue;
    const collapsed = collapseTextContentParts(message["content"]);
    if (collapsed === null) continue;
    message["content"] = collapsed;
    changed = true;
  }

  return changed;
};
