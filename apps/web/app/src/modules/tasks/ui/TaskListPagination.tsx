"use client";

import { useTranslations } from "next-intl";

import { Button } from "@/shared/ui/button";

/** Previous/next page controls of the cursor-paged task list. */
export function TaskListPagination({
  hasPreviousPage,
  nextPageToken,
  onPrevious,
  onNext,
}: {
  hasPreviousPage: boolean;
  nextPageToken: string;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const t = useTranslations("tasks.list");
  return (
    <nav
      aria-label={t("paginationLabel")}
      className="flex items-center justify-end gap-2"
    >
      <Button
        variant="outline"
        size="sm"
        disabled={!hasPreviousPage}
        onClick={onPrevious}
      >
        {t("previousPage")}
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={!nextPageToken}
        onClick={onNext}
      >
        {t("nextPage")}
      </Button>
    </nav>
  );
}
