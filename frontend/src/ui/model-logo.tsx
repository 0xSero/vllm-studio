"use client";

import { useState } from "react";
import { Boxes } from "@/ui/icon-registry";
import { hfAvatarUrl } from "@/lib/huggingface";
import { cx } from "./utils";

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
  const iconSize = size === "lg" ? "h-5 w-5" : size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";
  const title = label || modelId;

  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-(--ui-border) bg-(--ui-surface) text-(--ui-muted)",
        dimensions,
        className,
      )}
      title={title}
    >
      {!failed ? (
        <img
          src={hfAvatarUrl(modelId, author)}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <Boxes className={iconSize} />
      )}
    </span>
  );
}
