"use client";

import { useState } from "react";
import { hfAvatarUrl } from "@/lib/huggingface";
import { cx } from "./utils";

const PALETTE = [
  "bg-sky-500/12 text-sky-300 border-sky-500/20",
  "bg-teal-400/12 text-teal-300 border-teal-400/20",
  "bg-violet-400/12 text-violet-300 border-violet-400/20",
  "bg-amber-400/12 text-amber-300 border-amber-400/20",
  "bg-emerald-400/12 text-emerald-400 border-emerald-400/20",
  "bg-slate-500/12 text-slate-300 border-slate-500/20",
];

const hashString = (value: string): number =>
  Array.from(value).reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0);

const cleanPart = (part: string): string => part.replace(/[^a-z0-9]/gi, "").trim();

const modelNamePart = (modelId: string): string => {
  const parts = modelId.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? modelId;
};

const initialsFor = (modelId: string, author?: string | null, label?: string): string => {
  const source = label || modelNamePart(modelId);
  const sourceParts = source
    .split(/[-_\s.]+/)
    .map(cleanPart)
    .filter(Boolean);
  if (sourceParts.length > 1)
    return sourceParts
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase();
  const authorInitial = cleanPart(author ?? "")[0];
  const modelInitial = cleanPart(sourceParts[0] ?? source)[0];
  return `${authorInitial ?? ""}${modelInitial ?? ""}`.slice(0, 2).toUpperCase() || "M";
};

const isHubModelId = (modelId: string): boolean =>
  /^[\w.-]+\/[\w.-]+$/.test(modelId) && !modelId.startsWith("/");

export function ModelLogo({
  modelId,
  author,
  label,
  size = "md",
  className,
}: {
  modelId: string;
  author?: string | null;
  label?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const dimensions = size === "lg" ? "h-11 w-11" : size === "sm" ? "h-7 w-7" : "h-9 w-9";
  const textSize = size === "lg" ? "text-[length:var(--fs-md)]" : "text-[length:var(--fs-xs)]";
  const title = label || modelId;
  const fallbackClass = PALETTE[hashString(title) % PALETTE.length];
  const showImage = isHubModelId(modelId) && !failed;

  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md border font-mono font-medium tracking-[0.04em]",
        showImage ? "border-(--ui-border) bg-(--ui-surface) text-(--ui-muted)" : fallbackClass,
        dimensions,
        textSize,
        className,
      )}
      title={title}
    >
      {showImage ? (
        <img
          src={hfAvatarUrl(modelId, author)}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <span>{initialsFor(modelId, author, label)}</span>
      )}
    </span>
  );
}
