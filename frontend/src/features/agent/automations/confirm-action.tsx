"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/ui";

/**
 * A destructive action behind a confirm step: one quiet button that, once
 * clicked, becomes the real (danger) button plus a Cancel. Both automations
 * surfaces that delete something use this shape, and both name what disappears
 * in the confirm label. `busy` is any editor action being in flight, `loading`
 * is this one; `className` styles the row, `labelClassName` the quiet button.
 */
export function ConfirmAction({
  label,
  confirmLabel,
  icon,
  loading,
  busy,
  className,
  labelClassName,
  onConfirm,
}: {
  label: ReactNode;
  confirmLabel: ReactNode;
  icon: ReactNode;
  loading: boolean;
  busy: boolean;
  className?: string;
  labelClassName?: string;
  onConfirm?: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const shared = { type: "button", size: "sm", disabled: busy } as const;
  return (
    <div className={`flex items-center gap-2${className ? ` ${className}` : ""}`}>
      {confirming ? (
        <>
          <Button {...shared} variant="danger" loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
          <Button {...shared} variant="ghost" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </>
      ) : (
        <Button
          {...shared}
          variant="ghost"
          onClick={() => setConfirming(true)}
          icon={icon}
          className={labelClassName}
        >
          {label}
        </Button>
      )}
    </div>
  );
}
