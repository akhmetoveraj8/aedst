"use client";

import { useQuery } from "@connectrpc/connect-query";
import { skipToken } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useCommandPalette } from "@/modules/search/lib/command-palette-store";
import { normalizeQuery } from "@/modules/search/lib/search-params";
import { HighlightedText } from "@/modules/search/ui/HighlightedText";
import { SearchService } from "@/shared/api/connect/client";
import { useRouter } from "@/shared/i18n/navigation";
import { safeInAppPath } from "@/shared/lib/auth/safe-redirect";
import { useDebouncedValue } from "@/shared/lib/hooks/use-debounced-value";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/shared/ui/command";

const DEBOUNCE_MS = 200;

const ACTIONS = [
  { href: "/tasks/new", key: "newTask" },
  { href: "/tasks", key: "goTasks" },
  { href: "/notifications", key: "goNotifications" },
] as const;

/**
 * The palette dialog (cmdk + live SearchService results). Split from
 * CommandPalette.tsx so the cmdk chunk loads on first open, not with every
 * signed-in page. Filtering is the server's job, so cmdk's own fuzzy filter
 * is off (`shouldFilter={false}`).
 */
export default function CommandPaletteDialog() {
  const t = useTranslations("search.palette");
  const router = useRouter();
  const { open, setOpen } = useCommandPalette();
  const [input, setInput] = useState("");
  const query = normalizeQuery(useDebouncedValue(input, DEBOUNCE_MS));

  const results = useQuery(
    SearchService.method.search,
    open && query ? { query, pageSize: 8 } : skipToken,
    { meta: { feature: "search" } },
  );

  function go(href: string) {
    setOpen(false);
    setInput("");
    router.push(href);
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title={t("title")}
      description={t("description")}
    >
      <Command shouldFilter={false}>
        <CommandInput
          value={input}
          onValueChange={setInput}
          placeholder={t("placeholder")}
        />
        <CommandList>
          <CommandEmpty>
            {results.isFetching ? t("searching") : t("noResults")}
          </CommandEmpty>
          {(results.data?.hits.length ?? 0) > 0 && (
            <CommandGroup heading={t("results")}>
              {results.data?.hits.map((hit) => (
                <CommandItem
                  key={`${hit.kind}:${hit.id}`}
                  value={`hit:${hit.kind}:${hit.id}`}
                  onSelect={() => go(safeInAppPath(hit.link) ?? "/search")}
                >
                  <HighlightedText text={hit.title} />
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {query && (
            <CommandGroup>
              <CommandItem
                value="search-all"
                onSelect={() => go(`/search?q=${encodeURIComponent(query)}`)}
              >
                {t("searchAll", { query })}
              </CommandItem>
            </CommandGroup>
          )}
          <CommandGroup heading={t("actions")}>
            {ACTIONS.map((action) => (
              <CommandItem
                key={action.key}
                value={`action:${action.key}`}
                onSelect={() => go(action.href)}
              >
                {t(action.key)}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
