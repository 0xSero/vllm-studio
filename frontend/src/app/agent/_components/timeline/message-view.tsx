import type { ChatMessage } from "@/lib/agent/session";
import { AssistantMarkdown } from "../assistant-markdown";
import { ToolBlockView } from "./tool-block-view";

export function MessageView({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <article className="flex justify-end">
        <div className="max-w-[72%] rounded-xl bg-(--surface) px-3.5 py-2 text-sm leading-6 text-(--fg)">
          <div className="whitespace-pre-wrap break-words">{message.text}</div>
        </div>
      </article>
    );
  }
  const blocks = message.blocks ?? [];
  return (
    <article className="min-w-0">
      {blocks.length === 0 ? (
        <div className="text-sm leading-6 text-(--dim)">…</div>
      ) : (
        <div className="flex flex-col gap-3">
          {blocks.map((block) => {
            if (block.kind === "thinking") {
              return (
                <details key={block.id} className="text-xs" open>
                  <summary className="cursor-pointer list-none text-[11px] italic text-(--dim) hover:text-(--fg)">
                    Thinking
                  </summary>
                  <pre className="mt-2 max-w-full whitespace-pre-wrap break-words border-l-2 border-(--border) pl-3 font-mono text-[11px] leading-5 text-(--dim) [overflow-wrap:anywhere]">
                    {block.text}
                  </pre>
                </details>
              );
            }
            if (block.kind === "text") {
              return <AssistantMarkdown key={block.id} text={block.text} />;
            }
            if (block.kind === "event") {
              return (
                <div
                  key={block.id}
                  className="flex items-center gap-3 py-1 text-[11px] text-(--dim)"
                >
                  <span className="h-px flex-1 bg-(--border)" />
                  <span>{block.text}</span>
                  <span className="h-px flex-1 bg-(--border)" />
                </div>
              );
            }
            return <ToolBlockView key={block.id} block={block} />;
          })}
        </div>
      )}
    </article>
  );
}
