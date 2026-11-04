"use client";

import { MediaPlayer } from "@/modules/media/player/MediaPlayer";
import type { Media } from "@/shared/api/connect/generated/aedst/media/v1/media_pb";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

/** Full-size view / playback of one attachment (loaded on first open). */
export function MediaViewerDialog({
  media,
  open,
  onOpenChange,
}: Readonly<{
  media: Media;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}>) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="truncate">{media.filename}</DialogTitle>
        </DialogHeader>
        <MediaPlayer media={media} />
      </DialogContent>
    </Dialog>
  );
}
