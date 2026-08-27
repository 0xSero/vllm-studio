import { Schema } from "effect";
export type ProxyValue = string | number | boolean | null | ProxyObject | ProxyValue[];
export interface ProxyObject {
  [key: string]: ProxyValue | undefined;
}

export const isProxyObject = (value: ProxyValue | undefined): value is ProxyObject =>
  value !== null && value !== undefined && !Array.isArray(value) && Object(value) === value;

export const normalizeToolRequest = (payload: ProxyObject): ProxyObject => {
  if (payload["functions"] && !payload["tools"] && Array.isArray(payload["functions"])) {
    payload["tools"] = payload["functions"].filter(isProxyObject).map(
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
        if (!isProxyObject(tool)) return tool;
        const toolRecord = tool;
        const functionDefinition = toolRecord["function"];
        if (
          isProxyObject(functionDefinition)
        ) {
          return {
            ...toolRecord,
            function: canonicalizeFunction(functionDefinition),
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
  functionDefinition: ProxyObject,
): ProxyObject => {
  const rest: ProxyObject = {};
  for (const key of Object.keys(functionDefinition)) {
    if (key !== "name" && key !== "description" && key !== "parameters") {
      rest[key] = functionDefinition[key];
    }
  }

  const canonical: ProxyObject = {};
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

const getFunctionName = (tool: ProxyValue | undefined): string | null => {
  if (!isProxyObject(tool)) return null;
  const toolRecord = tool;
  const functionDefinition = toolRecord["function"];
  if (
    !isProxyObject(functionDefinition)
  ) {
    return null;
  }
  const name = functionDefinition["name"];
  return Schema.is(Schema.String)(name) ? name : null;
};

const collapseTextContentParts = (content: ProxyValue | undefined): string | null => {
  if (!Array.isArray(content)) {
    return null;
  }

  const chunks: string[] = [];
  for (const part of content) {
    if (isProxyObject(part)) {
      const rawType = part["type"];
      const type = Schema.is(Schema.String)(rawType) ? rawType : "";
      if (type !== "text" && type !== "input_text") return null;
      const text = part["text"];
      if (!Schema.is(Schema.String)(text)) return null;
      chunks.push(text);
      continue;
    }
    if (!Schema.is(Schema.String)(part)) return null;
    chunks.push(part);
  }

  return chunks.join("");
};

export const normalizeChatMessageContentParts = (payload: ProxyObject): boolean => {
  const messages = payload["messages"];
  if (!Array.isArray(messages)) {
    return false;
  }

  let changed = false;
  for (const message of messages) {
    if (!isProxyObject(message)) continue;
    const record = message;
    const collapsed = collapseTextContentParts(record["content"]);
    if (collapsed === null) {
      continue;
    }

    record["content"] = collapsed;
    changed = true;
  }

  return changed;
};
