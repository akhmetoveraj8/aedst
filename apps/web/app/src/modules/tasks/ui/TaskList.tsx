"use client";

import { useQuery } from "@connectrpc/connect-query";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useQueryStates } from "nuqs";
import { useEffect, useId, useState } from "react";
import { buildListTasksInput } from "@/modules/tasks/lib/list-tasks-input";
import { taskSearchParsers } from "@/modules/tasks/lib/task-search-params";
import { TaskListPagination } from "@/modules/tasks/ui/TaskListPagination";
import { TaskListRow } from "@/modules/tasks/ui/TaskListRow";
import { TasksService } from "@/shared/api/connect/client";
import { Link } from "@/shared/i18n/navigation";
import { useDebouncedValue } from "@/shared/lib/hooks/use-debounced-value";
import { Button, buttonVariants } from "@/shared/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/shared/ui/empty";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { LoadingSkeleton } from "@/shared/ui/loading-skeleton";
import { Skeleton } from "@/shared/ui/skeleton";

const SEARCH_DEBOUNCE_MS = 300;

// The three selects pull in the base-ui Select/popup stack (~40 KB gzip), so
// they load as their own chunk right after hydration. The placeholder has the
// triggers' exact size (h-8, w-40/w-40/w-48), so nothing shifts when they arrive.
const TaskListFilters = dynamic(
  () =>
    import("@/modules/tasks/ui/TaskListFilters").then((m) => m.TaskListFilters),
  {
    ssr: false,
    loading: () => (
      <>
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-8 w-48" />
      </>
    ),
  },
);

export function TaskList() {
  const t = useTranslations("tasks.list");
  const searchId = useId();

  // All view state lives in the URL (see task-search-params.ts).
  const [params, setParams] = useQueryStates(taskSearchParsers);

  // The box types instantly; the URL (and therefore the request) only
  // follows after a pause, so a fast typist sends one request, not one per key.
  const [searchInput, setSearchInput] = useState(params.q);
  const debouncedSearch = useDebouncedValue(searchInput, SEARCH_DEBOUNCE_MS);

  // biome-ignore lint/correctness/useExhaustiveDependencies: must fire only when the *debounced input* changes; depending on params.q would re-apply a stale debounced value after back/forward navigation.
  useEffect(() => {
    if (debouncedSearch !== params.q) {
      void setParams({ q: debouncedSearch, cursors: [] });
    }
  }, [debouncedSearch]);

  // Back/forward (or a shared link) changes `q` from outside the box.
  useEffect(() => {
    setSearchInput(params.q);
  }, [params.q]);

  const { data, isLoading, isError, refetch } = useQuery(
    TasksService.method.listTasks,
    buildListTasksInput(params),
  );

  const hasFilters =
    params.q !== "" || params.status !== "all" || params.priority !== "all";
  const hasPreviousPage = params.cursors.length > 0;

  return (
    <section aria-label={t("resultsLabel")} className="flex flex-col gap-4">
      {/* biome-ignore lint/a11y/useSemanticElements: role="search" on a div works in every browser; the <search> element does not (Safari < 17) */}
      <div role="search" className="flex flex-wrap items-center gap-2">
        <Label htmlFor={searchId} className="sr-only">
          {t("searchLabel")}
        </Label>
        <Input
          id={searchId}
          type="search"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder={t("searchPlaceholder")}
          className="max-w-xs"
        />

        <TaskListFilters
          status={params.status}
          priority={params.priority}
          sort={params.sort}
          onStatusChange={(status) => void setParams({ status, cursors: [] })}
          onPriorityChange={(priority) =>
            void setParams({ priority, cursors: [] })
          }
          onSortChange={(sort) => void setParams({ sort, cursors: [] })}
        />

        <Link
          href="/tasks/new"
          className={buttonVariants({ className: "ms-auto" })}
        >
          {t("newTask")}
        </Link>
      </div>

      {/* Announces filter/search/page changes to screen readers. */}
      <p role="status" aria-live="polite" className="sr-only">
        {data ? t("resultCount", { count: data.tasks.length }) : ""}
      </p>

      {isLoading ? (
        <LoadingSkeleton className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </LoadingSkeleton>
      ) : isError ? (
        <Empty role="alert">
          <EmptyHeader>
            <EmptyTitle>{t("errorTitle")}</EmptyTitle>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" onClick={() => refetch()}>
              {t("retry")}
            </Button>
          </EmptyContent>
        </Empty>
      ) : data && data.tasks.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>
              {hasFilters ? t("noResultsTitle") : t("emptyTitle")}
            </EmptyTitle>
            <EmptyDescription>
              {hasFilters ? t("noResultsDescription") : t("emptyDescription")}
            </EmptyDescription>
          </EmptyHeader>
          {!hasFilters && (
            <EmptyContent>
              <Link href="/tasks/new" className={buttonVariants()}>
                {t("newTask")}
              </Link>
            </EmptyContent>
          )}
        </Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {data?.tasks.map((task) => (
            <TaskListRow key={task.id} task={task} />
          ))}
        </ul>
      )}

      {data && (data.tasks.length > 0 || hasPreviousPage) && (
        <TaskListPagination
          hasPreviousPage={hasPreviousPage}
          nextPageToken={data.nextPageToken}
          onPrevious={() =>
            void setParams({ cursors: params.cursors.slice(0, -1) })
          }
          onNext={() =>
            void setParams(
              { cursors: [...params.cursors, data.nextPageToken] },
              { history: "push" },
            )
          }
        />
      )}
    </section>
  );
}
