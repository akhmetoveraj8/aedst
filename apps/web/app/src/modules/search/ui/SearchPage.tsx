"use client";

import { timestampDate } from "@bufbuild/protobuf/wkt";
import { useInfiniteQuery } from "@connectrpc/connect-query";
import { skipToken } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useQueryStates } from "nuqs";
import { useEffect, useId } from "react";
import {
  KIND_FILTERS,
  type KindFilter,
  kindsFor,
  normalizeQuery,
  searchParsers,
} from "@/modules/search/lib/search-params";
import { HighlightedText } from "@/modules/search/ui/HighlightedText";
import { SearchService } from "@/shared/api/connect/client";
import { DocumentKind } from "@/shared/api/connect/generated/aedst/search/v1/search_pb";
import { formatDateTime } from "@/shared/date/format-date";
import { Link } from "@/shared/i18n/navigation";
import { track } from "@/shared/lib/analytics/analytics";
import { safeInAppPath } from "@/shared/lib/auth/safe-redirect";
import { useDebouncedValue } from "@/shared/lib/hooks/use-debounced-value";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/shared/ui/empty";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Skeleton } from "@/shared/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui/tabs";

const PAGE_SIZE = 20;
const DEBOUNCE_MS = 300;

/**
 * Full-page search over SearchService: query and kind filter live in the URL
 * (nuqs), requests are keyed on the *debounced* query (one request per pause,
 * not per keystroke), and results page with the server's keyset tokens.
 */
export function SearchPage() {
  const t = useTranslations("search");
  const locale = useLocale();
  const inputId = useId();
  const [{ q, kind }, setParams] = useQueryStates(searchParsers, {
    history: "replace",
  });
  const query = normalizeQuery(useDebouncedValue(q, DEBOUNCE_MS));

  const results = useInfiniteQuery(
    SearchService.method.search,
    query
      ? { query, kinds: kindsFor(kind), pageSize: PAGE_SIZE, pageToken: "" }
      : skipToken,
    {
      pageParamKey: "pageToken",
      getNextPageParam: (last) => last.nextPageToken || undefined,
      meta: { feature: "search" },
    },
  );

  const hits = results.data?.pages.flatMap((page) => page.hits) ?? [];
  const total = results.data?.pages[0]?.totalEstimate ?? 0;
  const firstPageLoaded = results.isSuccess && results.data.pages.length === 1;

  useEffect(() => {
    if (query && firstPageLoaded) {
      track("search_performed", { query_length: query.length, results: total });
    }
  }, [query, firstPageLoaded, total]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-semibold text-2xl">{t("title")}</h1>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Label htmlFor={inputId} className="sr-only">
          {t("label")}
        </Label>
        <Input
          id={inputId}
          type="search"
          value={q}
          maxLength={200}
          placeholder={t("placeholder")}
          onChange={(event) => void setParams({ q: event.target.value })}
          className="sm:max-w-md"
        />
        <Tabs
          value={kind}
          onValueChange={(value) =>
            void setParams({ kind: value as KindFilter })
          }
        >
          <TabsList aria-label={t("kindsLabel")}>
            {KIND_FILTERS.map((filter) => (
              <TabsTrigger key={filter} value={filter}>
                {t(`kinds.${filter}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <section aria-label={t("resultsLabel")} aria-busy={results.isFetching}>
        {!query ? (
          <p className="text-muted-foreground text-sm">{t("emptyPrompt")}</p>
        ) : results.isPending ? (
          <div className="flex flex-col gap-2" role="status">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : results.isError ? (
          <Empty role="alert">
            <EmptyHeader>
              <EmptyTitle>{t("errorTitle")}</EmptyTitle>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="outline" onClick={() => results.refetch()}>
                {t("retry")}
              </Button>
            </EmptyContent>
          </Empty>
        ) : hits.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{t("noResults")}</EmptyTitle>
              <EmptyDescription>{t("noResultsDescription")}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <p className="mb-2 text-muted-foreground text-sm" role="status">
              {t("resultsCount", { count: total || hits.length })}
            </p>
            <ol className="flex flex-col gap-2">
              {hits.map((hit, position) => (
                <li key={`${hit.kind}:${hit.id}`}>
                  <Link
                    href={safeInAppPath(hit.link) ?? "/search"}
                    onClick={() =>
                      track("search_result_opened", {
                        kind: DocumentKind[hit.kind] ?? "UNKNOWN",
                        position,
                      })
                    }
                    className="flex flex-col gap-1 rounded-lg border p-3 transition-colors hover:bg-muted"
                  >
                    <span className="flex items-center gap-2">
                      <span className="font-medium">
                        <HighlightedText text={hit.title} />
                      </span>
                      <Badge variant="secondary">
                        {t(
                          hit.kind === DocumentKind.MEDIA
                            ? "kinds.media"
                            : "kinds.task",
                        )}
                      </Badge>
                    </span>
                    {hit.snippet && (
                      <span className="text-muted-foreground text-sm">
                        <HighlightedText text={hit.snippet} />
                      </span>
                    )}
                    {hit.updatedAt && (
                      <span className="text-muted-foreground text-xs">
                        {t("updated", {
                          date: formatDateTime(
                            timestampDate(hit.updatedAt),
                            locale,
                          ),
                        })}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ol>
            {results.hasNextPage && (
              <Button
                variant="outline"
                className="mt-3"
                disabled={results.isFetchingNextPage}
                onClick={() => results.fetchNextPage()}
              >
                {t("loadMore")}
              </Button>
            )}
          </>
        )}
      </section>
    </div>
  );
}
