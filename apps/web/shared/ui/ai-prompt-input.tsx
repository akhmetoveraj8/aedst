"use client";

import {
  Add01Icon,
  Alert02Icon,
  ArrowUp02Icon,
  Cancel01Icon,
  File01Icon,
  Loading03Icon,
  StopIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "cn";
import * as React from "react";
import {
  type PromptMessage as AiPromptInputMessage,
  usePromptDraft,
} from "@/shared/lib/hooks/use-prompt-draft";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@/shared/ui/attachment";
import { Input } from "@/shared/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/shared/ui/input-group";

// The field the person types into to message the agent (shadcn AI Elements
// "Prompt Input", Base UI pattern): an input group with a textarea, an attach
// button, attachment chips and a send button. It does not depend on the AI
// SDK: `onSubmit({ text, files })` and a `status` prop drive it. There is no
// form element (forms here are React Hook Form); Enter and the send button
// call `onSubmit` directly.

type AiPromptInputStatus = "ready" | "submitted" | "streaming" | "error";

type AiPromptInputValue = ReturnType<typeof usePromptDraft> & {
  status: AiPromptInputStatus;
};

const AiPromptInputContext = React.createContext<AiPromptInputValue | null>(
  null,
);

function useAiPromptInput(): AiPromptInputValue {
  const value = React.useContext(AiPromptInputContext);
  if (!value) {
    throw new Error("AiPromptInput parts must be used inside <AiPromptInput>");
  }
  return value;
}

type AiPromptInputProps = Omit<React.ComponentProps<"div">, "onSubmit"> & {
  /** Gets the trimmed text and files; a rejected promise keeps the draft. */
  onSubmit: (message: AiPromptInputMessage) => void | Promise<void>;
  status?: AiPromptInputStatus;
  /** `accept` of the hidden file input, e.g. "image/*". */
  accept?: string;
  multiple?: boolean;
};

function AiPromptInput({
  onSubmit,
  status = "ready",
  accept,
  multiple = true,
  className,
  children,
  ...props
}: AiPromptInputProps) {
  const busy = status === "submitted" || status === "streaming";
  const draft = usePromptDraft({ onSubmit, busy, multiple });
  const value = React.useMemo(() => ({ ...draft, status }), [draft, status]);

  return (
    <AiPromptInputContext.Provider value={value}>
      <InputGroup
        data-status={status}
        className={cn(
          // The base group dims when any child is disabled; here only a
          // disabled textarea dims it, not the idle send button.
          "overflow-hidden has-disabled:bg-transparent has-disabled:opacity-100 dark:has-disabled:bg-input/30 has-[[data-slot=input-group-control]:disabled]:bg-input/50 has-[[data-slot=input-group-control]:disabled]:opacity-50",
          className,
        )}
        {...props}
      >
        {children}
      </InputGroup>
      <Input
        ref={draft.fileInputRef}
        type="file"
        hidden
        tabIndex={-1}
        aria-hidden="true"
        accept={accept}
        multiple={multiple}
        onChange={draft.onFilesPicked}
      />
    </AiPromptInputContext.Provider>
  );
}

type AiPromptInputHeaderProps = React.ComponentProps<typeof InputGroupAddon> & {
  /** Accessible name of each chip's remove button, e.g. `Remove ${file.name}`. */
  removeLabel: (file: File) => string;
};

/** Top addon: one small attachment chip per file (or `children`); hidden while empty. */
function AiPromptInputHeader({
  removeLabel,
  className,
  children,
  ...props
}: AiPromptInputHeaderProps) {
  const { files, removeFile } = useAiPromptInput();
  if (files.length === 0) return null;
  return (
    <InputGroupAddon
      align="block-start"
      className={cn("w-full", className)}
      {...props}
    >
      {children ?? (
        <AttachmentGroup className="w-full">
          {files.map((file, index) => (
            <Attachment key={`${file.name}-${index}`} size="sm">
              <AttachmentMedia>
                <HugeiconsIcon icon={File01Icon} strokeWidth={2} />
              </AttachmentMedia>
              <AttachmentContent>
                <AttachmentTitle>{file.name}</AttachmentTitle>
              </AttachmentContent>
              <AttachmentActions>
                <AttachmentAction
                  aria-label={removeLabel(file)}
                  onClick={() => removeFile(file)}
                >
                  <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
                </AttachmentAction>
              </AttachmentActions>
            </Attachment>
          ))}
        </AttachmentGroup>
      )}
    </InputGroupAddon>
  );
}

/** Enter sends, Shift+Enter adds a line; pasted files are attached. */
function AiPromptInputTextarea({
  className,
  onKeyDown,
  onPaste,
  ...props
}: Omit<React.ComponentProps<typeof InputGroupTextarea>, "value">) {
  const draft = useAiPromptInput();
  return (
    <InputGroupTextarea
      value={draft.text}
      onChange={(event) => draft.setText(event.target.value)}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        draft.onKeyDown(event);
      }}
      onPaste={(event) => {
        onPaste?.(event);
        draft.onPaste(event);
      }}
      className={cn("max-h-48 min-h-14 p-3", className)}
      {...props}
    />
  );
}

