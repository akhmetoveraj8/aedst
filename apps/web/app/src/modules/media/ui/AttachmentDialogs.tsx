"use client";

import { DeleteAttachmentDialog } from "@/modules/media/ui/DeleteAttachmentDialog";
import { MediaViewerDialog } from "@/modules/media/ui/MediaViewerDialog";
import type { Media } from "@/shared/api/connect/generated/aedst/media/v1/media_pb";

type DialogTarget = { media: Media; open: boolean };

/**
 * The viewer and the delete confirmation of an attachment list. One module so
 * the two dialogs (and the Dialog/AlertDialog stack under them) are a single
 * lazily loaded chunk instead of two chunks that each carry a copy of it.
 */
export function AttachmentDialogs({
  viewing,
  deleting,
  onViewOpenChange,
  onDeleteOpenChange,
  onConfirmDelete,
}: Readonly<{
  viewing: DialogTarget | null;
  deleting: DialogTarget | null;
  onViewOpenChange: (open: boolean) => void;
  onDeleteOpenChange: (open: boolean) => void;
  onConfirmDelete: (media: Media) => void;
}>) {
  return (
    <>
      {deleting && (
        <DeleteAttachmentDialog
          filename={deleting.media.filename}
          open={deleting.open}
          onOpenChange={onDeleteOpenChange}
          onConfirm={() => onConfirmDelete(deleting.media)}
        />
      )}
      {viewing && (
        <MediaViewerDialog
          media={viewing.media}
          open={viewing.open}
          onOpenChange={onViewOpenChange}
        />
      )}
    </>
  );
}
