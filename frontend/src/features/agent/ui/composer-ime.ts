type ComposerKeyboardEvent = {
  key: string;
  keyCode?: number;
  nativeEvent: {
    isComposing?: boolean;
    keyCode?: number;
  };
};

export function isComposerImeConfirmation(event: ComposerKeyboardEvent): boolean {
  return (
    event.key === "Enter" &&
    Boolean(
      event.nativeEvent.isComposing || event.keyCode === 229 || event.nativeEvent.keyCode === 229,
    )
  );
}
