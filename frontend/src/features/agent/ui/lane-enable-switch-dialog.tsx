"use client";

import { Button, Spinner, UiModal, UiModalHeader } from "@/ui";

export function LaneEnableSwitchDialog({
  isOpen,
  progress,
  title,
  body,
  onCancel,
  onConfirm,
}: {
  isOpen: boolean;
  progress: boolean;
  title: string;
  body: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!isOpen) return null;

  return (
    <UiModal isOpen onClose={progress ? () => undefined : onCancel} maxWidth="max-w-md">
      <UiModalHeader
        title={title}
        onClose={progress ? undefined : onCancel}
        showCloseButton={!progress}
      />
      <div className="space-y-5 p-6">
        {progress ? (
          <div className="flex items-start gap-3 text-[length:var(--fs-sm)] text-(--ui-muted)">
            <Spinner size="sm" className="mt-0.5 shrink-0" />
            <p className="min-w-0 leading-relaxed">{body}</p>
          </div>
        ) : (
          <>
            <p className="text-[length:var(--fs-sm)] leading-relaxed text-(--ui-muted)">{body}</p>
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={onCancel}>
                Cancel
              </Button>
              <Button onClick={onConfirm}>Switch lane</Button>
            </div>
          </>
        )}
      </div>
    </UiModal>
  );
}