/** Bottom addon with the tools and the send button. */
function AiPromptInputFooter({
  className,
  ...props
}: React.ComponentProps<typeof InputGroupAddon>) {
  return (
    <InputGroupAddon
      align="block-end"
      className={cn("gap-1", className)}
      {...props}
    />
  );
}

/** Left-aligned group of tools (attach button, model selectors). */
function AiPromptInputTools({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="ai-prompt-input-tools"
      className={cn("flex min-w-0 items-center gap-1", className)}
      {...props}
    />
  );
}

type AiPromptInputButtonProps = Omit<
  React.ComponentProps<typeof InputGroupButton>,
  "aria-label"
> & { label: string };

/** Round outline "+" button that opens the file picker. */
function AiPromptInputAttachButton({
  label,
  className,
  children,
  ...props
}: AiPromptInputButtonProps) {
  const { openFilePicker } = useAiPromptInput();
  return (
    <InputGroupButton
      size="icon-sm"
      variant="outline"
      aria-label={label}
      className={cn("rounded-full", className)}
      onClick={openFilePicker}
      {...props}
    >
      {children ?? <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />}
    </InputGroupButton>
  );
}

type AiPromptInputSubmitProps = AiPromptInputButtonProps & {
  /** Accessible name while streaming, when `onStop` is set. */
  stopLabel?: string;
  /** Stops the reply; makes the button a stop button while streaming. */
  onStop?: () => void;
};

/** Round send button; its icon follows `status` (spinner, stop, error). */
function AiPromptInputSubmit({
  label,
  stopLabel,
  onStop,
  className,
  children,
  ...props
}: AiPromptInputSubmitProps) {
  const { status, canSubmit, submit } = useAiPromptInput();
  const stoppable = status === "streaming" && onStop !== undefined;
  const busy = status === "submitted" || status === "streaming";
  const icon = stoppable
    ? StopIcon
    : busy
      ? Loading03Icon
      : status === "error"
        ? Alert02Icon
        : ArrowUp02Icon;
  return (
    <InputGroupButton
      size="icon-sm"
      variant="default"
      aria-label={stoppable ? (stopLabel ?? label) : label}
      aria-busy={(busy && !stoppable) || undefined}
      data-status={status}
      disabled={!(stoppable || canSubmit)}
      className={cn("ms-auto rounded-full", className)}
      onClick={stoppable ? onStop : submit}
      {...props}
    >
      {children ?? (
        <HugeiconsIcon
          icon={icon}
          strokeWidth={2}
          className={cn(
            icon === Loading03Icon && "animate-spin motion-reduce:animate-none",
          )}
        />
      )}
    </InputGroupButton>
  );
}

export {
  AiPromptInput,
  AiPromptInputAttachButton,
  AiPromptInputFooter,
  AiPromptInputHeader,
  type AiPromptInputMessage,
  type AiPromptInputStatus,
  AiPromptInputSubmit,
  AiPromptInputTextarea,
  AiPromptInputTools,
  useAiPromptInput,
};
