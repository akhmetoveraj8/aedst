"use client";

import {
  Cancel01Icon,
  RefreshIcon,
  Upload04Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "cn";
import { useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";

import {
  type UploadItem,
  useTaskUploads,
  useUploadQueue,
} from "@/modules/media/lib/upload-queue-store";
import { useUploader } from "@/modules/media/uploader/use-uploader";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Progress } from "@/shared/ui/progress";

const ACCEPT = "image/*,video/*,audio/*,application/pdf";

/**
 * Drop zone + file picker + live queue. File drops use the platform's
 * native drag-and-drop events: dnd-kit (the approved DnD library) is for
 * dragging elements *within* the page and does not handle files dragged in
 * from the OS. The zone is a real `<label>` for the hidden input, so it is
 * keyboard- and screen-reader-operable without extra ARIA.
 */
export function Uploader({ taskId }: { taskId?: string }) {
  const t = useTranslations("media.uploader");
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const { enqueue, cancel, retry } = useUploader();
  const items = useTaskUploads(taskId);
  const clearFinished = useUploadQueue((state) => state.clearFinished);

  function accept(files: FileList | null) {
    if (files && files.length > 0) {
      enqueue([...files], taskId);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Label
        htmlFor={inputId}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          accept(event.dataTransfer.files);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg font-normal leading-normal border-2 border-dashed p-6 text-center text-sm transition-colors focus-within:ring-2 focus-within:ring-ring",
          dragging ? "border-primary bg-primary/5" : "hover:bg-muted",
        )}
      >
        <HugeiconsIcon icon={Upload04Icon} strokeWidth={2} className="size-6" />
        <span className="font-medium">{t("dropzone")}</span>
        <span className="text-muted-foreground text-xs">{t("hint")}</span>
        {/* sr-only: the visible drop zone is the label itself */}
        <Input
          ref={inputRef}
          id={inputId}
          type="file"
          multiple
          accept={ACCEPT}
          className="sr-only"
          onChange={(event) => {
            accept(event.target.files);
            event.target.value = "";
          }}
        />
      </Label>

      {items.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label={t("queueLabel")}>
          {items.map((item) => (
            <UploadRow
              key={item.id}
              item={item}
              onCancel={() => cancel(item.id)}
              onRetry={() => retry(item.id)}
            />
          ))}
        </ul>
      )}
      {items.some((i) => i.status === "done" || i.status === "cancelled") && (
        <Button
          variant="ghost"
          size="sm"
          className="w-fit"
          onClick={clearFinished}
        >
          {t("clearFinished")}
        </Button>
      )}
    </div>
  );
}

function UploadRow({
  item,
  onCancel,
  onRetry,
}: {
  item: UploadItem;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const t = useTranslations("media.uploader");
  const active =
    item.status === "queued" ||
    item.status === "compressing" ||
    item.status === "uploading" ||
    item.status === "finalizing";

  return (
    <li className="flex flex-col gap-1.5 rounded-md border p-2">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="truncate" title={item.file.name}>
          {item.file.name}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <span className="text-muted-foreground text-xs" role="status">
            {t(`status.${item.status}`)}
          </span>
          {active && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("cancel", { name: item.file.name })}
              onClick={onCancel}
            >
              <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
            </Button>
          )}
          {(item.status === "failed" || item.status === "cancelled") && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("retry", { name: item.file.name })}
              onClick={onRetry}
            >
              <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} />
            </Button>
          )}
        </span>
      </div>
      {active && (
        <Progress
          value={Math.round(item.progress * 100)}
          aria-label={t("progress", { name: item.file.name })}
        />
      )}
      {item.status === "failed" && item.errorKey && (
        <p role="alert" className="text-destructive text-xs">
          {t(`errors.${item.errorKey}` as "errors.unknown")}
        </p>
      )}
    </li>
  );
}
