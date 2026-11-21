"use client";

import {
  createConnectQueryKey,
  useMutation,
  useQuery,
} from "@connectrpc/connect-query";
import { Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Thumbnail } from "@/modules/media/thumbnail/Thumbnail";
import { Uploader } from "@/modules/media/uploader/Uploader";
import { MediaService } from "@/shared/api/connect/client";
import {
  type Media,
  MediaStatus,
} from "@/shared/api/connect/generated/aedst/media/v1/media_pb";
import { Button } from "@/shared/ui/button";
import { LoadingSkeleton } from "@/shared/ui/loading-skeleton";

const PROCESSING_POLL_MS = 3_000;

// The viewer and delete dialogs (and the Dialog/AlertDialog stack under them)
// are needed only after a click, so they load as one chunk on demand. Once
// requested they stay mounted, which keeps the closing animation.
const AttachmentDialogs = dynamic(() =>
  import("@/modules/media/ui/AttachmentDialogs").then(
    (m) => m.AttachmentDialogs,
  ),
);

type DialogTarget = { media: Media; open: boolean };

function isSettling(media: Media) {
  return (
    media.status === MediaStatus.PENDING_UPLOAD ||
    media.status === MediaStatus.PROCESSING
  );
}

/**
 * A task's attachments: list (`ListMedia` filtered by task), upload
 * (presigned PUT, attached through `task_id`), view, delete. Lives in the
 * media module and is composed onto the task page by `app/` — the tasks
 * module never imports media (feature boundaries). While anything is still
 * processing on the server, the list polls until variants are ready.
 */
export function TaskAttachments({ taskId }: { taskId: string }) {
  const t = useTranslations("media.attachments");
  const queryClient = useQueryClient();
  const headingId = useId();
  const [viewing, setViewing] = useState<DialogTarget | null>(null);
  const [deleting, setDeleting] = useState<DialogTarget | null>(null);

  const list = useQuery(
    MediaService.method.listMedia,
    { taskId, pageSize: 100 },
    {
      meta: { feature: "media" },
      refetchInterval: (query) =>
        query.state.data?.media.some(isSettling) ? PROCESSING_POLL_MS : false,
    },
  );
  const remove = useMutation(MediaService.method.deleteMedia, {
    meta: { feature: "media" },
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: createConnectQueryKey({
          schema: MediaService,
          cardinality: undefined,
        }),
      }),
  });

  const media = list.data?.media ?? [];

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="font-medium text-lg">
        {t("title")}
      </h2>

      {list.isPending ? (
        <LoadingSkeleton className="h-24 w-full" />
      ) : list.isError ? (
        <div role="alert" className="flex items-center gap-2 text-sm">
          {t("loadError")}
          <Button variant="outline" size="sm" onClick={() => list.refetch()}>
            {t("retry")}
          </Button>
        </div>
      ) : media.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("empty")}</p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-3">
          {media.map((item) => (
            <li key={item.id} className="flex flex-col gap-1">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setViewing({ media: item, open: true })}
                className="h-auto rounded-md p-0 focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={t("open", { name: item.filename })}
              >
                <Thumbnail
                  media={item}
                  size={112}
                  alt={item.filename}
                  onLoadError={() => void list.refetch()}
                />
              </Button>
              <div className="flex items-center justify-between gap-1">
                <span className="truncate text-xs" title={item.filename}>
                  {isSettling(item) ? t("processing") : item.filename}
                </span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  disabled={remove.isPending}
                  aria-label={t("delete", { name: item.filename })}
                  onClick={() => setDeleting({ media: item, open: true })}
                >
                  <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Uploader taskId={taskId} />

      {(deleting || viewing) && (
        <AttachmentDialogs
          viewing={viewing}
          deleting={deleting}
          onViewOpenChange={(open) => {
            if (!open && viewing) {
              setViewing({ ...viewing, open: false });
            }
          }}
          onDeleteOpenChange={(open) => {
            if (!open && deleting) {
              setDeleting({ ...deleting, open: false });
            }
          }}
          onConfirmDelete={(media) => {
            remove.mutate({ id: media.id });
            setDeleting((current) => current && { ...current, open: false });
          }}
        />
      )}
    </section>
  );
}
