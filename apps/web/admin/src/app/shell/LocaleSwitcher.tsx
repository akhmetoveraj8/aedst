"use client";

import { useLocation } from "@tanstack/react-router";
import { useTransition } from "react";
import { useLocale, useTranslations } from "use-intl";

import { localeNames, locales } from "@/shared/i18n/locales";
import { usePathname, useRouter } from "@/shared/i18n/navigation";
import { LocaleSelect } from "@/shared/ui/locale-select";

const options = locales.map((value) => ({
  value,
  label: localeNames[value],
}));

/**
 * Language picker for the signed-in header and the sign-in page. It swaps the
 * locale prefix of the current path (`/en/tasks` -> `/ar/tasks`) with
 * the locale-aware router seam, so `<html lang dir>` follows (RTL for
 * Arabic, set by the locale route's loader) and the search string is kept.
 */
export function LocaleSwitcher({ className }: { className?: string }) {
  const t = useTranslations("common.locale");
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const search = useLocation({ select: (location) => location.searchStr });
  const [pending, startTransition] = useTransition();

  return (
    <div aria-busy={pending}>
      <LocaleSelect
        className={className}
        label={t("label")}
        value={locale}
        options={options}
        onValueChange={(next) => {
          const target = locales.find((candidate) => candidate === next);
          if (target && target !== locale) {
            startTransition(() =>
              router.replace(`${pathname}${search}`, { locale: target }),
            );
          }
        }}
      />
    </div>
  );
}
