export type AssistantTextContent = {
  type: "text";
  text: string;
};

export type AssistantThinkingContent = {
  type: "thinking";
  thinking: string;
};

export type AssistantToolCall = {
  type: "toolCall";
  id: string;
  name: string;
  arguments: unknown;
};
