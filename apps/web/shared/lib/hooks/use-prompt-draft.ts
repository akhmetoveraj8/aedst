import type * as React from "react";
import { useCallback, useMemo, useRef, useState } from "react";

/** What a prompt sends: the trimmed text and the attached files. */
export type PromptMessage = { text: string; files: File[] };

type UsePromptDraftOptions = {
  /** A rejected promise keeps the draft so the person can retry. */
  onSubmit: (message: PromptMessage) => void | Promise<void>;
  /** Blocks submitting, e.g. while a reply is submitted or streaming. */
  busy: boolean;
  /** When false, a new file replaces the attached one. */
  multiple: boolean;
};

/**
 * Draft state of a chat prompt (text plus attached files) for the kit's
 * `AiPromptInput`: add/remove files, and submit once with the trimmed text,
 * clearing the draft when the send succeeds. It also owns the hidden file
 * input (`fileInputRef`, `openFilePicker`, `onFilesPicked`) and the textarea's
 * keyboard and paste handling.
 */
export function usePromptDraft({
  onSubmit,
  busy,
  multiple,
}: UsePromptDraftOptions) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const canSubmit = !busy && (text.trim().length > 0 || files.length > 0);

  const addFiles = useCallback(
    (incoming: Iterable<File>) => {
      const list = [...incoming];
      if (list.length === 0) return;
      setFiles((current) =>
        multiple ? [...current, ...list] : list.slice(0, 1),
      );
    },
    [multiple],
  );

  const removeFile = useCallback((file: File) => {
    setFiles((current) => current.filter((f) => f !== file));
  }, []);

  const submit = useCallback(() => {
    if (!canSubmit) return;
    const clear = () => {
      setText("");
      setFiles([]);
    };
    const result = onSubmit({ text: text.trim(), files });
    if (result instanceof Promise) {
      result.then(clear, () => undefined);
    } else {
      clear();
    }
  }, [canSubmit, text, files, onSubmit]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const openFilePicker = useCallback(() => fileInputRef.current?.click(), []);

  const onFilesPicked = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      if (event.currentTarget.files) addFiles(event.currentTarget.files);
      // Reset so picking the same file again fires `change`.
      event.currentTarget.value = "";
    },
    [addFiles],
  );

  /** Enter sends, Shift+Enter adds a line; skipped while an IME composes. */
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.defaultPrevented) return;
      const { key, shiftKey, nativeEvent } = event;
      if (key === "Enter" && !shiftKey && !nativeEvent.isComposing) {
        event.preventDefault();
        submit();
      }
    },
    [submit],
  );

  /** Pasted files are attached instead of inserted as text. */
  const onPaste = useCallback(
    (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (event.defaultPrevented || event.clipboardData.files.length === 0) {
        return;
      }
      event.preventDefault();
      addFiles(event.clipboardData.files);
    },
    [addFiles],
  );

  return useMemo(
    () => ({
      text,
      setText,
      files,
      addFiles,
      removeFile,
      submit,
      canSubmit,
      fileInputRef,
      openFilePicker,
      onFilesPicked,
      onKeyDown,
      onPaste,
    }),
    [
      text,
      files,
      addFiles,
      removeFile,
      submit,
      canSubmit,
      openFilePicker,
      onFilesPicked,
      onKeyDown,
      onPaste,
    ],
  );
}
