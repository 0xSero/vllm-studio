"use client";

import { useState, type HTMLAttributes, type ReactNode } from "react";
import { Check, Circle, Clock, Copy, X } from "@/ui/icon-registry";
import { cx } from "../utils";

function normalizedTokenCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

export function tokenUsageMetrics(
  input: number,
  output: number,
  limit?: number,
): {
  input: number;
  output: number;
  total: number;
  limit: number | null;
  percent: number | null;
} {
  const safeInput = normalizedTokenCount(input);
  const safeOutput = normalizedTokenCount(output);
  const total = safeInput + safeOutput;
  const safeLimit =
    limit === undefined || !Number.isFinite(limit) || limit <= 0 ? null : Math.floor(limit);
  return {
    input: safeInput,
    output: safeOutput,
    total,
    limit: safeLimit,
    percent: safeLimit === null ? null : Math.min(100, Math.round((total / safeLimit) * 100)),
  };
}

export function tokenUsagePercent(input: number, output: number, limit?: number): number | null {
  return tokenUsageMetrics(input, output, limit).percent;
}

export async function copyCodeText(
  code: string,
  clipboard: Pick<Clipboard, "writeText"> = navigator.clipboard,
): Promise<void> {
  await clipboard.writeText(code);
}

export async function tryCopyCodeText(
  code: string,
  clipboard: Pick<Clipboard, "writeText"> = navigator.clipboard,
): Promise<"copied" | "failed"> {
  try {
    await copyCodeText(code, clipboard);
    return "copied";
  } catch {
    return "failed";
  }
}

export function CodeBlock({
  code,
  language = "text",
  filename,
  className,
  ...props
}: HTMLAttributes<HTMLElement> & { code: string; language?: string; filename?: string }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    const next = await tryCopyCodeText(code);
    setCopyState(next);
    window.setTimeout(() => setCopyState("idle"), 1_500);
  };
  const copyLabel =
    copyState === "copied" ? "Code copied" : copyState === "failed" ? "Copy failed" : "Copy code";
  return (
    <figure
      className={cx(
        "border border-(--ui-border) bg-(--ui-surface) forced-colors:border-[CanvasText]",
        className,
      )}
      {...props}
    >
      <figcaption className="flex min-h-11 items-center border-b border-(--ui-border) px-3 font-mono text-[length:var(--fs-xs)] text-(--ui-muted)">
        <span>{filename ?? language}</span>
        <button
          type="button"
          aria-label={copyLabel}
          onClick={copy}
          className="ml-auto grid size-11 place-items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)"
        >
          {copyState === "copied" ? (
            <Check className="size-4" aria-hidden />
          ) : (
            <Copy className="size-4" aria-hidden />
          )}
        </button>
        <span className="sr-only" role="status" aria-live="polite">
          {copyState === "idle" ? "" : copyLabel}
        </span>
      </figcaption>
      <pre className="overflow-x-auto p-3 font-mono text-[length:var(--fs-sm)] leading-6 text-(--ui-fg)">
        <code data-language={language}>{code}</code>
      </pre>
    </figure>
  );
}

export function Plan({
  title = "Plan",
  children,
  className,
  ...props
}: HTMLAttributes<HTMLOListElement> & { title?: string }) {
  return (
    <section
      aria-label={title}
      className={cx(
        "border border-(--ui-border) bg-(--ui-surface) p-3 forced-colors:border-[CanvasText]",
        className,
      )}
    >
      <h2 className="font-medium text-(--ui-fg)">{title}</h2>
      <ol className="mt-3 space-y-2" {...props}>
        {children}
      </ol>
    </section>
  );
}

export type PlanStepState = "pending" | "running" | "completed" | "failed";

const stepIcons = {
  pending: Circle,
  running: Clock,
  completed: Check,
  failed: X,
};

export function PlanStep({
  state,
  title,
  detail,
  className,
  ...props
}: HTMLAttributes<HTMLLIElement> & {
  state: PlanStepState;
  title: string;
  detail?: string;
}) {
  const Icon = stepIcons[state];
  return (
    <li
      data-state={state}
      className={cx(
        "grid grid-cols-[44px_1fr] items-start border-t border-(--ui-border) pt-2",
        className,
      )}
      {...props}
    >
      <span className="grid size-11 place-items-center text-(--ui-muted)">
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="py-2">
        <strong className="block font-medium text-(--ui-fg)">{title}</strong>
        {detail ? <span className="text-(--ui-muted)">{detail}</span> : null}
        <span className="sr-only">State: {state}</span>
      </span>
    </li>
  );
}

export function ChainOfThought({
  summary = "Observable reasoning",
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDetailsElement> & { summary?: string; children: ReactNode }) {
  return (
    <details
      className={cx(
        "border border-(--ui-border) bg-(--ui-surface) forced-colors:border-[CanvasText]",
        className,
      )}
      {...props}
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center px-3 font-medium text-(--ui-fg) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)">
        {summary}
      </summary>
      <ol className="border-t border-(--ui-border) p-3">{children}</ol>
    </details>
  );
}

export function Thought({
  title,
  detail,
  timestamp,
  className,
  ...props
}: HTMLAttributes<HTMLLIElement> & { title: string; detail?: string; timestamp?: string }) {
  return (
    <li
      className={cx(
        "grid grid-cols-[1fr_auto] gap-3 border-b border-(--ui-border) py-2 last:border-0",
        className,
      )}
      {...props}
    >
      <span>
        <strong className="block font-medium text-(--ui-fg)">{title}</strong>
        {detail ? <span className="text-(--ui-muted)">{detail}</span> : null}
      </span>
      {timestamp ? <time className="font-mono text-(--ui-muted)">{timestamp}</time> : null}
    </li>
  );
}

export function TokenUsage({
  input,
  output,
  limit,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { input: number; output: number; limit?: number }) {
  const metrics = tokenUsageMetrics(input, output, limit);
  return (
    <div
      aria-label="Token usage"
      className={cx(
        "border border-(--ui-border) bg-(--ui-surface) p-3 forced-colors:border-[CanvasText]",
        className,
      )}
      {...props}
    >
      <div className="grid grid-cols-3 gap-3 font-mono text-[length:var(--fs-sm)]">
        <span>Input {metrics.input.toLocaleString()}</span>
        <span>Output {metrics.output.toLocaleString()}</span>
        <span>Total {metrics.total.toLocaleString()}</span>
      </div>
      {metrics.percent !== null && metrics.limit !== null ? (
        <div className="mt-3">
          <div
            role="progressbar"
            aria-label="Context used"
            aria-valuemin={0}
            aria-valuemax={metrics.limit}
            aria-valuenow={Math.min(metrics.total, metrics.limit)}
            className="h-1.5 bg-(--ui-hover)"
          >
            <div className="h-full bg-(--color-primary)" style={{ width: `${metrics.percent}%` }} />
          </div>
          <p className="mt-1 font-mono text-[length:var(--fs-xs)] text-(--ui-muted)">
            {metrics.percent}% of {metrics.limit.toLocaleString()} context tokens
          </p>
        </div>
      ) : null}
    </div>
  );
}
