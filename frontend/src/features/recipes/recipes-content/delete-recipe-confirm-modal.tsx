"use client";

import { Button, UiModal, UiModalBody, UiModalFooter, UiModalHeader } from "@/ui";

type Props = {
  recipeName: string;
  onCancel: () => void;
  onConfirm: () => void;
};

export function DeleteRecipeConfirmModal({ recipeName, onCancel, onConfirm }: Props) {
  return (
    <UiModal isOpen onClose={onCancel} maxWidth="max-w-md">
      <UiModalHeader title="Delete Serve" onClose={onCancel} />
      <UiModalBody>
        <p className="text-[length:var(--fs-base)] leading-relaxed text-(--ui-muted)">
          Delete &quot;{recipeName}&quot;? Model weights stay on disk.
        </p>
      </UiModalBody>
      <UiModalFooter>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="danger" onClick={onConfirm}>
          Delete
        </Button>
      </UiModalFooter>
    </UiModal>
  );
}
