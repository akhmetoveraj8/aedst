"use client";

import { useTranslations } from "next-intl";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";

/** Confirmation before an attachment is deleted (the delete cannot be undone). */
export function DeleteAttachmentDialog({
  filename,
  open,
  onOpenChange,
  onConfirm,
}: Readonly<{
  /** The attachment to delete (kept while the closing animation runs). */
  filename: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}>) {
  const t = useTranslations("media.attachments");
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("deleteConfirmTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("deleteConfirmDescription", { name: filename })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("deleteCancelAction")}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            {t("deleteConfirmAction")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
