"use client";

import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";

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
 * next-intl's navigation helpers, so `<html lang dir>` follows (RTL for
 * Arabic) and the search string is preserved by the router.
 */
export function LocaleSwitcher({ className }: { className?: string }) {
  const t = useTranslations("common.locale");
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
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
            startTransition(() => router.replace(pathname, { locale: target }));
          }
        }}
      />
    </div>
  );
}
