"use client";

import { useState } from "react";
import { Button } from "./button";
import { UiModal, UiModalBody, UiModalFooter, UiModalHeader } from "./modal";

export type ConfirmDeleteModalProps = {
  title: string;
  message: string;
  /** The destructive verb, so the button says what it does rather than "OK". */
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
};

/**
 * One destructive confirmation for the whole app.
 *
 * Configure and Models each grew their own copy of this modal, which is how two
 * dialogs asking the same question drift into two different button orders. The
 * confirm handler may be async; the button holds its loading state until the
 * promise settles so a slow delete cannot be fired twice.
 */
export function ConfirmDeleteModal({
  title,
  message,
  confirmLabel = "Delete",
  onCancel,
  onConfirm,
}: ConfirmDeleteModalProps) {
  const [busy, setBusy] = useState(false);
  return (
    <UiModal isOpen onClose={onCancel} maxWidth="max-w-md">
      <UiModalHeader title={title} onClose={onCancel} />
      <UiModalBody>
        <p className="text-[length:var(--fs-base)] leading-relaxed text-(--ui-muted)">{message}</p>
      </UiModalBody>
      <UiModalFooter>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="danger"
          loading={busy}
          onClick={() => {
            setBusy(true);
            void Promise.resolve(onConfirm()).finally(onCancel);
          }}
        >
          {confirmLabel}
        </Button>
      </UiModalFooter>
    </UiModal>
  );
}
